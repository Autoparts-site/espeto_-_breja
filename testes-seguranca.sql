-- =====================================================================
-- ESPETO & BREJA — Testes de isolamento (RLS)
-- Pode ser executado no SQL Editor do Supabase: tudo roda dentro de uma
-- transação que termina em ROLLBACK, então NENHUM dado fica gravado.
-- Resultado esperado: a mensagem "TODOS OS TESTES PASSARAM".
-- Qualquer falha interrompe o script com "FALHOU: ...".
-- =====================================================================
begin;

-- Dois proprietários fictícios
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'dono.breja@teste.local',  '{"nome":"Dono Breja"}'),
  ('22222222-2222-2222-2222-222222222222', 'sergio@teste.local',      '{"nome":"Sérgio"}');

-- ---------- Usuário A cria o "Espeto & Breja" ----------
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into public.estabelecimentos (id, nome_fantasia, slug, ativo)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Espeto & Breja', 'teste-espeto-e-breja', true);
insert into public.categorias (id, estabelecimento_id, nome)
values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Espetos');
insert into public.produtos (estabelecimento_id, categoria_id, nome, preco)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Picanha', 18.90),
       ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Coração', 12.00);
update public.produtos set ativo = false where nome = 'Coração';

do $$ begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'FALHOU: perfil automático / leitura do próprio perfil'; end if;
  if (select owner_id from public.estabelecimentos) <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FALHOU: owner_id não foi preenchido com o usuário autenticado'; end if;
end $$;

-- A não pode criar estabelecimento em nome de outro usuário
do $$ begin
  begin
    insert into public.estabelecimentos (owner_id, nome_fantasia, slug)
    values ('22222222-2222-2222-2222-222222222222', 'Fraude', 'fraude-x');
    raise exception 'FALHOU: criou estabelecimento para outro dono';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- Usuário B cria o "Espeto do Sérgio" ----------
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

insert into public.estabelecimentos (id, nome_fantasia, slug)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'Espeto do Sérgio', 'teste-espeto-do-sergio');

do $$
declare n int;
begin
  -- B não enxerga nada de A
  if (select count(*) from public.estabelecimentos) <> 1 then raise exception 'FALHOU: B vê estabelecimentos de outros'; end if;
  if (select count(*) from public.categorias) <> 0 then raise exception 'FALHOU: B vê categorias de A'; end if;
  if (select count(*) from public.produtos)   <> 0 then raise exception 'FALHOU: B vê produtos de A'; end if;
  if (select count(*) from public.profiles)   <> 1 then raise exception 'FALHOU: B vê perfis de outros'; end if;

  -- B não altera nem exclui dados de A (afeta 0 linhas)
  update public.produtos set preco = 0 where estabelecimento_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU: B alterou produtos de A'; end if;
  delete from public.categorias where estabelecimento_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU: B excluiu categorias de A'; end if;
  update public.estabelecimentos set nome_fantasia = 'Hackeado' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU: B alterou o estabelecimento de A'; end if;

  -- B não insere produto no estabelecimento de A (id enviado pelo navegador)
  begin
    insert into public.produtos (estabelecimento_id, nome, preco) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Intruso', 1);
    raise exception 'FALHOU: B inseriu produto em A';
  exception when insufficient_privilege then null; end;

  -- B não liga seu produto a uma categoria de A (FK composta)
  begin
    insert into public.produtos (estabelecimento_id, categoria_id, nome, preco)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Cruzado', 1);
    raise exception 'FALHOU: produto ligado a categoria de outro estabelecimento';
  exception when foreign_key_violation then null; end;

  -- B não "transfere" o próprio estabelecimento para A
  begin
    update public.estabelecimentos set owner_id = '11111111-1111-1111-1111-111111111111'
    where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise exception 'FALHOU: B transferiu o estabelecimento';
  exception when insufficient_privilege then null; end;

  -- Storage: B não grava na pasta de A, mas grava na própria
  begin
    insert into storage.objects (bucket_id, name) values ('imagens', 'aaaaaaaa-0000-0000-0000-000000000001/x.png');
    raise exception 'FALHOU: B enviou imagem para a pasta de A';
  exception when insufficient_privilege then null; end;
  insert into storage.objects (bucket_id, name) values ('imagens', 'bbbbbbbb-0000-0000-0000-000000000002/logo.png');

  -- Slug duplicado é recusado
  begin
    update public.estabelecimentos set slug = 'teste-espeto-e-breja' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise exception 'FALHOU: aceitou slug duplicado';
  exception when unique_violation then null; end;
end $$;

-- ---------- Visitante anônimo ----------
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare j jsonb;
begin
  -- Sem acesso direto às tabelas
  begin
    perform 1 from public.produtos limit 1;
    raise exception 'FALHOU: anônimo leu a tabela produtos';
  exception when insufficient_privilege then null; end;

  -- Cardápio publicado: retorna só campos públicos
  j := public.cardapio_publico('teste-espeto-e-breja');
  if j is null then raise exception 'FALHOU: cardápio publicado não retornou'; end if;
  if j -> 'estabelecimento' ? 'owner_id' or j -> 'estabelecimento' ? 'id' then
    raise exception 'FALHOU: cardápio expõe dados internos'; end if;
  if jsonb_array_length(j -> 'produtos') <> 2 then raise exception 'FALHOU: quantidade de produtos'; end if;
  if (select count(*) from jsonb_array_elements(j -> 'produtos') p where (p ->> 'disponivel')::boolean = false) <> 1 then
    raise exception 'FALHOU: produto inativo deveria vir como indisponível'; end if;

  -- Cardápio não publicado ou inexistente: NULL
  if public.cardapio_publico('teste-espeto-do-sergio') is not null then raise exception 'FALHOU: cardápio não publicado ficou visível'; end if;
  if public.cardapio_publico('nao-existe') is not null then raise exception 'FALHOU: slug inexistente'; end if;

  raise notice '✅ TODOS OS TESTES PASSARAM';
end $$;

rollback;
