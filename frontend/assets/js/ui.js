const mensagemDiv = document.getElementById("mensagem");
const loaderDiv = document.getElementById("loader");
const painelDadosDiv = document.getElementById("painel-dados");
const painelRepetidorasDiv = document.getElementById("painel-repetidoras");
const painelConfigRepetidoraDiv = document.getElementById("painel-repetidora");
const rangeOpacidade = document.getElementById("range-opacidade");
const templateSelect = document.getElementById("template-modelo");
const arquivoInput = document.getElementById("arquivo");
const nomeArquivoLabel = document.getElementById("nome-arquivo-label");
const legendContainer = document.getElementById("legend-container");
const legendImage = document.getElementById("legend-image");
const customConfirmOverlay = document.getElementById("custom-confirm-overlay");
const customConfirmBox = document.getElementById("custom-confirm-box");
const customConfirmTitle = document.getElementById("custom-confirm-title");
const customConfirmMessage = document.getElementById("custom-confirm-message");
const customConfirmOkBtn = document.getElementById("custom-confirm-ok-btn");
const customConfirmCancelBtn = document.getElementById("custom-confirm-cancel-btn");
const btnMoverPivoSemCirculo = document.getElementById("btn-mover-pivo-sem-circulo");

let dicaLoaderInterval = null;
let _hideMsgTimer = null;

function showOverlay(el, { column = false, center = true } = {}) {
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("flex");
  column && el.classList.add("flex-col");
  center && el.classList.add("items-center", "justify-center");
}

function hideOverlay(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("flex", "flex-col", "items-center", "justify-center");
}

function ensureAppState() {
  window.AppState || (window.AppState = {});
  const state = window.AppState;
  state.lastPivosDataDrawn ??= [];
  state.lastBombasDataDrawn ??= [];
  state.repetidoras ??= [];
  state.templateSelecionado ??= "";
  state.legendasAtivas ??= true;
  state.antenaLegendasAtivas ??= true;
  state.modoEdicaoPivos ??= false;
  state.templateOverrideEnabled ??= false;
}

function showCustomConfirm(message, title = t("ui.titles.confirm_needed")) {
  if (!customConfirmOverlay) return Promise.resolve(false);

  customConfirmTitle.innerHTML = `<i data-lucide="shield-question" class="w-6 h-6"></i> ${title}`;
  lucide?.createIcons?.();
  customConfirmMessage.textContent = message;
  showOverlay(customConfirmOverlay);

  return new Promise((resolve) => {
    let settled = false;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      hideOverlay(customConfirmOverlay);
      customConfirmOkBtn?.removeEventListener("click", onOk);
      customConfirmCancelBtn?.removeEventListener("click", onCancel);
      customConfirmOverlay?.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeyDown);
      resolve(result);
    };

    const onOk = () => settle(true);
    const onCancel = () => settle(false);
    const onOverlayClick = (event) => {
      event.target === customConfirmOverlay && settle(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        settle(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      }
    };

    customConfirmOkBtn?.addEventListener("click", onOk);
    customConfirmCancelBtn?.addEventListener("click", onCancel);
    customConfirmOverlay?.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

function mostrarMensagem(message, type = "sucesso") {
  if (!mensagemDiv) return;

  _hideMsgTimer && (clearTimeout(_hideMsgTimer), _hideMsgTimer = null);

  mensagemDiv.className = "fixed bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-x-3 text-white px-4 py-3 rounded-lg shadow-lg border-l-4 bg-gray-800/90 z-[10000]";
  mensagemDiv.removeAttribute("hidden");
  mensagemDiv.classList.remove("hidden");
  mensagemDiv.setAttribute("role", "status");
  mensagemDiv.setAttribute("aria-live", "polite");

  let icon = "";
  let borderClass = "";
  if (type === "sucesso") {
    icon = '<i data-lucide="check-circle-2" class="w-5 h-5 text-green-400"></i>';
    borderClass = "border-green-400";
  } else if (type === "erro") {
    icon = '<i data-lucide="alert-triangle" class="w-5 h-5 text-red-500"></i>';
    borderClass = "border-red-500";
  } else {
    icon = '<i data-lucide="info" class="w-5 h-5 text-yellow-400"></i>';
    borderClass = "border-yellow-400";
  }

  mensagemDiv.classList.add(borderClass);
  mensagemDiv.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  lucide?.createIcons?.();

  _hideMsgTimer = setTimeout(() => {
    mensagemDiv.classList.add("hidden");
  }, 4000);
}

function mostrarLoader(show, hint = "") {
  if (!loaderDiv) return;

  dicaLoaderInterval && (clearInterval(dicaLoaderInterval), dicaLoaderInterval = null);

  show ? showOverlay(loaderDiv, { column: true }) : hideOverlay(loaderDiv);
  document.body.style.cursor = show ? "progress" : "";

  const hintSpan = loaderDiv.querySelector('span[data-i18n="ui.labels.processing"]');
  if (!hintSpan) return;

  hintSpan.style.transition = "opacity 0.4s ease-in-out";

  if (!show) {
    hintSpan.textContent = t("ui.labels.processing");
    hintSpan.style.opacity = 1;
    return;
  }

  if (Array.isArray(hint) && hint.length) {
    let hintIndex = 0;
    hintSpan.textContent = hint[hintIndex];
    hintSpan.style.opacity = 1;
    dicaLoaderInterval = setInterval(() => {
      hintIndex = (hintIndex + 1) % hint.length;
      hintSpan.style.opacity = 0;
      setTimeout(() => {
        hintSpan.textContent = hint[hintIndex];
        hintSpan.style.opacity = 1;
      }, 400);
    }, 6500);
  } else if (typeof hint == "string" && hint) {
    hintSpan.textContent = hint;
    hintSpan.style.opacity = 1;
  } else {
    hintSpan.textContent = t("ui.labels.processing");
    hintSpan.style.opacity = 1;
  }
}

function updateLegendImage(templateId) {
  if (!legendContainer || !legendImage || !templateId) return;

  const normalized = String(templateId).toLowerCase();
  const match = [
    { test: /brazil[_-\s]?v6[_-\s]?100dbm/i, path: "assets/images/IRRICONTRO.dBm.key.png" },
    { test: /brazil[_-\s]?v6[_-\s]?90dbm/i, path: "assets/images/CONTROL90.dBm.key.png" },
    { test: /europe[_-\s]?v6/i, path: "assets/images/IRRIEUROPE.dBm.key.png" }
  ].find((entry) => entry.test.test(normalized));

  if (!match) {
    legendContainer.classList.add("hidden");
    legendImage.removeAttribute("src");
    return;
  }

  legendImage.onerror = () => {
    legendContainer.classList.add("hidden");
  };
  legendImage.onload = () => {
    legendContainer.classList.remove("hidden");
  };
  legendImage.src = match.path;
}

// Modo de captura de tela: esconde toda a UI ao redor (sidebar,
// topbar, painéis, barra do mobile) via a classe "screenshot-mode" no
// <body> (ver style.css) e, quando o navegador suporta, também pede
// tela cheia de verdade (Fullscreen API) pra esconder a barra de
// endereço no celular. Em navegadores sem suporte (ex.: Safari no
// iPhone, que só permite Fullscreen API em <video>) o pedido falha
// silenciosamente e o modo continua funcionando só com o CSS.
function toggleScreenshotMode() {
  const active = document.body.classList.toggle("screenshot-mode");
  const btn = document.getElementById("btn-screenshot-mode");

  if (active) {
    try {
      const requestFs = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      requestFs && requestFs.call(document.documentElement)?.catch?.(() => {});
    } catch (err) {
      // Ambiente sem suporte real a Fullscreen API — sem problema,
      // o modo já funciona só com CSS.
    }
    if (btn) {
      btn.innerHTML = '<i data-lucide="minimize" class="w-5 h-5"></i>';
      btn.title = t("ui.titles.screenshot_mode_off");
      btn.setAttribute("aria-label", t("ui.titles.screenshot_mode_off"));
      btn.setAttribute("aria-pressed", "true");
    }
  } else {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try {
        const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
        exitFs && exitFs.call(document)?.catch?.(() => {});
      } catch (err) {}
    }
    if (btn) {
      btn.innerHTML = '<i data-lucide="maximize" class="w-5 h-5"></i>';
      btn.title = t("ui.titles.screenshot_mode");
      btn.setAttribute("aria-label", t("ui.titles.screenshot_mode"));
      btn.setAttribute("aria-pressed", "false");
    }
  }

  lucide?.createIcons?.();
}

// Se o usuário sair da tela cheia por fora do botão (ESC, gesto de
// voltar do celular, Safari antigo com prefixo webkit etc.), desliga
// o modo de captura junto em vez de deixar a UI escondida com o mapa
// não mais em tela cheia.
function handleFullscreenExit() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement && document.body.classList.contains("screenshot-mode")) {
    toggleScreenshotMode();
  }
}
document.addEventListener("fullscreenchange", handleFullscreenExit);
document.addEventListener("webkitfullscreenchange", handleFullscreenExit);

function atualizarPainelDados() {
  ensureAppState();

  const pivos = Array.isArray(AppState.lastPivosDataDrawn) ? AppState.lastPivosDataDrawn : [];
  const bombas = Array.isArray(AppState.lastBombasDataDrawn) ? AppState.lastBombasDataDrawn : [];
  const repetidoras = Array.isArray(AppState.repetidoras) ? AppState.repetidoras : [];
  const totalPivos = pivos.length;
  const foraCobertura = pivos.filter((p) => p?.fora).length;

  let totalRepetidoras = 0;
  let totalCentrais = 0;

  if (AppState.antenaGlobal) {
    const type = AppState.antenaGlobal.type;
    if (type === "central") {
      totalCentrais++;
    } else {
      type === "central_repeater_combined" && totalCentrais++;
      totalRepetidoras++;
    }
  }

  repetidoras.forEach((rep) => {
    const type = rep?.type;
    if (type === "central") {
      totalCentrais++;
    } else {
      type === "central_repeater_combined" && totalCentrais++;
      totalRepetidoras++;
    }
  });

  const totalPivosEl = document.getElementById("total-pivos");
  const foraCoberturaEl = document.getElementById("fora-cobertura");
  const templateInfoEl = document.getElementById("template-info");
  const totalRepetidorasEl = document.getElementById("total-repetidoras");
  const totalCentraisEl = document.getElementById("total-centrais");
  const centralCountValueEl = document.getElementById("central-count-value");
  const totalBombasEl = document.getElementById("total-bombas");

  totalPivosEl && (totalPivosEl.textContent = `${t("ui.labels.total_pivots")} ${totalPivos}`);
  foraCoberturaEl && (foraCoberturaEl.textContent = `${t("ui.labels.out_of_coverage")} ${foraCobertura}`);
  templateInfoEl && (templateInfoEl.textContent = `${t("ui.labels.template_info")} ${AppState.templateSelecionado || "--"}`);
  totalRepetidorasEl && (totalRepetidorasEl.textContent = `${t("ui.labels.total_repeaters")} ${totalRepetidoras}`);
  totalCentraisEl && centralCountValueEl && (
    centralCountValueEl.textContent = totalCentrais,
    totalCentraisEl.classList.toggle("hidden", totalCentrais === 0)
  );
  totalBombasEl && (
    totalBombasEl.textContent = `${t("ui.labels.pump_houses")} ${bombas.length}`,
    totalBombasEl.classList.toggle("hidden", bombas.length === 0)
  );
}

function reposicionarPaineisLaterais() {
  const panels = [painelDadosDiv, painelRepetidorasDiv].filter(Boolean);
  let top = 16;
  const gap = 16;
  panels.forEach((panel) => {
    panel.style.top = `${top}px`;
    top += panel.offsetHeight + gap;
  });
}

async function loadAndPopulateTemplates() {
  try {
    const result = await getTemplates();
    const templates = Array.isArray(result?.templates) ? result.templates.slice() : Array.isArray(result) ? result.slice() : [];
    if (!templates.length) throw new Error("Lista de templates vazia");

    const disabled = Array.isArray(result?.disabled) ? result.disabled : [];
    templateDisabledList = disabled.slice();
    templateOverrideEnabled = !!window.AppState?.templateOverrideEnabled;

    const disabledSet = new Set(templateOverrideEnabled ? [] : disabled);
    const uniqueTemplates = [...new Set(templates)];

    templateSelect.innerHTML = uniqueTemplates.map((templateName) => {
      const flag = /brazil/i.test(templateName) ? "🇧🇷 " : /europe/i.test(templateName) ? "🇪🇺 " : "🌐 ";
      const isDisabled = disabledSet.has(templateName);
      const label = `${flag}${templateName}`;
      return `<option value="${templateName}"${isDisabled ? ' disabled aria-disabled="true"' : ""}>${label}</option>`;
    }).join("");

    const savedTemplate = localStorage.getItem("templateSelecionado");
    const savedIsValid = savedTemplate && uniqueTemplates.includes(savedTemplate) && !disabledSet.has(savedTemplate);
    const firstEnabled = uniqueTemplates.find((templateName) => !disabledSet.has(templateName)) ?? "";

    templateSelect.value = savedIsValid ? savedTemplate : firstEnabled || uniqueTemplates[0] || "";
    templateSelect.dispatchEvent(new Event("change"));
  } catch (err) {
    console.error("Erro ao carregar templates:", err);
    mostrarMensagem(t("messages.errors.template_load_fail"), "erro");
  }
}

function togglePivoEditing() {
  ensureAppState();

  const isEditing = !AppState.modoEdicaoPivos;
  AppState.modoEdicaoPivos = isEditing;

  const editBtn = document.getElementById("editar-pivos");
  const undoBtn = document.getElementById("desfazer-edicao");

  if (editBtn) {
    editBtn.innerHTML = isEditing ? '<i data-lucide="save" class="w-5 h-5"></i>' : '<i data-lucide="pencil" class="w-5 h-5"></i>';
    editBtn.title = isEditing ? t("ui.titles.save_edit") : t("ui.titles.edit_pivots");
    editBtn.classList.toggle("glass-button-active", isEditing);
  }

  undoBtn?.classList.toggle("hidden", !isEditing);
  btnMoverPivoSemCirculo?.classList.toggle("hidden", !isEditing);

  if (isEditing) {
    typeof AppState.modoDesenhoPivo < "u" && AppState.modoDesenhoPivo && typeof toggleModoDesenhoPivo == "function" && toggleModoDesenhoPivo();
    typeof AppState.modoDesenhoPivoSetorial < "u" && AppState.modoDesenhoPivoSetorial && typeof toggleModoDesenhoPivoSetorial == "function" && toggleModoDesenhoPivoSetorial();
    typeof AppState.modoDesenhoPivoPacman < "u" && AppState.modoDesenhoPivoPacman && typeof toggleModoDesenhoPivoPacman == "function" && toggleModoDesenhoPivoPacman();
    typeof AppState.modoDesenhoIrripump < "u" && AppState.modoDesenhoIrripump && typeof toggleModoDesenhoIrripump == "function" && toggleModoDesenhoIrripump();
    typeof AppState.modoLoSPivotAPivot < "u" && AppState.modoLoSPivotAPivot && typeof toggleLoSPivotAPivotMode == "function" && toggleLoSPivotAPivotMode();
    typeof AppState.modoBuscaLocalRepetidora < "u" && AppState.modoBuscaLocalRepetidora && typeof handleBuscarLocaisRepetidoraActivation == "function" && handleBuscarLocaisRepetidoraActivation();
    typeof enablePivoEditingMode == "function" && enablePivoEditingMode();
  } else {
    AppState.modoMoverPivoSemCirculo && typeof toggleModoMoverPivoSemCirculo == "function" && toggleModoMoverPivoSemCirculo();
    AppState.modoExcluirPivo && typeof toggleModoExcluirPivo == "function" && toggleModoExcluirPivo();
    typeof disablePivoEditingMode == "function" && disablePivoEditingMode();
  }

  lucide?.createIcons?.();
}

// Deixa um painel arrastável pela sua barra de título, tipo o balão de
// chamada do WhatsApp — funciona com mouse e toque (Pointer Events cobre
// os dois). Usa setProperty(..., "important") porque o painel de
// repetidora tem posição fixa forçada com !important no mobile.css (pra
// flutuar certinho quando o mobile.js o move pra fora da sidebar); sem
// isso, a posição arrastada seria sobrescrita pelo CSS.
function makeDraggable(panel, handle) {
  if (!panel || !handle || handle.dataset.dragBound) return;
  handle.dataset.dragBound = "1";
  handle.classList.add("drag-handle");

  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let dragging = false;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function onPointerMove(event) {
    if (!dragging) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
    const newLeft = clamp(startLeft + deltaX, 0, maxLeft);
    const newTop = clamp(startTop + deltaY, 0, maxTop);
    panel.style.setProperty("left", `${newLeft}px`, "important");
    panel.style.setProperty("top", `${newTop}px`, "important");
  }

  function onPointerUp(event) {
    dragging = false;
    panel.classList.remove("panel-dragging");
    handle.releasePointerCapture?.(event.pointerId);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  }

  handle.addEventListener("pointerdown", (event) => {
    // Não inicia arrasto ao clicar no botão de fechar (ou qualquer outro
    // controle interativo que algum dia entre na barra de título).
    if (event.target.closest("button, input, select, textarea, a")) return;
    if (event.button !== undefined && event.button !== 0) return; // só botão esquerdo do mouse

    const rect = panel.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    dragging = true;

    // Congela a posição atual como "fixed" antes de mover — assim o
    // painel não pula de lugar no primeiro movimento, seja qual for a
    // posição de origem (fluxo normal da sidebar no desktop, ou fixed
    // flutuante no mobile).
    panel.style.setProperty("position", "fixed", "important");
    panel.style.setProperty("left", `${rect.left}px`, "important");
    panel.style.setProperty("top", `${rect.top}px`, "important");
    panel.style.setProperty("right", "auto", "important");
    panel.style.setProperty("bottom", "auto", "important");
    panel.style.setProperty("margin", "0", "important");
    panel.classList.add("panel-dragging");

    handle.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    event.preventDefault();
  });
}

function setupUIEventListeners() {
  if (document.body.dataset.uiBound === "1") return;
  document.body.dataset.uiBound = "1";

  document.querySelectorAll(".panel-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const panel = event.currentTarget.closest(".panel");
      if (!panel) return;
      panel.classList.toggle("minimized");
      const icon = btn.querySelector("i");
      icon && icon.setAttribute("data-lucide", panel.classList.contains("minimized") ? "chevron-down" : "chevron-up");
      lucide?.createIcons?.();
      setTimeout(reposicionarPaineisLaterais, 500);
    });
  });

  const legendaBtn = document.getElementById("toggle-legenda");
  legendaBtn && !legendaBtn.dataset.bound && (legendaBtn.dataset.bound = "1", legendaBtn.addEventListener("click", () => {
    ensureAppState();
    AppState.legendasAtivas = !AppState.legendasAtivas;
    legendaBtn.classList.toggle("glass-button-active", !AppState.legendasAtivas);
    const icon = legendaBtn.querySelector(".sidebar-icon");
    const iconPath = AppState.legendasAtivas ? "assets/images/captions.svg" : "assets/images/captions-off.svg";
    icon && (icon.style.webkitMaskImage = `url(${iconPath})`, icon.style.maskImage = `url(${iconPath})`);
    typeof updateLegendsVisibility == "function" && updateLegendsVisibility();
  }));

  const antenaLegendaBtn = document.getElementById("toggle-antenas-legendas");
  antenaLegendaBtn && !antenaLegendaBtn.dataset.bound && (antenaLegendaBtn.dataset.bound = "1", antenaLegendaBtn.addEventListener("click", () => {
    ensureAppState();
    AppState.antenaLegendasAtivas = !AppState.antenaLegendasAtivas;
    antenaLegendaBtn.classList.toggle("glass-button-active", !AppState.antenaLegendasAtivas);
    const icon = antenaLegendaBtn.querySelector(".sidebar-icon");
    if (icon) {
      const iconPath = (AppState.antenaLegendasAtivas, "assets/images/radio.svg");
      icon.style.webkitMaskImage = `url('${iconPath}')`;
      icon.style.maskImage = `url('${iconPath}')`;
    }
    typeof updateLegendsVisibility == "function" && updateLegendsVisibility();
  }));

  rangeOpacidade && !rangeOpacidade.dataset.bound && (rangeOpacidade.dataset.bound = "1", rangeOpacidade.addEventListener("input", () => {
    const value = parseFloat(rangeOpacidade.value);
    typeof updateOverlaysOpacity == "function" && updateOverlaysOpacity(value);
  }));

  templateSelect && !templateSelect.dataset.bound && (templateSelect.dataset.bound = "1", templateSelect.addEventListener("change", (event) => {
    ensureAppState();
    AppState.templateSelecionado = event.target.value;
    localStorage.setItem("templateSelecionado", AppState.templateSelecionado);
    atualizarPainelDados();
    updateLegendImage(event.target.value);
  }));

  const fecharPainelRepBtn = document.getElementById("fechar-painel-rep");
  fecharPainelRepBtn && !fecharPainelRepBtn.dataset.bound && (fecharPainelRepBtn.dataset.bound = "1", fecharPainelRepBtn.addEventListener("click", () => {
    painelConfigRepetidoraDiv?.classList.add("hidden");
    typeof removePositioningMarker == "function" && removePositioningMarker();
  }));

  // Arrastar o painel de repetidora pela barra de título (mouse e toque).
  const painelRepHeader = painelConfigRepetidoraDiv?.querySelector(":scope > .flex.justify-between.items-center");
  painelRepHeader && makeDraggable(painelConfigRepetidoraDiv, painelRepHeader);

  const editarPivosBtn = document.getElementById("editar-pivos");
  editarPivosBtn && !editarPivosBtn.dataset.bound && (editarPivosBtn.dataset.bound = "1", editarPivosBtn.addEventListener("click", togglePivoEditing));

  const desfazerEdicaoBtn = document.getElementById("desfazer-edicao");
  desfazerEdicaoBtn && !desfazerEdicaoBtn.dataset.bound && (desfazerEdicaoBtn.dataset.bound = "1", desfazerEdicaoBtn.addEventListener("click", () => {
    typeof desfazerUltimaAcao == "function" && desfazerUltimaAcao();
  }));

  document.querySelectorAll("[data-lang]").forEach((langBtn) => {
    langBtn.dataset.bound || (langBtn.dataset.bound = "1", langBtn.addEventListener("click", (event) => {
      const lang = event.currentTarget.getAttribute("data-lang");
      lang && typeof setLanguage == "function" && setLanguage(lang);
    }));
  });

  lucide?.createIcons?.();
}

function expandAllPanels() {
  document.querySelectorAll(".panel.minimized").forEach((panel) => {
    panel.classList.remove("minimized");
    const icon = panel.querySelector(".panel-toggle-btn")?.querySelector("i");
    icon && icon.setAttribute("data-lucide", "chevron-up");
  });
  lucide?.createIcons?.();
  setTimeout(reposicionarPaineisLaterais, 500);
}

function updateDrawingTooltip(mapInstance, event, html) {
  if (!mapInstance || !event) return;
  const container = mapInstance.getContainer?.();
  if (!container) return;

  let tooltip = container.querySelector(".drawing-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "drawing-tooltip";
    container.appendChild(tooltip);
  }
  tooltip.innerHTML = html;

  const left = event.containerPoint.x + 15;
  const top = event.containerPoint.y + 15;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.opacity = 1;
}

function removeDrawingTooltip(mapInstance) {
  const tooltip = mapInstance?.getContainer?.()?.querySelector(".drawing-tooltip");
  if (tooltip) {
    tooltip.style.opacity = 0;
    setTimeout(() => tooltip.remove(), 100);
  }
}

function toggleTemplateOverrideShortcut() {
  ensureAppState();
  templateOverrideEnabled = !templateOverrideEnabled;
  AppState.templateOverrideEnabled = templateOverrideEnabled;

  const disabledSet = new Set(templateOverrideEnabled ? [] : templateDisabledList);

  if (templateSelect) {
    Array.from(templateSelect.options || []).forEach((option) => {
      const isDisabled = disabledSet.has(option.value);
      option.disabled = isDisabled;
      isDisabled ? option.setAttribute("aria-disabled", "true") : option.removeAttribute("aria-disabled");
    });

    const currentValue = templateSelect.value;
    if (disabledSet.has(currentValue)) {
      const firstEnabled = Array.from(templateSelect.options).find((option) => !option.disabled);
      firstEnabled && (templateSelect.value = firstEnabled.value);
    }

    templateSelect.dispatchEvent(new Event("change"));
  }

  const message = templateOverrideEnabled
    ? (typeof t == "function" && t("messages.success.template_unlocked")) || "Template Brazil V6 90dBm liberado nesta sessão."
    : (typeof t == "function" && t("messages.success.template_locked")) || "Template Brazil V6 90dBm bloqueado novamente.";

  typeof mostrarMensagem == "function" && mostrarMensagem(message, "sucesso");
}

window.__tplShortcutBound || (window.__tplShortcutBound = true, window.addEventListener("keydown", (event) => {
  event.shiftKey && String(event.key || "").toLowerCase() === "a" && (event.preventDefault(), toggleTemplateOverrideShortcut());
}));

window.showCustomConfirm = showCustomConfirm;
window.mostrarMensagem = mostrarMensagem;
window.mostrarLoader = mostrarLoader;
window.updateLegendImage = updateLegendImage;
window.atualizarPainelDados = atualizarPainelDados;
window.reposicionarPaineisLaterais = reposicionarPaineisLaterais;
window.loadAndPopulateTemplates = loadAndPopulateTemplates;
window.togglePivoEditing = togglePivoEditing;
window.setupUIEventListeners = setupUIEventListeners;
window.expandAllPanels = expandAllPanels;
window.updateDrawingTooltip = updateDrawingTooltip;
window.removeDrawingTooltip = removeDrawingTooltip;
window.ensureAppState = ensureAppState;
window.showOverlay = showOverlay;
window.hideOverlay = hideOverlay;
window.toggleTemplateOverrideShortcut = toggleTemplateOverrideShortcut;
