// =====================================================================
// Tema claro / escuro.
//
// Carregado no <head> (antes do CSS pintar) pra não piscar escuro ao abrir
// já no tema claro. Guarda a escolha no navegador (localStorage) e liga a
// classe `theme-light` no <html>; as cores estão em assets/css/theme-light.css.
// O botão sol/lua fica na topbar (#btn-theme-toggle).
// =====================================================================
(function () {
  const STORAGE_KEY = "uiTheme";
  const root = document.documentElement;

  function readSaved() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function apply(theme) {
    const light = theme === "light";
    root.classList.toggle("theme-light", light);
    const btn = document.getElementById("btn-theme-toggle");
    if (btn) {
      const label = light ? "Usar tema escuro" : "Usar tema claro";
      btn.setAttribute("aria-pressed", String(light));
      btn.setAttribute("aria-label", label);
      btn.title = label;
    }
  }

  function set(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* storage indisponível */ }
    apply(theme);
  }

  apply(readSaved() === "light" ? "light" : "dark");

  function setup() {
    apply(root.classList.contains("theme-light") ? "light" : "dark");
    document.getElementById("btn-theme-toggle")?.addEventListener("click", () => {
      set(root.classList.contains("theme-light") ? "dark" : "light");
    });
  }

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", setup) : setup();

  window.setUiTheme = set;
})();
