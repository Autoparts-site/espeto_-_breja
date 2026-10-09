/* Telas de login, cadastro, recuperação e redefinição de senha */
(function () {
  'use strict';
  const { sb, alerta, traduzErro, setLoading, redirectIfAuthed, nextUrl } = window.App;
  const $ = (s) => document.querySelector(s);
  const msg = $('#mensagem');
  const pagina = document.body.dataset.pagina;

  // ---------- LOGIN ----------
  if (pagina === 'login') {
    redirectIfAuthed();
    const params = new URLSearchParams(location.search);
    if (params.get('confirmado')) alerta(msg, 'E-mail confirmado! Agora é só entrar.', 'ok');
    if (params.get('senha')) alerta(msg, 'Senha alterada com sucesso. Entre com a nova senha.', 'ok');

    $('#form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      alerta(msg, '');
      const btn = e.submitter;
      const email = $('#email').value.trim();
      const password = $('#senha').value;
      setLoading(btn, true, 'Entrando…');
      const { error } = await sb.auth.signInWithPassword({ email, password });
      setLoading(btn, false);
      if (error) return alerta(msg, traduzErro(error));
      location.replace(nextUrl());
    });
  }

  // ---------- CADASTRO ----------
  if (pagina === 'cadastro') {
    redirectIfAuthed();
    $('#form-cadastro').addEventListener('submit', async (e) => {
      e.preventDefault();
      alerta(msg, '');
      const btn = e.submitter;
      const nome = $('#nome').value.trim();
      const email = $('#email').value.trim();
      const senha = $('#senha').value;
      const conf = $('#confirmar').value;
      if (nome.length < 2) return alerta(msg, 'Informe seu nome.');
      if (senha.length < 8) return alerta(msg, 'A senha deve ter pelo menos 8 caracteres.');
      if (senha !== conf) return alerta(msg, 'As senhas não conferem.');

      setLoading(btn, true, 'Criando conta…');
      const { data, error } = await sb.auth.signUp({
        email, password: senha,
        options: { data: { nome }, emailRedirectTo: `${location.origin}/painel` },
      });
      setLoading(btn, false);
      if (error) return alerta(msg, traduzErro(error));

      if (data.session) return location.replace('/painel');
      // Confirmação por e-mail ativada no Supabase
      e.target.reset();
      e.target.classList.add('hidden');
      alerta(msg, `Conta criada! Enviamos um link de confirmação para ${email}. Abra-o para ativar sua conta.`, 'ok');
    });
  }

  // ---------- RECUPERAR SENHA ----------
  if (pagina === 'recuperar') {
    $('#form-recuperar').addEventListener('submit', async (e) => {
      e.preventDefault();
      alerta(msg, '');
      const btn = e.submitter;
      const email = $('#email').value.trim();
      setLoading(btn, true, 'Enviando…');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/nova-senha` });
      setLoading(btn, false);
      if (error) return alerta(msg, traduzErro(error));
      // Mensagem neutra: não revela se o e-mail existe
      alerta(msg, 'Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha.', 'ok');
    });
  }

  // ---------- NOVA SENHA (link do e-mail) ----------
  if (pagina === 'nova-senha') {
    const form = $('#form-nova-senha');
    let pronto = false;
    const liberar = () => { pronto = true; form.classList.remove('hidden'); alerta(msg, ''); };

    sb.auth.onAuthStateChange((evt, session) => {
      if (evt === 'PASSWORD_RECOVERY' || (session && !pronto)) liberar();
    });
    sb.auth.getSession().then(({ data }) => { if (data.session) liberar(); });
    setTimeout(() => {
      if (!pronto) alerta(msg, 'Link inválido ou expirado. Solicite uma nova recuperação de senha.');
    }, 3500);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      const senha = $('#senha').value;
      if (senha.length < 8) return alerta(msg, 'A senha deve ter pelo menos 8 caracteres.');
      if (senha !== $('#confirmar').value) return alerta(msg, 'As senhas não conferem.');
      setLoading(btn, true, 'Salvando…');
      const { error } = await sb.auth.updateUser({ password: senha });
      setLoading(btn, false);
      if (error) return alerta(msg, traduzErro(error));
      await sb.auth.signOut();
      location.replace('/login?senha=1');
    });
  }
})();
