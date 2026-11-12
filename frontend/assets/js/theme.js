// =====================================================================
// Temas da interface (seletor em lista na topbar, igual ao de idioma).
//
// Carregado no <head> (antes do CSS pintar) pra não piscar o tema errado
// ao abrir. Guarda a escolha no navegador (localStorage "uiTheme") e marca
// o <html> com:
//   data-theme="<id>"  → paleta (variáveis --sk-* em assets/css/themes.css)
//   .theme-skin        → qualquer tema que não seja o escuro padrão
//   .theme-light       → família clara (logos invertidas, color-scheme)
// "system" segue o claro/escuro do sistema operacional e acompanha a troca.
//
// Pra criar um tema: paleta em themes.css + entrada em THEMES abaixo +
// botão em #topbar-theme-menu (index.html) + "ui.themes.<id>" nos idiomas.
// =====================================================================
(function () {
  const STORAGE_KEY = "uiTheme";
  const DEFAULT_THEME = "dark";
  const root = document.documentElement;

  // family: "dark" | "light" · skin: usa a camada de themes.css · meta: cor da barra do navegador (PWA)
  const THEMES = {
    system:   { family: null },
    dark:     { family: "dark",  skin: false, meta: "#060B10" },
    graphite: { family: "dark",  skin: true,  meta: "#1C1F23" },
    ocean:    { family: "dark",  skin: true,  meta: "#0B1626" },
    light:    { family: "light", skin: true,  meta: "#FFFFFF" },
    sand:     { family: "light", skin: true,  meta: "#FBF7EF" },
    field:    { family: "light", skin: true,  meta: "#FFFFFF" },
  };

  const systemQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  let current = DEFAULT_THEME; // o que o usuário escolheu (pode ser "system")

  function readSaved() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v && THEMES[v] ? v : null;
    } catch (e) { return null; }
  }

  // "system" vira "light" ou "dark" na hora de pintar
  function resolve(id) {
    if (id !== "system") return id;
    return systemQuery && systemQuery.matches ? "light" : "dark";
  }

  function paint(id) {
    const resolved = resolve(id);
    const cfg = THEMES[resolved] || THEMES[DEFAULT_THEME];
    root.dataset.theme = resolved;
    root.classList.toggle("theme-skin", !!cfg.skin);
    root.classList.toggle("theme-light", cfg.family === "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", cfg.meta);
    syncMenu();
  }

  function set(id, { animate = true } = {}) {
    if (!THEMES[id]) id = DEFAULT_THEME;
    current = id;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* storage indisponível */ }

    // Transição suave só na troca feita pelo usuário (nunca ao abrir a página)
    if (animate) {
      root.classList.add("theme-switching");
      clearTimeout(set._t);
      set._t = setTimeout(() => root.classList.remove("theme-switching"), 350);
    }
    paint(id);
    document.dispatchEvent(new CustomEvent("theme:changed", { detail: { theme: id, resolved: resolve(id) } }));
  }

  // Pinta já no <head>
  current = readSaved() || DEFAULT_THEME;
  paint(current);

  // Tema "Sistema": acompanha quando o SO troca claro/escuro
  systemQuery?.addEventListener?.("change", () => { if (current === "system") paint("system"); });

  // ---------- Menu (botão + lista) ----------
  function syncMenu() {
    const menu = document.getElementById("topbar-theme-menu");
    if (!menu) return;
    let activeBtn = null;
    menu.querySelectorAll("[data-theme-option]").forEach((btn) => {
      const on = btn.dataset.themeOption === current;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", String(on));
      if (on) activeBtn = btn;
    });
    if (!activeBtn) return;
    const label = activeBtn.querySelector(".theme-option-label")?.textContent?.trim() || "";
    const nameEl = document.getElementById("topbar-theme-name");
    const swatchEl = document.getElementById("topbar-theme-swatch");
    const toggle = document.getElementById("topbar-theme-toggle");
    if (nameEl) nameEl.textContent = label;
    if (swatchEl) swatchEl.dataset.swatch = current;
    if (toggle) {
      const prefix = typeof window.t === "function" ? window.t("ui.labels.theme") : "";
      const full = prefix && prefix !== "ui.labels.theme" ? `${prefix}: ${label}` : label;
      toggle.title = full;
      toggle.setAttribute("aria-label", full);
    }
  }

  function setup() {
    const group = document.getElementById("topbar-group-theme");
    const toggle = document.getElementById("topbar-theme-toggle");
    const menu = document.getElementById("topbar-theme-menu");
    if (!group || !toggle || !menu || toggle.dataset.bound) return;
    toggle.dataset.bound = "1";

    const items = () => Array.from(menu.querySelectorAll("[data-theme-option]"));

    const setOpen = (open, { focus = false } = {}) => {
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      group.classList.toggle("open", open);
      if (open && focus) (menu.querySelector(".active") || items()[0])?.focus();
    };

    toggle.addEventListener("click", () => setOpen(menu.hidden));

    toggle.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true, { focus: true });
      }
    });

    menu.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-theme-option]");
      if (!btn) return;
      set(btn.dataset.themeOption);
      setOpen(false);
      toggle.focus();
    });

    // Setas pra navegar, Home/End, Esc fecha e volta o foco pro botão
    menu.addEventListener("keydown", (event) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      const go = (n) => { event.preventDefault(); list[(n + list.length) % list.length]?.focus(); };
      if (event.key === "ArrowDown") go(i + 1);
      else if (event.key === "ArrowUp") go(i - 1);
      else if (event.key === "Home") go(0);
      else if (event.key === "End") go(list.length - 1);
      else if (event.key === "Tab") setOpen(false);
    });

    // Captura: fecha mesmo quando o clique cai num botão que para a
    // propagação (ex.: o botão de idioma do lado).
    document.addEventListener("click", (event) => {
      !menu.hidden && !group.contains(event.target) && setOpen(false);
    }, true);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        setOpen(false);
        toggle.focus();
      }
    });

    syncMenu();
  }

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", setup) : setup();

  // Troca de idioma: refaz o nome do tema no botão
  document.addEventListener("i18n:applied", syncMenu);

  window.setUiTheme = (id) => set(id);
  window.getUiTheme = () => ({ theme: current, resolved: resolve(current) });
})();
