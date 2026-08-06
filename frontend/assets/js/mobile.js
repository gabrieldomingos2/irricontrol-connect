// assets/js/mobile.js
//
// Camada de comportamento do layout mobile (assets/css/mobile.css).
// Não depende de nenhum módulo do dist/app.bundle.js nem do
// dist/main-modules.bundle.js e não expõe nada em `window` além de
// si mesmo -- é seguro carregar em qualquer ordem depois deles.
//
// No desktop os elementos que este script cria/manipula ficam
// `display:none` (ver mobile.css) e os elementos que ele realoca
// são devolvidos ao lugar original assim que a tela deixa de ser
// mobile — então nada aqui deve alterar a versão desktop.
//
// IMPORTANTE: o breakpoint abaixo (MOBILE_BREAKPOINT) precisa ficar
// igual ao `@media (max-width: ...)` usado em assets/css/mobile.css.
// Os dois vivem em arquivos diferentes por natureza (CSS não lê
// constantes JS), então uma mudança num precisa ser replicada no
// outro manualmente.

(function () {
  // Exposto em window pra feature.pivots.js (isMobileDrawMode, em
  // main-modules.bundle.js, que carrega depois) usar o MESMO valor em
  // vez de repetir o número mágico — sobra só um lugar (+ o
  // `@media (max-width: 768px)` em mobile.css, que CSS não tem como
  // ler de JS) pra manter em sincronia.
  const MOBILE_BREAKPOINT = window.MOBILE_BREAKPOINT || (window.MOBILE_BREAKPOINT = 768);

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function isMobileViewport() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  // -----------------------------------------------------------
  // Um único listener de "resize" despacha para todo mundo que
  // precisa reagir à troca mobile <-> desktop, em vez de cada
  // feature registrar o seu próprio.
  // -----------------------------------------------------------
  const resizeSubscribers = [];
  function onViewportChange(cb) {
    resizeSubscribers.push(cb);
  }
  window.addEventListener("resize", function () {
    resizeSubscribers.forEach(function (cb) {
      try {
        cb();
      } catch (err) {
        console.error("[mobile.js] erro num callback de resize:", err);
      }
    });
  });

  // -----------------------------------------------------------
  // createRelocatableElement: move um elemento de verdade (não um
  // clone — appendChild preserva os listeners já ligados pelo
  // bundle) entre o lugar original dele no DOM e um "destino
  // mobile", conforme o tamanho da tela e uma condição extra
  // opcional (ex.: só quando o elemento está visível).
  //
  // Por que mover o nó de verdade em vez de só reposicionar via
  // CSS: alguns desses elementos vivem dentro do drawer da sidebar
  // (#sidebar-left), que usa `transform` pra deslizar — e um
  // elemento dentro de um ancestral com transform não consegue
  // "escapar" dele nem com position:fixed. Tirar o nó do DOM e
  // colocar em outro pai resolve isso sem duplicar HTML nem IDs.
  //
  // options:
  //   getMobileParent()      -> elemento pai no destino mobile
  //   shouldFloat()           -> (opcional) condição extra, além do
  //                              breakpoint, pra decidir se flutua
  //   placeInMobileParent(el, mobileParent) -> (opcional) como
  //                              inserir no destino; padrão é
  //                              appendChild
  //
  // Retorna a função de sincronização (útil pra chamar de novo a
  // partir de um MutationObserver, por exemplo).
  // -----------------------------------------------------------
  function createRelocatableElement(el, options) {
    if (!el) return function noop() {};

    const getMobileParent = options.getMobileParent;
    const shouldFloat = options.shouldFloat || function () { return true; };
    const placeInMobileParent = options.placeInMobileParent || function (node, parent) {
      if (node.parentNode !== parent) parent.appendChild(node);
    };

    const originalParent = el.parentNode;
    const originalNext = el.nextSibling;

    function restoreToOriginalPlace() {
      if (el.parentNode === originalParent) return;
      if (originalNext && originalNext.parentNode === originalParent) {
        originalParent.insertBefore(el, originalNext);
      } else {
        originalParent.appendChild(el);
      }
    }

    function sync() {
      const mobileParent = typeof getMobileParent === "function" ? getMobileParent() : getMobileParent;
      if (isMobileViewport() && mobileParent && shouldFloat()) {
        placeInMobileParent(el, mobileParent);
      } else {
        restoreToOriginalPlace();
      }
    }

    onViewportChange(sync);
    sync();
    return sync;
  }

  ready(function () {
    const toggleBtn = document.getElementById("mobile-menu-toggle");
    const closeBtn = document.getElementById("sidebar-mobile-close");
    const backdrop = document.getElementById("mobile-drawer-backdrop");
    const sidebar = document.getElementById("sidebar-left");

    if (!toggleBtn || !sidebar || !backdrop) return;

    // ---------------------------------------------------------
    // Drawer da sidebar (abrir/fechar)
    // ---------------------------------------------------------
    function openDrawer() {
      sidebar.classList.add("mobile-open");
      backdrop.classList.add("mobile-open");
      toggleBtn.setAttribute("aria-expanded", "true");
    }

    function closeDrawer() {
      sidebar.classList.remove("mobile-open");
      backdrop.classList.remove("mobile-open");
      toggleBtn.setAttribute("aria-expanded", "false");
    }

    toggleBtn.addEventListener("click", function () {
      if (sidebar.classList.contains("mobile-open")) closeDrawer();
      else openDrawer();
    });

    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", closeDrawer);

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeDrawer();
    });

    // Evita o drawer ficar "preso" aberto se a tela for rotacionada /
    // redimensionada pra um tamanho desktop.
    onViewportChange(function () {
      if (!isMobileViewport()) closeDrawer();
    });

    // Fecha o drawer automaticamente ao selecionar uma ação na sidebar
    // (upload, busca, template etc.), pra não cobrir o mapa depois.
    sidebar.addEventListener("click", function (ev) {
      const el = ev.target.closest("button, a, label");
      if (el && el.id !== "sidebar-mobile-close") closeDrawer();
    });

    // ---------------------------------------------------------
    // Painel de configuração de repetidora (#painel-repetidora):
    // flutua acima do slider de opacidade só enquanto estiver
    // visível (o app controla isso via classList "hidden").
    // ---------------------------------------------------------
    const repPanel = document.getElementById("painel-repetidora");
    if (repPanel) {
      const syncRepPanel = createRelocatableElement(repPanel, {
        getMobileParent: function () { return document.body; },
        shouldFloat: function () { return !repPanel.classList.contains("hidden"); },
      });
      new MutationObserver(syncRepPanel).observe(repPanel, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    // ---------------------------------------------------------
    // Botão "Baixar Arquivo KMZ" (#exportar-btn): direto na barra
    // inferior (não mais dentro do menu de ferramentas), do lado
    // oposto ao botão que abre o menu.
    // ---------------------------------------------------------
    const exportBtn = document.getElementById("exportar-btn");
    const toolbar = document.getElementById("mobile-bottom-toolbar");
    if (exportBtn && toolbar) {
      createRelocatableElement(exportBtn, {
        getMobileParent: function () { return toolbar; },
      });
    }

    // ---------------------------------------------------------
    // Slider de opacidade (#opacity-control): direto na barra
    // inferior, à esquerda do botão "Editar".
    // ---------------------------------------------------------
    const opacityControl = document.getElementById("opacity-control");
    if (opacityControl && toolbar) {
      createRelocatableElement(opacityControl, {
        getMobileParent: function () { return toolbar; },
        placeInMobileParent: function (node, parent) {
          if (parent.firstChild !== node) {
            parent.insertBefore(node, parent.firstChild);
          }
        },
      });
    }

    // ---------------------------------------------------------
    // Botão de logout (#btn-logout): fica no rodapé do drawer da
    // sidebar em vez da topbar.
    // ---------------------------------------------------------
    const logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) {
      createRelocatableElement(logoutBtn, {
        getMobileParent: function () { return sidebar; },
      });
    }

    // ---------------------------------------------------------
    // Menu de ferramentas (Desenho + Editor): o botão "lápis" da
    // barra de baixo É o próprio "Editar Pivôs" (clica de verdade
    // em #editar-pivos, que liga/desliga o modo de edição via
    // togglePivoEditing em ui.js) — por isso o lápis duplicado
    // dentro do menu fica escondido (ver mobile.css).
    //
    // MAS o menu abrir/fechar é independente do estado de edição:
    // desenhar um pivô no mapa desliga a edição por baixo dos panos
    // (deactivateAllModes, lógica que já existia no app) e liga de
    // novo sozinho quando o pivô é criado — se o menu seguisse esse
    // estado à risca, ficaria piscando fechado/aberto a cada pivô
    // desenhado. Em vez disso, o menu só fecha quando o usuário
    // toca no lápis de novo, de propósito.
    // ---------------------------------------------------------
    const toolsToggle = document.getElementById("mobile-tools-toggle");
    const toolsFlyout = document.getElementById("mobile-tools-flyout");
    const editarPivosBtn = document.getElementById("editar-pivos");
    if (toolsToggle && toolbar && toolsFlyout && editarPivosBtn) {
      function openTools() {
        toolbar.classList.add("tools-open");
        toolsToggle.classList.add("tools-active");
        toolsToggle.setAttribute("aria-expanded", "true");
      }

      function closeTools() {
        toolbar.classList.remove("tools-open");
        toolsToggle.classList.remove("tools-active");
        toolsToggle.setAttribute("aria-expanded", "false");
      }

      function toggleToolsAndEditing() {
        if (toolbar.classList.contains("tools-open")) {
          closeTools();
          // Fechando de propósito: desliga a edição também, se
          // ainda estiver ligada.
          editarPivosBtn.classList.contains("glass-button-active") && editarPivosBtn.click();
        } else {
          openTools();
          editarPivosBtn.classList.contains("glass-button-active") || editarPivosBtn.click();
        }
      }

      // Em touch, o navegador às vezes dispara um "click" fantasma
      // ~300ms depois do toque real (compatibilidade com sites sem
      // suporte a touch) — sem tratar isso, um único toque no lápis
      // rodava a função duas vezes (ligava e desligava a edição em
      // sequência, "piscando"). touchend trata o toque de verdade e
      // marca a flag; o "click" que vier depois pro MESMO toque é
      // ignorado. Mouse/teclado continuam funcionando via "click".
      let handledByTouch = false;

      toolsToggle.addEventListener("touchend", function (ev) {
        handledByTouch = true;
        ev.preventDefault();
        toggleToolsAndEditing();
      }, { passive: false });

      toolsToggle.addEventListener("click", function () {
        if (handledByTouch) {
          handledByTouch = false;
          return;
        }
        toggleToolsAndEditing();
      });

      // Se a tela virar desktop no meio do caminho, só fecha o
      // menu visualmente — o modo de edição continua funcionando
      // normal por lá, do jeito de sempre.
      onViewportChange(function () {
        if (!isMobileViewport()) closeTools();
      });
    }

  });
})();
