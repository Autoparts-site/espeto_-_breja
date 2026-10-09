(function () {
  'use strict';
  document.getElementById('ano').textContent = new Date().getFullYear();
  // Usuário já logado: troca os botões por "Ir para o painel"
  window.App.getSession().then((s) => {
    if (!s) return;
    document.getElementById('link-entrar').classList.add('hidden');
    const cta = document.getElementById('link-cta');
    cta.textContent = 'Ir para o painel';
    cta.href = '/painel';
  });
})();
