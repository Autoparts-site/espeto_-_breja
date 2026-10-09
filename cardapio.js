/* =====================================================================
   ESPETO & BREJA — Cardápio público  (/cardapio/<slug>)
   Visitantes: função cardapio_publico() (somente dados públicos).
   Dono logado com ?preview=1: lê os próprios dados (RLS) mesmo sem publicar.
   ===================================================================== */
(function () {
  'use strict';
  const { sb, esc, safeUrl, formatBRL, corSobre } = window.App;
  const $ = (s) => document.querySelector(s);

  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '').toLowerCase();
  const preview = new URLSearchParams(location.search).get('preview') === '1';

  const ICON_WPP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3z"/></svg>';
  const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';

  carregar();

  async function carregar() {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return naoEncontrado();
    try {
      let dados = null;
      if (preview) dados = await carregarComoDono();
      if (!dados) {
        const { data, error } = await sb.rpc('cardapio_publico', { p_slug: slug });
        if (error) throw error;
        dados = data;
      }
      if (!dados) return naoEncontrado();
      render(dados);
    } catch (err) {
      console.error(err);
      naoEncontrado();
    }
  }

  /** Pré-visualização para o dono: as políticas RLS só retornam se ele for o proprietário */
  async function carregarComoDono() {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return null;
    const { data: e } = await sb.from('estabelecimentos').select('*').eq('slug', slug).maybeSingle();
    if (!e) return null;
    const [cats, prods] = await Promise.all([
      sb.from('categorias').select('id,nome,descricao,ativo').eq('estabelecimento_id', e.id).order('ordem').order('nome'),
      sb.from('produtos').select('id,categoria_id,nome,descricao,preco,imagem_url,ativo,destaque').eq('estabelecimento_id', e.id).order('ordem').order('nome'),
    ]);
    if (cats.error || prods.error) return null;
    const ativas = cats.data.filter((c) => c.ativo);
    const idsAtivas = new Set(ativas.map((c) => c.id));
    if (!e.ativo) $('#faixa-preview').classList.remove('hidden');
    return {
      estabelecimento: e,
      categorias: ativas,
      produtos: prods.data
        .filter((p) => !p.categoria_id || idsAtivas.has(p.categoria_id))
        .map((p) => ({ ...p, disponivel: p.ativo })),
    };
  }

  function naoEncontrado() {
    document.title = 'Cardápio não encontrado';
    $('#carregando').classList.add('hidden');
    $('#cardapio').classList.add('hidden');
    $('#nao-encontrado').classList.remove('hidden');
  }

  // ------------------------------------------------------------------
  function render({ estabelecimento: e, categorias, produtos }) {
    // Identidade visual do estabelecimento
    const root = document.documentElement.style;
    const c1 = /^#[0-9a-f]{6}$/i.test(e.cor_primaria) ? e.cor_primaria : '#D9480F';
    const c2 = /^#[0-9a-f]{6}$/i.test(e.cor_secundaria) ? e.cor_secundaria : '#F2A71B';
    const on = corSobre(c1);
    root.setProperty('--brand', c1);
    root.setProperty('--brand-2', c2);
    root.setProperty('--on-brand', on);
    document.body.classList.toggle('claro', on !== '#FFFFFF');
    document.querySelector('meta[name=theme-color]').setAttribute('content', c1);
    document.title = `${e.nome_fantasia} · Cardápio`;

    // Cabeçalho
    $('#m-nome').textContent = e.nome_fantasia;
    const logo = safeUrl(e.logo_url);
    if (logo) { $('#m-logo').src = logo; $('#m-logo').alt = `Logo ${e.nome_fantasia}`; $('#m-logo').classList.remove('hidden'); }
    else { $('#m-logo-vazio').textContent = e.nome_fantasia.trim().charAt(0).toUpperCase(); $('#m-logo-vazio').classList.remove('hidden'); }
    $('#m-boas-vindas').textContent = e.mensagem_boas_vindas || '';
    $('#m-descricao').textContent = e.descricao || '';

    const contatos = [];
    const dig = String(e.telefone || '').replace(/\D/g, '');
    if (dig.length >= 10) {
      const wpp = dig.length <= 11 ? '55' + dig : dig;
      contatos.push(`<a href="https://wa.me/${wpp}" target="_blank" rel="noopener">${ICON_WPP}${esc(e.telefone)}</a>`);
    } else if (e.telefone) contatos.push(`<span>${esc(e.telefone)}</span>`);
    if (e.endereco) {
      contatos.push(`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.endereco)}" target="_blank" rel="noopener">${ICON_PIN}${esc(e.endereco)}</a>`);
    }
    $('#m-contatos').innerHTML = contatos.join('');

    // Seções
    const secoes = [];
    const destaques = produtos.filter((p) => p.destaque && p.disponivel);
    if (destaques.length) secoes.push({ id: 'destaques', nome: '★ Destaques', tipo: 'destaques', itens: destaques });
    categorias.forEach((c) => {
      const itens = produtos.filter((p) => p.categoria_id === c.id);
      if (itens.length) secoes.push({ id: `cat-${c.id}`, nome: c.nome, descricao: c.descricao, itens });
    });
    const semCat = produtos.filter((p) => !p.categoria_id);
    if (semCat.length) secoes.push({ id: 'outros', nome: secoes.length ? 'Outros' : 'Cardápio', itens: semCat });

    $('#m-nav').innerHTML = secoes.map((s) => `<a href="#${esc(s.id)}">${esc(s.nome)}</a>`).join('');
    $('#m-conteudo').innerHTML = secoes.length
      ? secoes.map(renderSecao).join('')
      : '<div class="vazio-box">O cardápio está sendo preparado. Volte em breve! 🔥</div>';
    if (secoes.length < 2) $('.menu-nav').classList.add('hidden');

    $('#carregando').classList.add('hidden');
    $('#cardapio').classList.remove('hidden');

    ligarBusca();
    ligarNavAtiva();
  }

  function renderSecao(s) {
    if (s.tipo === 'destaques') {
      return `<section class="menu-secao" id="${esc(s.id)}" data-secao>
        <h2>${esc(s.nome)}</h2>
        <div class="destaques">${s.itens.map((p) => {
          const img = safeUrl(p.imagem_url);
          return `<article class="destaque" data-busca="${esc(textoBusca(p))}">
            ${img ? `<img src="${esc(img)}" alt="${esc(p.nome)}" loading="lazy">` : '<div class="sem-img"></div>'}
            <div class="corpo"><h3>${esc(p.nome)}</h3><span class="preco">${formatBRL(p.preco)}</span></div>
          </article>`;
        }).join('')}</div>
      </section>`;
    }
    return `<section class="menu-secao" id="${esc(s.id)}" data-secao>
      <h2>${esc(s.nome)}</h2>
      ${s.descricao ? `<p>${esc(s.descricao)}</p>` : ''}
      <div class="menu-grade">${s.itens.map(renderPrato).join('')}</div>
    </section>`;
  }

  function renderPrato(p) {
    const img = safeUrl(p.imagem_url);
    const indisp = !p.disponivel;
    return `<article class="prato${img ? '' : ' sem-foto'}${indisp ? ' indisponivel' : ''}" data-busca="${esc(textoBusca(p))}">
      <div class="prato-info">
        ${indisp ? '<span class="tag-indisp">Indisponível no momento</span>' : ''}
        <h3>${esc(p.nome)}</h3>
        ${p.descricao ? `<p>${esc(p.descricao)}</p>` : ''}
        <span class="preco"${indisp ? ' aria-label="Indisponível"' : ''}>${formatBRL(p.preco)}</span>
      </div>
      ${img ? `<img src="${esc(img)}" alt="${esc(p.nome)}" loading="lazy">` : ''}
    </article>`;
  }

  function textoBusca(p) {
    return `${p.nome} ${p.descricao || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function ligarBusca() {
    const input = $('#m-busca');
    input.addEventListener('input', () => {
      const q = input.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      document.querySelectorAll('[data-secao]').forEach((sec) => {
        let visiveis = 0;
        sec.querySelectorAll('[data-busca]').forEach((el) => {
          const ok = !q || el.dataset.busca.includes(q);
          el.classList.toggle('hidden', !ok);
          if (ok) visiveis++;
        });
        sec.classList.toggle('hidden', visiveis === 0);
      });
    });
  }

  function ligarNavAtiva() {
    const links = [...document.querySelectorAll('#m-nav a')];
    if (!links.length || !('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => {
          const ativo = a.getAttribute('href') === `#${en.target.id}`;
          a.classList.toggle('ativo', ativo);
          if (ativo) a.parentElement.scrollTo({ left: a.offsetLeft - a.parentElement.clientWidth / 2 + a.clientWidth / 2, behavior: 'smooth' });
        });
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    document.querySelectorAll('[data-secao]').forEach((s) => obs.observe(s));
  }
})();
