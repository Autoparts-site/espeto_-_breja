/* =====================================================================
   ESPETO & BREJA — utilitários compartilhados e cliente Supabase
   Requer: /config.js e @supabase/supabase-js (UMD) carregados antes.
   ===================================================================== */
(function () {
  'use strict';

  if (!window.APP_CONFIG || !window.supabase) {
    document.body.innerHTML = '<p class="carregando">Falha ao carregar a configuração da aplicação.</p>';
    throw new Error('APP_CONFIG ou supabase-js ausente');
  }

  const sb = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const BUCKET = 'imagens';
  const MAX_IMG_BYTES = 2 * 1024 * 1024;
  const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  /** Escapa texto para inserção segura em HTML */
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Aceita somente URLs http(s) — evita javascript: e afins */
  function safeUrl(u) {
    try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; }
  }

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatBRL = (n) => brl.format(Number(n) || 0);

  function slugify(txt) {
    return String(txt || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/&/g, ' e ')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
      .slice(0, 60).replace(/-+$/, '');
  }

  function toast(msg, tipo = '') {
    let area = document.getElementById('toast-area');
    if (!area) { area = document.createElement('div'); area.id = 'toast-area'; area.setAttribute('aria-live', 'polite'); document.body.appendChild(area); }
    const el = document.createElement('div');
    el.className = `toast ${tipo}`;
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function alerta(el, msg, tipo = 'erro') {
    if (!el) return;
    if (!msg) { el.className = 'hidden'; el.textContent = ''; return; }
    el.className = `alerta alerta-${tipo}`;
    el.textContent = msg;
  }

  /** Traduz erros comuns do Supabase para português */
  function traduzErro(err) {
    const m = (err && (err.message || err.error_description || String(err))) || 'Erro desconhecido';
    const code = err && err.code;
    if (code === '23505') return 'Já existe um registro com esse identificador. Escolha outro.';
    if (code === '23514') return 'Algum campo tem um valor inválido. Revise os dados.';
    if (code === '42501' || /row-level security/i.test(m)) return 'Você não tem permissão para esta ação.';
    const mapa = [
      [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
      [/email not confirmed/i, 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.'],
      [/user already registered/i, 'Este e-mail já está cadastrado.'],
      [/password should be at least/i, 'A senha deve ter pelo menos 8 caracteres.'],
      [/rate limit|too many/i, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
      [/same.*password/i, 'A nova senha precisa ser diferente da atual.'],
      [/failed to fetch|network/i, 'Sem conexão com o servidor. Verifique sua internet.'],
      [/jwt expired|session/i, 'Sua sessão expirou. Entre novamente.'],
      [/payload too large|exceeded the maximum/i, 'Imagem muito grande (máximo 2 MB).'],
      [/mime type/i, 'Formato de imagem não permitido. Use JPG, PNG ou WebP.'],
    ];
    for (const [re, txt] of mapa) if (re.test(m)) return txt;
    return m;
  }

  function setLoading(btn, on, txt) {
    if (!btn) return;
    if (on) { btn.dataset.txt = btn.textContent; btn.textContent = txt || 'Aguarde…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.txt || btn.textContent; btn.disabled = false; }
  }

  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  }

  /** Protege páginas administrativas: sem sessão válida → /login */
  async function requireAuth() {
    const session = await getSession();
    if (!session) { location.replace('/login?next=' + encodeURIComponent(location.pathname)); return null; }
    // Confirma o usuário junto ao servidor (não confia só no armazenamento local)
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) { await sb.auth.signOut(); location.replace('/login'); return null; }
    sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT') location.replace('/login'); });
    return data.user;
  }

  /** Em login/cadastro: se já autenticado, vai para o painel */
  async function redirectIfAuthed() {
    const s = await getSession();
    if (s) location.replace(nextUrl());
  }

  function nextUrl() {
    const n = new URLSearchParams(location.search).get('next');
    return n && /^\/[a-z0-9/-]*$/i.test(n) ? n : '/painel';
  }

  function validarImagem(file) {
    if (!file) return null;
    if (!IMG_TYPES.includes(file.type)) return 'Formato não permitido. Use JPG, PNG ou WebP.';
    if (file.size > MAX_IMG_BYTES) return 'Imagem muito grande (máximo 2 MB).';
    return null;
  }

  /** Envia imagem para imagens/<estabId>/<prefixo>-<aleatório>.<ext> e devolve a URL pública */
  async function uploadImagem(estabId, file, prefixo) {
    const erro = validarImagem(file);
    if (erro) throw new Error(erro);
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    const nome = `${estabId}/${prefixo}-${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(nome, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(nome).data.publicUrl;
  }

  /** Remove do Storage uma imagem pela URL pública (silencioso se falhar) */
  async function removerImagem(url) {
    if (!url) return;
    const marca = `/storage/v1/object/public/${BUCKET}/`;
    const i = url.indexOf(marca);
    if (i < 0) return;
    const caminho = decodeURIComponent(url.slice(i + marca.length).split('?')[0]);
    try { await sb.storage.from(BUCKET).remove([caminho]); } catch { /* ignora */ }
  }

  /** Cor de texto legível (preto/branco) sobre uma cor de fundo */
  function corSobre(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#FFFFFF';
    const n = parseInt(m[1], 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? '#1C1714' : '#FFFFFF';
  }

  const LOGO_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#D9480F"/><path d="M8 31 31 8" stroke="#FFF8EC" stroke-width="2.6" stroke-linecap="round"/><rect x="12.5" y="19.5" width="7" height="7" rx="2" transform="rotate(-45 16 23)" fill="#F2A71B"/><rect x="18.5" y="13.5" width="7" height="7" rx="2" transform="rotate(-45 22 17)" fill="#FFF8EC"/><rect x="24.5" y="7.5" width="6" height="6" rx="2" transform="rotate(-45 27.5 10.5)" fill="#F2A71B"/></svg>`;

  // Injeta o SVG da marca onde houver [data-logo]
  document.querySelectorAll('[data-logo]').forEach((el) => { el.insertAdjacentHTML('afterbegin', LOGO_SVG); });

  window.App = {
    sb, esc, safeUrl, formatBRL, slugify, toast, alerta, traduzErro, setLoading,
    getSession, requireAuth, redirectIfAuthed, nextUrl, validarImagem, uploadImagem, removerImagem, corSobre,
  };
})();
