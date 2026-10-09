/* =====================================================================
   ESPETO & BREJA — Painel administrativo
   Toda leitura/escrita passa pelo Supabase com o token do usuário logado.
   O isolamento entre estabelecimentos é garantido pelas políticas RLS.
   ===================================================================== */
(function () {
  'use strict';
  const { sb, esc, safeUrl, formatBRL, slugify, toast, alerta, traduzErro, setLoading,
          requireAuth, uploadImagem, removerImagem, validarImagem } = window.App;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const LS_KEY = 'eb:estab-atual';

  const TITULOS = { resumo: 'Resumo', produtos: 'Produtos', categorias: 'Categorias', estabelecimento: 'Ajustes', compartilhar: 'Compartilhar' };

  const st = { user: null, estabs: [], atual: null, categorias: [], produtos: [], aba: 'resumo' };

  // ------------------------------------------------------------------
  // Inicialização (init() é chamado no fim do arquivo)
  // ------------------------------------------------------------------

  async function init() {
    st.user = await requireAuth();
    if (!st.user) return;
    $('#usuario-email').textContent = st.user.email;
    ligarEventos();
    try {
      await carregarEstabs();
    } catch (err) {
      $('#carregando').innerHTML = `<div class="alerta alerta-erro">${esc(traduzErro(err))}</div>`;
      return;
    }
    $('#carregando').classList.add('hidden');
    $('#app').classList.remove('hidden');
  }

  async function carregarEstabs(selecionarId) {
    const { data, error } = await sb.from('estabelecimentos').select('*')
      .eq('owner_id', st.user.id).order('created_at');
    if (error) throw error;
    st.estabs = data;
    if (!data.length) return mostrarOnboarding(false);

    let salvo = selecionarId;
    if (!salvo) { try { salvo = localStorage.getItem(LS_KEY); } catch { /* sem storage */ } }
    const alvo = data.find((e) => e.id === salvo) || data[0];
    await selecionarEstab(alvo.id);
  }

  async function selecionarEstab(id) {
    st.atual = st.estabs.find((e) => e.id === id);
    try { localStorage.setItem(LS_KEY, id); } catch { /* ignora */ }

    const [cats, prods] = await Promise.all([
      sb.from('categorias').select('*').eq('estabelecimento_id', id).order('ordem').order('nome'),
      sb.from('produtos').select('*').eq('estabelecimento_id', id).order('ordem').order('nome'),
    ]);
    if (cats.error) throw cats.error;
    if (prods.error) throw prods.error;
    st.categorias = cats.data;
    st.produtos = prods.data;

    $('#onboarding').classList.add('hidden');
    $('#conteudo').classList.remove('hidden');
    renderTudo();
    irPara(abaInicial());
  }

  function abaInicial() {
    const h = location.hash.slice(1);
    return TITULOS[h] ? h : st.aba;
  }

  // ------------------------------------------------------------------
  // Navegação
  // ------------------------------------------------------------------
  function irPara(aba) {
    if (!st.atual) return;
    st.aba = aba;
    $$('#menu-abas [data-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === aba)));
    $$('[data-painel]').forEach((s) => s.classList.toggle('hidden', s.dataset.painel !== aba));
    $('#titulo-aba').textContent = TITULOS[aba];
    if (location.hash !== '#' + aba) history.replaceState(null, '', '#' + aba);
    if (aba === 'compartilhar') renderCompartilhar();
    window.scrollTo({ top: 0 });
  }

  function mostrarOnboarding(podeCancelar) {
    $('#conteudo').classList.add('hidden');
    $('#onboarding').classList.remove('hidden');
    $('#form-novo-estab').reset();
    $('#novo-slug').dataset.manual = '';
    atualizarPreviaSlug('#novo-slug', '#novo-slug-previa');
    alerta($('#msg-onboarding'), '');
    let cancelar = $('#btn-cancelar-novo');
    if (podeCancelar && !cancelar) {
      cancelar = document.createElement('button');
      cancelar.type = 'button'; cancelar.id = 'btn-cancelar-novo';
      cancelar.className = 'btn btn-ghost'; cancelar.textContent = 'Cancelar';
      cancelar.addEventListener('click', () => {
        $('#onboarding').classList.add('hidden');
        $('#conteudo').classList.remove('hidden');
      });
      $('#form-novo-estab').appendChild(cancelar);
    }
    if (cancelar) cancelar.classList.toggle('hidden', !podeCancelar);
    $('#app').classList.remove('hidden');
    $('#carregando').classList.add('hidden');
    $('#novo-nome').focus();
  }

  // ------------------------------------------------------------------
  // Renderização
  // ------------------------------------------------------------------
  const urlPublica = () => `${location.origin}/cardapio/${st.atual.slug}`;

  function renderTudo() {
    renderSeletor();
    renderResumo();
    renderCategorias();
    renderFiltroCategorias();
    renderProdutos();
    preencherFormEstab();
  }

  function renderSeletor() {
    $('#sel-estab').innerHTML = st.estabs
      .map((e) => `<option value="${esc(e.id)}"${e.id === st.atual.id ? ' selected' : ''}>${esc(e.nome_fantasia)}</option>`)
      .join('');
  }

  function renderResumo() {
    const e = st.atual;
    $('#resumo-nome').textContent = e.nome_fantasia;
    const s = $('#resumo-status');
    s.textContent = e.ativo ? 'Publicado' : 'Não publicado';
    s.className = `status ${e.ativo ? 'status-on' : 'status-off'}`;
    $('#resumo-aviso').hidden = e.ativo;
    const logo = $('#resumo-logo');
    const lu = safeUrl(e.logo_url);
    logo.hidden = !lu; if (lu) logo.src = lu;

    $('#kpi-produtos').textContent = st.produtos.length;
    $('#kpi-ativos').textContent = st.produtos.filter((p) => p.ativo).length;
    $('#kpi-destaques').textContent = st.produtos.filter((p) => p.destaque).length;
    $('#kpi-categorias').textContent = st.categorias.length;
    $('#resumo-link').value = urlPublica();
    $('#resumo-abrir').href = e.ativo ? urlPublica() : `${urlPublica()}?preview=1`;
  }

  function renderCategorias() {
    const ul = $('#lista-categorias');
    if (!st.categorias.length) {
      ul.innerHTML = '<li class="vazio-box">Nenhuma categoria ainda. Crie a primeira, por exemplo “Espetos” ou “Cervejas”.</li>';
      return;
    }
    const contagem = (id) => st.produtos.filter((p) => p.categoria_id === id).length;
    ul.innerHTML = st.categorias.map((c, i) => `
      <li class="item${c.ativo ? '' : ' inativo'}" data-id="${esc(c.id)}">
        <div class="ordem-btns">
          <button class="btn btn-sec btn-icon" type="button" data-acao="cat-subir" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn btn-sec btn-icon" type="button" data-acao="cat-descer" aria-label="Descer" ${i === st.categorias.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <div class="item-info">
          <div class="item-nome">${esc(c.nome)}</div>
          <div class="item-meta">
            <span>${contagem(c.id)} produto(s)</span>
            ${c.ativo ? '' : '<span class="selo selo-off">Oculta</span>'}
            ${c.descricao ? `<span>${esc(c.descricao)}</span>` : ''}
          </div>
        </div>
        <div class="item-acoes">
          <button class="btn btn-sec btn-sm" type="button" data-acao="cat-ativo">${c.ativo ? 'Ocultar' : 'Mostrar'}</button>
          <button class="btn btn-sec btn-sm" type="button" data-acao="cat-editar">Editar</button>
          <button class="btn btn-perigo btn-sm" type="button" data-acao="cat-excluir">Excluir</button>
        </div>
      </li>`).join('');
  }

  function renderFiltroCategorias() {
    const sel = $('#filtro-cat');
    const atual = sel.value;
    sel.innerHTML = '<option value="">Todas as categorias</option>' +
      st.categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('') +
      '<option value="__sem">Sem categoria</option>';
    sel.value = [...sel.options].some((o) => o.value === atual) ? atual : '';

    $('#prod-categoria').innerHTML = '<option value="">Sem categoria</option>' +
      st.categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  }

  /** Grupos na ordem do cardápio: categorias (pela ordem) + "Sem categoria" */
  function gruposProdutos() {
    const grupos = st.categorias.map((c) => ({ id: c.id, nome: c.nome, itens: st.produtos.filter((p) => p.categoria_id === c.id) }));
    grupos.push({ id: null, nome: 'Sem categoria', itens: st.produtos.filter((p) => !p.categoria_id) });
    grupos.forEach((g) => g.itens.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)));
    return grupos;
  }

  function renderProdutos() {
    const box = $('#lista-produtos');
    if (!st.produtos.length) {
      box.innerHTML = '<div class="vazio-box">Nenhum produto cadastrado. Clique em “+ Novo produto” para começar.</div>';
      return;
    }
    const filtro = $('#filtro-cat').value;
    const busca = $('#filtro-busca').value.trim().toLowerCase();
    let html = '';
    for (const g of gruposProdutos()) {
      if (filtro === '__sem' && g.id !== null) continue;
      if (filtro && filtro !== '__sem' && g.id !== filtro) continue;
      const itens = busca ? g.itens.filter((p) => p.nome.toLowerCase().includes(busca)) : g.itens;
      if (!itens.length) continue;
      html += `<div class="grupo-titulo">${esc(g.nome)}</div><ul class="lista">`;
      html += itens.map((p) => {
        const idx = g.itens.indexOf(p);
        const img = safeUrl(p.imagem_url);
        return `
        <li class="item${p.ativo ? '' : ' inativo'}" data-id="${esc(p.id)}">
          ${img ? `<img class="item-thumb" src="${esc(img)}" alt="" loading="lazy">` : '<div class="item-thumb vazio">🍢</div>'}
          <div class="item-info">
            <div class="item-nome">${esc(p.nome)}</div>
            <div class="item-meta">
              <strong>${formatBRL(p.preco)}</strong>
              ${p.destaque ? '<span class="selo selo-destaque">★ Destaque</span>' : ''}
              ${p.ativo ? '' : '<span class="selo selo-off">Indisponível</span>'}
            </div>
          </div>
          <div class="item-acoes">
            <button class="btn btn-sec btn-icon" type="button" data-acao="prod-subir" aria-label="Subir" ${idx === 0 || busca ? 'disabled' : ''}>▲</button>
            <button class="btn btn-sec btn-icon" type="button" data-acao="prod-descer" aria-label="Descer" ${idx === g.itens.length - 1 || busca ? 'disabled' : ''}>▼</button>
            <button class="btn btn-sec btn-sm" type="button" data-acao="prod-ativo">${p.ativo ? 'Pausar' : 'Ativar'}</button>
            <button class="btn btn-sec btn-sm" type="button" data-acao="prod-destaque" aria-pressed="${p.destaque}">${p.destaque ? '★ Tirar destaque' : '☆ Destacar'}</button>
            <button class="btn btn-sec btn-sm" type="button" data-acao="prod-editar">Editar</button>
            <button class="btn btn-perigo btn-sm" type="button" data-acao="prod-excluir">Excluir</button>
          </div>
        </li>`;
      }).join('');
      html += '</ul>';
    }
    box.innerHTML = html || '<div class="vazio-box">Nenhum produto encontrado com esse filtro.</div>';
  }

  // ---------------- Formulário do estabelecimento ----------------
  let logoArquivo = null;
  let logoRemover = false;

  function preencherFormEstab() {
    const e = st.atual;
    $('#estab-nome').value = e.nome_fantasia || '';
    $('#estab-slug').value = e.slug || '';
    $('#estab-boas-vindas').value = e.mensagem_boas_vindas || '';
    $('#estab-descricao').value = e.descricao || '';
    $('#estab-telefone').value = e.telefone || '';
    $('#estab-endereco').value = e.endereco || '';
    $('#estab-cor1').value = e.cor_primaria || '#D9480F';
    $('#estab-cor2').value = e.cor_secundaria || '#F2A71B';
    $('#estab-ativo').checked = !!e.ativo;
    $('#estab-logo').value = '';
    logoArquivo = null; logoRemover = false;
    mostrarPrevia('#estab-logo-previa', '#estab-logo-vazio', '#estab-logo-remover', safeUrl(e.logo_url));
    atualizarCores();
    atualizarPreviaSlug('#estab-slug', '#estab-slug-previa');
    alerta($('#msg-estab'), '');
  }

  function atualizarCores() {
    $('#estab-cor1-txt').textContent = $('#estab-cor1').value.toUpperCase();
    $('#estab-cor2-txt').textContent = $('#estab-cor2').value.toUpperCase();
  }

  function atualizarPreviaSlug(inp, out) {
    const v = $(inp).value;
    $(out).textContent = v ? `${location.host}/cardapio/${v}` : 'Use letras minúsculas, números e hífens.';
  }

  function mostrarPrevia(imgSel, vazioSel, removerSel, url) {
    const img = $(imgSel);
    img.hidden = !url;
    if (url) img.src = url; else img.removeAttribute('src');
    $(vazioSel).classList.toggle('hidden', !!url);
    $(removerSel).hidden = !url;
  }

  // ---------------- Compartilhar ----------------
  function renderCompartilhar() {
    const url = urlPublica();
    $('#comp-link').value = url;
    $('#comp-aviso').hidden = st.atual.ativo;
    const png = gerarQrPng(url);
    $('#qr-img').src = png;
    $('#qr-baixar').href = png;
    $('#qr-baixar').download = `qrcode-${st.atual.slug}.png`;
    $('#previa-frame').src = `/cardapio/${encodeURIComponent(st.atual.slug)}?preview=1&t=${Date.now()}`;
  }

  function gerarQrPng(texto) {
    const qr = window.qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount(), escala = 12, margem = 4;
    const tam = (n + margem * 2) * escala;
    const cv = document.createElement('canvas');
    cv.width = cv.height = tam;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, tam, tam);
    ctx.fillStyle = '#1C1714';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margem) * escala, (r + margem) * escala, escala, escala);
    }
    return cv.toDataURL('image/png');
  }

  // ------------------------------------------------------------------
  // Ações
  // ------------------------------------------------------------------
  function ligarEventos() {
    $$('#menu-abas [data-aba]').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aba)));
    document.addEventListener('click', (e) => {
      const ir = e.target.closest('[data-ir]');
      if (ir) { e.preventDefault(); irPara(ir.dataset.ir); }
      const fechar = e.target.closest('[data-fechar]');
      if (fechar) fechar.closest('dialog').close();
      const cp = e.target.closest('[data-copiar]');
      if (cp) copiar($(cp.dataset.copiar).value);
    });
    $$('[data-sair]').forEach((b) => b.addEventListener('click', sair));

    $('#sel-estab').addEventListener('change', (e) => selecionarEstab(e.target.value).catch((err) => toast(traduzErro(err), 'erro')));
    $('#btn-novo-estab').addEventListener('click', () => mostrarOnboarding(true));

    // Onboarding / novo estabelecimento
    $('#novo-nome').addEventListener('input', () => {
      if (!$('#novo-slug').dataset.manual) $('#novo-slug').value = slugify($('#novo-nome').value);
      atualizarPreviaSlug('#novo-slug', '#novo-slug-previa');
    });
    $('#novo-slug').addEventListener('input', (e) => {
      e.target.dataset.manual = '1';
      e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      atualizarPreviaSlug('#novo-slug', '#novo-slug-previa');
    });
    $('#form-novo-estab').addEventListener('submit', criarEstab);

    // Ajustes
    $('#estab-slug').addEventListener('input', (e) => {
      e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      atualizarPreviaSlug('#estab-slug', '#estab-slug-previa');
    });
    $('#estab-cor1').addEventListener('input', atualizarCores);
    $('#estab-cor2').addEventListener('input', atualizarCores);
    $('#estab-logo').addEventListener('change', (e) => {
      const f = e.target.files[0];
      const erro = validarImagem(f);
      if (erro) { e.target.value = ''; return toast(erro, 'erro'); }
      logoArquivo = f || null; logoRemover = false;
      mostrarPrevia('#estab-logo-previa', '#estab-logo-vazio', '#estab-logo-remover', f ? URL.createObjectURL(f) : safeUrl(st.atual.logo_url));
    });
    $('#estab-logo-remover').addEventListener('click', () => {
      logoArquivo = null; logoRemover = true; $('#estab-logo').value = '';
      mostrarPrevia('#estab-logo-previa', '#estab-logo-vazio', '#estab-logo-remover', '');
    });
    $('#form-estab').addEventListener('submit', salvarEstab);
    $('#btn-excluir-estab').addEventListener('click', excluirEstab);

    // Categorias
    $('#btn-nova-categoria').addEventListener('click', () => abrirCategoria(null));
    $('#lista-categorias').addEventListener('click', acaoCategoria);
    $('#form-categoria').addEventListener('submit', salvarCategoria);

    // Produtos
    $('#btn-novo-produto').addEventListener('click', () => abrirProduto(null));
    $('#lista-produtos').addEventListener('click', acaoProduto);
    $('#filtro-cat').addEventListener('change', renderProdutos);
    $('#filtro-busca').addEventListener('input', renderProdutos);
    $('#form-produto').addEventListener('submit', salvarProduto);
    $('#prod-img').addEventListener('change', (e) => {
      const f = e.target.files[0];
      const erro = validarImagem(f);
      if (erro) { e.target.value = ''; return toast(erro, 'erro'); }
      prodImg.arquivo = f || null; prodImg.remover = false;
      mostrarPrevia('#prod-img-previa', '#prod-img-vazio', '#prod-img-remover', f ? URL.createObjectURL(f) : safeUrl(prodImg.urlAtual));
    });
    $('#prod-img-remover').addEventListener('click', () => {
      prodImg.arquivo = null; prodImg.remover = true; $('#prod-img').value = '';
      mostrarPrevia('#prod-img-previa', '#prod-img-vazio', '#prod-img-remover', '');
    });

    $('#btn-recarregar-previa').addEventListener('click', renderCompartilhar);
    window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TITULOS[h] && h !== st.aba) irPara(h); });
  }

  async function sair() {
    await sb.auth.signOut();
    try { localStorage.removeItem(LS_KEY); } catch { /* ignora */ }
    location.replace('/login');
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); toast('Link copiado!', 'ok'); }
    catch { toast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'erro'); }
  }

  // ---------------- Estabelecimento ----------------
  async function criarEstab(e) {
    e.preventDefault();
    const msg = $('#msg-onboarding');
    const nome = $('#novo-nome').value.trim();
    const slug = $('#novo-slug').value.trim();
    if (nome.length < 2) return alerta(msg, 'Informe o nome fantasia.');
    if (slug.length < 3 || !SLUG_RE.test(slug)) return alerta(msg, 'Endereço inválido: use ao menos 3 caracteres (letras minúsculas, números e hífens).');

    const btn = e.submitter; setLoading(btn, true, 'Criando…');
    const { data, error } = await sb.from('estabelecimentos')
      .insert({ nome_fantasia: nome, slug, mensagem_boas_vindas: 'Seja bem-vindo! Confira nosso cardápio.' })
      .select().single();
    setLoading(btn, false);
    if (error) return alerta(msg, traduzErro(error));

    st.estabs.push(data);
    await selecionarEstab(data.id);
    irPara('estabelecimento');
    toast('Estabelecimento criado! Agora personalize e publique.', 'ok');
  }

  async function salvarEstab(e) {
    e.preventDefault();
    const msg = $('#msg-estab');
    alerta(msg, '');
    const dados = {
      nome_fantasia: $('#estab-nome').value.trim(),
      slug: $('#estab-slug').value.trim(),
      mensagem_boas_vindas: $('#estab-boas-vindas').value.trim() || null,
      descricao: $('#estab-descricao').value.trim() || null,
      telefone: $('#estab-telefone').value.trim() || null,
      endereco: $('#estab-endereco').value.trim() || null,
      cor_primaria: $('#estab-cor1').value.toUpperCase(),
      cor_secundaria: $('#estab-cor2').value.toUpperCase(),
      ativo: $('#estab-ativo').checked,
    };
    if (dados.nome_fantasia.length < 2) return alerta(msg, 'Informe o nome fantasia.');
    if (dados.slug.length < 3 || !SLUG_RE.test(dados.slug)) return alerta(msg, 'Endereço do cardápio inválido.');

    const btn = e.submitter || $('#form-estab [type=submit]');
    setLoading(btn, true, 'Salvando…');
    const logoAntigo = st.atual.logo_url;
    let novoLogo = null;
    try {
      if (logoArquivo) { novoLogo = await uploadImagem(st.atual.id, logoArquivo, 'logo'); dados.logo_url = novoLogo; }
      else if (logoRemover) dados.logo_url = null;

      const { data, error } = await sb.from('estabelecimentos').update(dados).eq('id', st.atual.id).select().single();
      if (error) throw error;

      if ((novoLogo || logoRemover) && logoAntigo) removerImagem(logoAntigo);
      Object.assign(st.atual, data);
      renderSeletor(); renderResumo(); preencherFormEstab();
      toast('Alterações salvas!', 'ok');
    } catch (err) {
      if (novoLogo) removerImagem(novoLogo); // desfaz upload órfão
      alerta(msg, traduzErro(err));
    } finally {
      setLoading(btn, false);
    }
  }

  async function excluirEstab() {
    const nome = st.atual.nome_fantasia;
    const conf = prompt(`Esta ação apaga o estabelecimento, todas as categorias, produtos e imagens. Não pode ser desfeita.\n\nDigite o nome "${nome}" para confirmar:`);
    if (conf === null) return;
    if (conf.trim() !== nome) return toast('Nome não confere. Nada foi excluído.', 'erro');

    const id = st.atual.id;
    try {
      // Remove as imagens da pasta do estabelecimento
      const { data: arquivos } = await sb.storage.from('imagens').list(id, { limit: 1000 });
      if (arquivos && arquivos.length) await sb.storage.from('imagens').remove(arquivos.map((a) => `${id}/${a.name}`));
      const { error } = await sb.from('estabelecimentos').delete().eq('id', id);
      if (error) throw error;
      try { localStorage.removeItem(LS_KEY); } catch { /* ignora */ }
      toast('Estabelecimento excluído.', 'ok');
      history.replaceState(null, '', '#resumo');
      st.aba = 'resumo';
      await carregarEstabs();
    } catch (err) {
      toast(traduzErro(err), 'erro');
    }
  }

  // ---------------- Ordenação (genérica) ----------------
  /** Move o item dentro da lista e regrava "ordem" apenas das linhas alteradas */
  async function reordenar(tabela, lista, idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= lista.length) return;
    [lista[idx], lista[j]] = [lista[j], lista[idx]];
    const mudancas = [];
    lista.forEach((item, i) => {
      const nova = (i + 1) * 10;
      if (item.ordem !== nova) { item.ordem = nova; mudancas.push(item); }
    });
    const res = await Promise.all(mudancas.map((it) => sb.from(tabela).update({ ordem: it.ordem }).eq('id', it.id)));
    const falha = res.find((r) => r.error);
    if (falha) { toast(traduzErro(falha.error), 'erro'); await selecionarEstab(st.atual.id); }
  }

  // ---------------- Categorias ----------------
  let catEditando = null;

  function abrirCategoria(cat) {
    catEditando = cat;
    $('#modal-categoria-titulo').textContent = cat ? 'Editar categoria' : 'Nova categoria';
    $('#cat-nome').value = cat ? cat.nome : '';
    $('#cat-descricao').value = cat ? cat.descricao || '' : '';
    $('#cat-ativo').checked = cat ? cat.ativo : true;
    alerta($('#msg-categoria'), '');
    $('#modal-categoria').showModal();
    $('#cat-nome').focus();
  }

  async function salvarCategoria(e) {
    e.preventDefault();
    const msg = $('#msg-categoria');
    const dados = {
      nome: $('#cat-nome').value.trim(),
      descricao: $('#cat-descricao').value.trim() || null,
      ativo: $('#cat-ativo').checked,
    };
    if (!dados.nome) return alerta(msg, 'Informe o nome da categoria.');

    const btn = $('#btn-salvar-categoria'); setLoading(btn, true, 'Salvando…');
    let resp;
    if (catEditando) {
      resp = await sb.from('categorias').update(dados).eq('id', catEditando.id).select().single();
    } else {
      const ordem = Math.max(0, ...st.categorias.map((c) => c.ordem)) + 10;
      resp = await sb.from('categorias').insert({ ...dados, ordem, estabelecimento_id: st.atual.id }).select().single();
    }
    setLoading(btn, false);
    if (resp.error) return alerta(msg, traduzErro(resp.error));

    if (catEditando) Object.assign(catEditando, resp.data); else st.categorias.push(resp.data);
    $('#modal-categoria').close();
    renderCategorias(); renderFiltroCategorias(); renderProdutos(); renderResumo();
    toast('Categoria salva!', 'ok');
  }

  async function acaoCategoria(e) {
    const btn = e.target.closest('[data-acao]');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    const idx = st.categorias.findIndex((c) => c.id === id);
    const cat = st.categorias[idx];
    const acao = btn.dataset.acao;

    if (acao === 'cat-editar') return abrirCategoria(cat);
    if (acao === 'cat-subir' || acao === 'cat-descer') {
      await reordenar('categorias', st.categorias, idx, acao === 'cat-subir' ? -1 : 1);
      renderCategorias(); renderFiltroCategorias(); renderProdutos();
      return;
    }
    if (acao === 'cat-ativo') {
      const { error } = await sb.from('categorias').update({ ativo: !cat.ativo }).eq('id', id);
      if (error) return toast(traduzErro(error), 'erro');
      cat.ativo = !cat.ativo; renderCategorias();
      return toast(cat.ativo ? 'Categoria visível no cardápio.' : 'Categoria ocultada.', 'ok');
    }
    if (acao === 'cat-excluir') {
      const n = st.produtos.filter((p) => p.categoria_id === id).length;
      const aviso = n ? `\n\nOs ${n} produto(s) desta categoria NÃO serão apagados: ficarão como “Sem categoria”.` : '';
      if (!confirm(`Excluir a categoria "${cat.nome}"?${aviso}`)) return;
      const { error } = await sb.from('categorias').delete().eq('id', id);
      if (error) return toast(traduzErro(error), 'erro');
      st.categorias.splice(idx, 1);
      st.produtos.forEach((p) => { if (p.categoria_id === id) p.categoria_id = null; });
      renderCategorias(); renderFiltroCategorias(); renderProdutos(); renderResumo();
      toast('Categoria excluída.', 'ok');
    }
  }

  // ---------------- Produtos ----------------
  let prodEditando = null;
  const prodImg = { arquivo: null, remover: false, urlAtual: '' };

  function abrirProduto(p) {
    prodEditando = p;
    $('#modal-produto-titulo').textContent = p ? 'Editar produto' : 'Novo produto';
    $('#prod-nome').value = p ? p.nome : '';
    $('#prod-descricao').value = p ? p.descricao || '' : '';
    $('#prod-preco').value = p ? Number(p.preco).toFixed(2).replace('.', ',') : '';
    const filtro = $('#filtro-cat').value;
    $('#prod-categoria').value = p ? p.categoria_id || '' : (filtro && filtro !== '__sem' ? filtro : '');
    $('#prod-ativo').checked = p ? p.ativo : true;
    $('#prod-destaque').checked = p ? p.destaque : false;
    $('#prod-img').value = '';
    Object.assign(prodImg, { arquivo: null, remover: false, urlAtual: p ? p.imagem_url || '' : '' });
    mostrarPrevia('#prod-img-previa', '#prod-img-vazio', '#prod-img-remover', safeUrl(prodImg.urlAtual));
    alerta($('#msg-produto'), '');
    $('#modal-produto').showModal();
    $('#prod-nome').focus();
  }

  function parsePreco(txt) {
    let s = String(txt).replace(/[R$\s]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    const n = Number(s);
    return n <= 99999999.99 ? n : NaN;
  }

  async function salvarProduto(e) {
    e.preventDefault();
    const msg = $('#msg-produto');
    const preco = parsePreco($('#prod-preco').value);
    const dados = {
      nome: $('#prod-nome').value.trim(),
      descricao: $('#prod-descricao').value.trim() || null,
      preco,
      categoria_id: $('#prod-categoria').value || null,
      ativo: $('#prod-ativo').checked,
      destaque: $('#prod-destaque').checked,
    };
    if (!dados.nome) return alerta(msg, 'Informe o nome do produto.');
    if (Number.isNaN(preco)) return alerta(msg, 'Preço inválido. Use o formato 25,90.');

    const btn = $('#btn-salvar-produto'); setLoading(btn, true, 'Salvando…');
    let novaImg = null;
    try {
      if (prodImg.arquivo) { novaImg = await uploadImagem(st.atual.id, prodImg.arquivo, 'produto'); dados.imagem_url = novaImg; }
      else if (prodImg.remover) dados.imagem_url = null;

      let resp;
      if (prodEditando) {
        // Mudou de categoria: vai para o fim da nova categoria
        if (dados.categoria_id !== prodEditando.categoria_id) dados.ordem = proximaOrdem(dados.categoria_id);
        resp = await sb.from('produtos').update(dados).eq('id', prodEditando.id).select().single();
      } else {
        resp = await sb.from('produtos')
          .insert({ ...dados, ordem: proximaOrdem(dados.categoria_id), estabelecimento_id: st.atual.id })
          .select().single();
      }
      if (resp.error) throw resp.error;

      if ((novaImg || prodImg.remover) && prodImg.urlAtual) removerImagem(prodImg.urlAtual);
      if (prodEditando) Object.assign(prodEditando, resp.data); else st.produtos.push(resp.data);
      $('#modal-produto').close();
      renderProdutos(); renderCategorias(); renderResumo();
      toast('Produto salvo!', 'ok');
    } catch (err) {
      if (novaImg) removerImagem(novaImg);
      alerta(msg, traduzErro(err));
    } finally {
      setLoading(btn, false);
    }
  }

  function proximaOrdem(catId) {
    const mesmos = st.produtos.filter((p) => (p.categoria_id || null) === catId);
    return Math.max(0, ...mesmos.map((p) => p.ordem)) + 10;
  }

  async function acaoProduto(e) {
    const btn = e.target.closest('[data-acao]');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    const p = st.produtos.find((x) => x.id === id);
    const acao = btn.dataset.acao;

    if (acao === 'prod-editar') return abrirProduto(p);
    if (acao === 'prod-subir' || acao === 'prod-descer') {
      const grupo = gruposProdutos().find((g) => g.id === (p.categoria_id || null));
      await reordenar('produtos', grupo.itens, grupo.itens.indexOf(p), acao === 'prod-subir' ? -1 : 1);
      return renderProdutos();
    }
    if (acao === 'prod-ativo' || acao === 'prod-destaque') {
      const campo = acao === 'prod-ativo' ? 'ativo' : 'destaque';
      btn.disabled = true;
      const { error } = await sb.from('produtos').update({ [campo]: !p[campo] }).eq('id', id);
      btn.disabled = false;
      if (error) return toast(traduzErro(error), 'erro');
      p[campo] = !p[campo];
      renderProdutos(); renderResumo();
      return;
    }
    if (acao === 'prod-excluir') {
      if (!confirm(`Excluir o produto "${p.nome}"? Esta ação não pode ser desfeita.`)) return;
      const { error } = await sb.from('produtos').delete().eq('id', id);
      if (error) return toast(traduzErro(error), 'erro');
      if (p.imagem_url) removerImagem(p.imagem_url);
      st.produtos = st.produtos.filter((x) => x.id !== id);
      renderProdutos(); renderCategorias(); renderResumo();
      toast('Produto excluído.', 'ok');
    }
  }
  init();
})();
