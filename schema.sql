-- =====================================================================
-- ESPETO & BREJA — Esquema do banco (Supabase / PostgreSQL 15+)
-- Executar inteiro no SQL Editor do Supabase.
-- O script é idempotente: pode ser executado novamente sem perder dados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nome        text check (nome is null or char_length(nome) <= 120),
  created_at  timestamptz not null default now()
);

create table if not exists public.estabelecimentos (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid()
                        references auth.users (id) on delete cascade,
  nome_fantasia         text not null check (char_length(btrim(nome_fantasia)) between 2 and 120),
  descricao             text check (descricao is null or char_length(descricao) <= 500),
  logo_url              text check (logo_url is null or logo_url ~ '^https?://'),
  mensagem_boas_vindas  text check (mensagem_boas_vindas is null or char_length(mensagem_boas_vindas) <= 300),
  telefone              text check (telefone is null or char_length(telefone) <= 30),
  endereco              text check (endereco is null or char_length(endereco) <= 200),
  cor_primaria          text not null default '#D9480F' check (cor_primaria ~ '^#[0-9A-Fa-f]{6}$'),
  cor_secundaria        text not null default '#F2A71B' check (cor_secundaria ~ '^#[0-9A-Fa-f]{6}$'),
  slug                  text not null check (
                          char_length(slug) between 3 and 60
                          and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                        ),
  ativo                 boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint estabelecimentos_slug_key unique (slug)
);
create index if not exists estabelecimentos_owner_idx on public.estabelecimentos (owner_id);

create table if not exists public.categorias (
  id                  uuid primary key default gen_random_uuid(),
  estabelecimento_id  uuid not null references public.estabelecimentos (id) on delete cascade,
  nome                text not null check (char_length(btrim(nome)) between 1 and 80),
  descricao           text check (descricao is null or char_length(descricao) <= 300),
  ordem               integer not null default 0,
  ativo               boolean not null default true,
  created_at          timestamptz not null default now(),
  -- permite a FK composta em produtos (garante categoria do MESMO estabelecimento)
  constraint categorias_id_estab_key unique (id, estabelecimento_id)
);
create index if not exists categorias_estab_ordem_idx on public.categorias (estabelecimento_id, ordem);

create table if not exists public.produtos (
  id                  uuid primary key default gen_random_uuid(),
  estabelecimento_id  uuid not null references public.estabelecimentos (id) on delete cascade,
  categoria_id        uuid,
  nome                text not null check (char_length(btrim(nome)) between 1 and 120),
  descricao           text check (descricao is null or char_length(descricao) <= 500),
  preco               numeric(10,2) not null default 0 check (preco >= 0),
  imagem_url          text check (imagem_url is null or imagem_url ~ '^https?://'),
  ativo               boolean not null default true,
  destaque            boolean not null default false,
  ordem               integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Um produto só pode apontar para uma categoria do próprio estabelecimento.
  -- Ao excluir a categoria, o produto fica "sem categoria" (não é apagado).
  constraint produtos_categoria_fk foreign key (categoria_id, estabelecimento_id)
    references public.categorias (id, estabelecimento_id)
    on delete set null (categoria_id)
);
create index if not exists produtos_estab_cat_ordem_idx on public.produtos (estabelecimento_id, categoria_id, ordem);
create index if not exists produtos_categoria_idx on public.produtos (categoria_id);

-- ---------------------------------------------------------------------
-- 2. GATILHOS
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists estabelecimentos_updated_at on public.estabelecimentos;
create trigger estabelecimentos_updated_at before update on public.estabelecimentos
  for each row execute function public.set_updated_at();

drop trigger if exists produtos_updated_at on public.produtos;
create trigger produtos_updated_at before update on public.produtos
  for each row execute function public.set_updated_at();

-- Cria o perfil automaticamente quando um usuário se cadastra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nome)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)), 120))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Perfis para usuários que já existiam antes deste script
insert into public.profiles (id, nome)
select u.id, left(coalesce(u.raw_user_meta_data ->> 'nome', split_part(u.email, '@', 1)), 120)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. FUNÇÕES DE AUTORIZAÇÃO
-- ---------------------------------------------------------------------

-- O usuário autenticado é dono deste estabelecimento?
create or replace function public.is_estab_owner(p_estab uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.estabelecimentos e
    where e.id = p_estab and e.owner_id = (select auth.uid())
  );
$$;

-- Mesma verificação, a partir do nome da pasta no Storage (texto)
create or replace function public.owns_estab_folder(p_folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.estabelecimentos e
    where e.id::text = p_folder and e.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.is_estab_owner(uuid)     from public, anon;
revoke all on function public.owns_estab_folder(text)  from public, anon;
grant execute on function public.is_estab_owner(uuid)    to authenticated;
grant execute on function public.owns_estab_folder(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.estabelecimentos  enable row level security;
alter table public.categorias        enable row level security;
alter table public.produtos          enable row level security;

-- Visitantes anônimos NÃO acessam as tabelas diretamente.
-- O cardápio público usa apenas a função cardapio_publico() (seção 5).
revoke all on public.profiles, public.estabelecimentos, public.categorias, public.produtos from anon;
grant select, update                 on public.profiles to authenticated;
grant select, insert, update, delete on public.estabelecimentos, public.categorias, public.produtos to authenticated;

-- profiles
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- estabelecimentos
drop policy if exists estab_select_own on public.estabelecimentos;
create policy estab_select_own on public.estabelecimentos
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists estab_insert_own on public.estabelecimentos;
create policy estab_insert_own on public.estabelecimentos
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists estab_update_own on public.estabelecimentos;
create policy estab_update_own on public.estabelecimentos
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));   -- impede transferir para outro usuário

drop policy if exists estab_delete_own on public.estabelecimentos;
create policy estab_delete_own on public.estabelecimentos
  for delete to authenticated using (owner_id = (select auth.uid()));

-- categorias
drop policy if exists cat_select_own on public.categorias;
create policy cat_select_own on public.categorias
  for select to authenticated using (public.is_estab_owner(estabelecimento_id));

drop policy if exists cat_insert_own on public.categorias;
create policy cat_insert_own on public.categorias
  for insert to authenticated with check (public.is_estab_owner(estabelecimento_id));

drop policy if exists cat_update_own on public.categorias;
create policy cat_update_own on public.categorias
  for update to authenticated
  using (public.is_estab_owner(estabelecimento_id))
  with check (public.is_estab_owner(estabelecimento_id));

drop policy if exists cat_delete_own on public.categorias;
create policy cat_delete_own on public.categorias
  for delete to authenticated using (public.is_estab_owner(estabelecimento_id));

-- produtos
drop policy if exists prod_select_own on public.produtos;
create policy prod_select_own on public.produtos
  for select to authenticated using (public.is_estab_owner(estabelecimento_id));

drop policy if exists prod_insert_own on public.produtos;
create policy prod_insert_own on public.produtos
  for insert to authenticated with check (public.is_estab_owner(estabelecimento_id));

drop policy if exists prod_update_own on public.produtos;
create policy prod_update_own on public.produtos
  for update to authenticated
  using (public.is_estab_owner(estabelecimento_id))
  with check (public.is_estab_owner(estabelecimento_id));

drop policy if exists prod_delete_own on public.produtos;
create policy prod_delete_own on public.produtos
  for delete to authenticated using (public.is_estab_owner(estabelecimento_id));

-- ---------------------------------------------------------------------
-- 5. CARDÁPIO PÚBLICO (somente os campos necessários)
-- Retorna NULL se o slug não existir ou o estabelecimento não estiver publicado.
-- Não expõe owner_id, ids internos do estabelecimento nem datas.
-- ---------------------------------------------------------------------

create or replace function public.cardapio_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'estabelecimento', jsonb_build_object(
      'nome_fantasia',        e.nome_fantasia,
      'descricao',            e.descricao,
      'logo_url',             e.logo_url,
      'mensagem_boas_vindas', e.mensagem_boas_vindas,
      'telefone',             e.telefone,
      'endereco',             e.endereco,
      'cor_primaria',         e.cor_primaria,
      'cor_secundaria',       e.cor_secundaria,
      'slug',                 e.slug
    ),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'descricao', c.descricao)
                       order by c.ordem, c.nome)
      from public.categorias c
      where c.estabelecimento_id = e.id and c.ativo
    ), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'categoria_id', p.categoria_id, 'nome', p.nome,
               'descricao', p.descricao, 'preco', p.preco, 'imagem_url', p.imagem_url,
               'disponivel', p.ativo, 'destaque', p.destaque)
             order by p.ordem, p.nome)
      from public.produtos p
      left join public.categorias c on c.id = p.categoria_id
      where p.estabelecimento_id = e.id
        and (p.categoria_id is null or c.ativo)
    ), '[]'::jsonb)
  )
  from public.estabelecimentos e
  where e.slug = lower(p_slug) and e.ativo;
$$;

revoke all on function public.cardapio_publico(text) from public;
grant execute on function public.cardapio_publico(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. STORAGE — bucket "imagens"
-- Estrutura de pastas: imagens/<estabelecimento_id>/<arquivo>
-- Leitura pública (as fotos aparecem no cardápio); escrita só pelo dono.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagens', 'imagens', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists imagens_select_dono on storage.objects;
create policy imagens_select_dono on storage.objects
  for select to authenticated
  using (bucket_id = 'imagens' and public.owns_estab_folder((storage.foldername(name))[1]));

drop policy if exists imagens_insert_dono on storage.objects;
create policy imagens_insert_dono on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imagens' and public.owns_estab_folder((storage.foldername(name))[1]));

drop policy if exists imagens_update_dono on storage.objects;
create policy imagens_update_dono on storage.objects
  for update to authenticated
  using (bucket_id = 'imagens' and public.owns_estab_folder((storage.foldername(name))[1]))
  with check (bucket_id = 'imagens' and public.owns_estab_folder((storage.foldername(name))[1]));

drop policy if exists imagens_delete_dono on storage.objects;
create policy imagens_delete_dono on storage.objects
  for delete to authenticated
  using (bucket_id = 'imagens' and public.owns_estab_folder((storage.foldername(name))[1]));
