// Bundle único (gerado por npm run build:js) com core.state.js, core.modes.js,
// feature.los.js, feature.pivots.js e feature.repeaters.js, nessa ordem -
// so carregado apos o login para nao pesar a tela inicial de quem nao logou.
const MAIN_MODULE_SCRIPTS = ["dist/main-modules.bundle.js?v=23"];

function loadMainScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-main-module="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.defer = true;
    script.setAttribute("data-main-module", src);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

const mainModulesReady = window.__mainModulesReady || (window.__mainModulesReady = (async () => {
  for (const src of MAIN_MODULE_SCRIPTS) await loadMainScript(src);
})());

function onMainModulesReady() {
  return mainModulesReady;
}

document.addEventListener("DOMContentLoaded", async () => {
  await onMainModulesReady();
  if (!window.Auth?.getToken?.()) return;
  await initApp();
});

window.addEventListener("auth:login", async () => {
  await onMainModulesReady();
  await initApp();
}, { once: true });

async function initApp() {
  const lang = localStorage.getItem("preferredLanguage") || "pt-br";
  await setLanguage(lang);
  initMap();
  setupUIEventListeners();
  setupMainActionListeners();
  await loadAndPopulateTemplates();
  loadMapboxToken();
  lucide?.createIcons?.();
  await handleResetClick(false);
  updateActionButtonsI18n();
  document.addEventListener("i18n:applied", () => {
    updateActionButtonsI18n();
  });
}

// Busca o token do Mapbox do backend (só disponível após login — ver
// simulation.py:/mapbox_token) e guarda em window pra 3d_analysis.js usar.
// Não bloqueia o carregamento do resto do app: a análise 3D só é aberta
// bem depois, sob demanda, então um "fire and forget" aqui é suficiente.
// Se falhar (token não configurado no servidor, rede etc.), window.MAPBOX_ACCESS_TOKEN
// fica undefined e o Analysis3D avisa o usuário só quando ele tentar abrir o modal.
async function loadMapboxToken() {
  try {
    const result = await getMapboxToken();
    window.MAPBOX_ACCESS_TOKEN = result?.token || null;
  } catch (err) {
    console.warn("Análise 3D indisponível: token do Mapbox não foi carregado.", err);
  }
}

function updatePdfButtonState(enabled) {
  const btn = document.getElementById("exportar-pdf-btn");
  if (!btn) return;
  btn.disabled = !enabled;
  if (enabled) {
    btn.title = t("tooltips.export_pdf_report");
    btn.setAttribute("aria-label", t("ui.buttons.export_pdf_report"));
  } else {
    btn.title = t("tooltips.export_pdf_disabled");
    btn.setAttribute("aria-label", t("tooltips.export_pdf_disabled"));
  }
}

function updateKmzButtonState(enabled) {
  const btn = document.getElementById("exportar-btn");
  if (!btn) return;
  btn.disabled = !enabled;
  if (enabled) {
    btn.title = t("tooltips.export_kmz");
    btn.setAttribute("aria-label", t("ui.buttons.export_kmz"));
  } else {
    btn.title = t("tooltips.export_kmz_disabled");
    btn.setAttribute("aria-label", t("tooltips.export_kmz_disabled"));
  }
}

async function startNewSession() {
  mostrarLoader(true);
  try {
    const result = await startEmptyJob();
    if (!result.job_id) throw new Error(t("messages.errors.missing_job_id"));
    AppState.setJobId(result.job_id);
    AppState.jobId && mostrarMensagem(t("messages.success.new_session_started"), "sucesso");
    AppState.currentProcessedKmzData = { antenas: [], pivos: [], ciclos: [], bombas: [] };
  } catch (err) {
    console.error("Falha crítica ao iniciar nova sessão:", err);
    mostrarMensagem(t("messages.errors.session_start_fail"), "erro");
    AppState.setJobId(null);
  } finally {
    mostrarLoader(false);
  }
}

function setupMainActionListeners() {
  document.getElementById("arquivo")?.addEventListener("change", handleKmzFileSelect);
  document.getElementById("resetar-btn")?.addEventListener("click", () => handleResetClick(true));
  document.getElementById("exportar-btn")?.addEventListener("click", handleExportClick);
  document.getElementById("exportar-pdf-btn")?.addEventListener("click", handleExportPdfReportClick);
  document.getElementById("confirmar-repetidora")?.addEventListener("click", handleConfirmRepetidoraClick);
  document.getElementById("btn-download-active-pngs")?.addEventListener("click", handleDownloadActivePngsClick);
  document.getElementById("btn-los-pivot-a-pivot")?.addEventListener("click", toggleLoSPivotAPivotMode);
  document.getElementById("btn-buscar-locais-repetidora")?.addEventListener("click", handleBuscarLocaisRepetidoraActivation);
  document.getElementById("coord-search-btn")?.addEventListener("click", handleCoordinateSearch);
  document.getElementById("btn-draw-pivot-pacman")?.addEventListener("click", toggleModoDesenhoPivoPacman);
  document.getElementById("btn-draw-irripump")?.addEventListener("click", toggleModoDesenhoIrripump);
  document.getElementById("btn-mover-pivo-sem-circulo")?.addEventListener("click", toggleModoMoverPivoSemCirculo);
  document.getElementById("btn-toggle-delete-pivo")?.addEventListener("click", toggleModoExcluirPivo);
  document.getElementById("btn-screenshot-mode")?.addEventListener("click", toggleScreenshotMode);
  map?.on("click", handleMapClick);
  map?.on("contextmenu", handleCancelDraw);
  document.addEventListener("keydown", handleGlobalKeys);
  document.getElementById("btn-draw-pivot")?.addEventListener("click", toggleModoDesenhoPivo);
  document.getElementById("btn-draw-pivot-setorial")?.addEventListener("click", toggleModoDesenhoPivoSetorial);

  const toggleDistanciasBtn = document.getElementById("toggle-distancias-pivos");
  toggleDistanciasBtn && toggleDistanciasBtn.addEventListener("click", handleToggleDistanciasPivos);
}

async function handleKmzFileSelect(event) {
  const input = event.target;
  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];
  const fileNameLabel = document.getElementById("nome-arquivo-label");
  if (fileNameLabel) {
    const displayName = file.name || t("ui.labels.choose_kmz");
    fileNameLabel.textContent = displayName;
    fileNameLabel.hasAttribute("title") && fileNameLabel.removeAttribute("title");
    const labelEl = document.querySelector('label[for="arquivo"]');
    labelEl && labelEl.setAttribute("title", displayName);
  }

  mostrarLoader(true);
  const formData = new FormData();
  formData.append("file", file);
  const lang = localStorage.getItem("preferredLanguage") || "pt-br";
  formData.append("language", lang);

  try {
    await handleResetClick(false);
    mostrarLoader(true);

    const result = await processKmz(formData);
    if (!result.job_id) throw new Error(t("messages.errors.missing_job_id"));

    AppState.setJobId(result.job_id);
    AppState.currentProcessedKmzData = JSON.parse(JSON.stringify(result));

    result.pivos && result.ciclos && result.pivos.forEach((pivo) => {
      if (pivo.tipo === "custom" && Array.isArray(pivo.coordenadas) && pivo.coordenadas.length > 0) return;

      const cicloName = `Ciclo ${pivo.nome}`;
      const ciclo = result.ciclos.find((c) => c.nome_original_circulo === cicloName);
      if (ciclo && Array.isArray(ciclo.coordenadas) && ciclo.coordenadas.length > 0) {
        pivo.tipo = "custom";
        pivo.coordenadas = ciclo.coordenadas;
        const bounds = L.polygon(ciclo.coordenadas).getBounds();
        const center = bounds.getCenter();
        const northPoint = L.latLng(bounds.getNorth(), center.lng);
        pivo.raio = center.distanceTo(northPoint);
      }
    });

    AppState.antenaGlobal = null;

    const antenas = result.antenas || [];
    const bombas = result.bombas || [];
    const pivos = result.pivos || [];
    const pivosComFora = pivos.map((p) => ({
      ...p,
      fora: true,
      circle_center_lat: p.lat,
      circle_center_lon: p.lon
    }));

    AppState.lastPivosDataDrawn = JSON.parse(JSON.stringify(pivosComFora));
    AppState.lastBombasDataDrawn = JSON.parse(JSON.stringify(bombas));
    AppState.ciclosGlobais = result.ciclos || [];

    drawAntenaCandidates(antenas);
    drawBombas(AppState.lastBombasDataDrawn);
    drawPivos(AppState.lastPivosDataDrawn);
    drawCirculos();

    antenas.length > 0
      ? mostrarMensagem(t("messages.success.kmz_loaded_select_tower"), "sucesso")
      : mostrarMensagem(t("messages.info.no_towers_found"), "info");

    document.getElementById("simular-btn")?.classList.add("hidden");

    if (pivos.length > 0 || antenas.length > 0) {
      if (typeof fitMapToAllElements == "function") {
        fitMapToAllElements();
      } else {
        const points = [];
        pivos.forEach((p) => points.push([p.lat, p.lon]));
        antenas.forEach((a) => points.push([a.lat, a.lon]));
        points.length > 0 && map.fitBounds(points, { padding: [50, 50] });
      }
      updatePivotIcons();
    }

    atualizarPainelDados();
    document.getElementById("painel-dados")?.classList.remove("hidden");
    document.getElementById("painel-repetidoras")?.classList.remove("hidden");
    reposicionarPaineisLaterais();
    expandAllPanels();
  } catch (err) {
    console.error("Erro no upload do KMZ:", err);
    mostrarMensagem(t("messages.errors.kmz_load_fail", { error: err.message }), "erro");
    updatePdfButtonState(false);
    updateKmzButtonState(false);
    await startNewSession();
  } finally {
    mostrarLoader(false);
    input.value = "";
  }
}

async function handleExportPdfReportClick() {
  if (!AppState.jobId || !AppState.currentProcessedKmzData) {
    mostrarMensagem(t("messages.errors.load_kmz_first"), "erro");
    return;
  }
  if (!AppState.antenaGlobal && AppState.repetidoras.length === 0 && AppState.lastPivosDataDrawn.length === 0 && AppState.lastBombasDataDrawn.length === 0) {
    mostrarMensagem(t("messages.errors.nothing_to_export"), "erro");
    return;
  }

  let fileHandle = null;
  try {
    fileHandle = await pickSaveTarget("relatorio-irricontrol.zip");
  } catch (err) {
    if (err?.name === "AbortError") return;
  }

  mostrarLoader(true);
  mostrarMensagem(t("messages.success.pdf_export_preparing"), "info");

  try {
    const visibleReps = AppState.repetidoras.filter((rep) => {
      const visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
      return !visibilityBtn || visibilityBtn.getAttribute("data-visible") === "true";
    });

    const repetidorasData = visibleReps.map((rep) => ({
      nome: rep.nome,
      lat: rep.lat,
      lon: rep.lon,
      altura: rep.altura,
      altura_receiver: rep.altura_receiver,
      is_from_kmz: rep.is_from_kmz || false,
      sobre_pivo: rep.sobre_pivo || false,
      type: rep.type || "default"
    }));

    const repetidorasDataKmz = visibleReps.filter((rep) => rep.imagem_filename).map((rep) => ({
      imagem: rep.imagem_filename,
      altura: rep.altura,
      sobre_pivo: rep.sobre_pivo,
      nome: rep.is_from_kmz ? rep.nome : null,
      type: rep.type || "default"
    }));

    let antenaPrincipalData = null;
    let imagemFilename = null;
    let boundsFile = null;

    if (AppState.antenaGlobal) {
      antenaPrincipalData = {
        nome: AppState.antenaGlobal.nome,
        lat: AppState.antenaGlobal.lat,
        lon: AppState.antenaGlobal.lon,
        altura: AppState.antenaGlobal.altura,
        altura_receiver: AppState.antenaGlobal.altura_receiver,
        type: AppState.antenaGlobal.type || "default"
      };
      imagemFilename = AppState.antenaGlobal.imagem_filename;
      imagemFilename && (boundsFile = imagemFilename.replace(/\.png$/, ".json"));
    }

    const pivosData = AppState.lastPivosDataDrawn.map((p) => ({
      nome: p.nome,
      lat: p.lat,
      lon: p.lon,
      fora: p.fora
    }));
    const bombasData = AppState.lastBombasDataDrawn.map((b) => ({
      nome: b.nome,
      lat: b.lat,
      lon: b.lon,
      fora: b.fora
    }));

    fitMapToAllElements();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const mapImageBase64 = await captureMapSnapshot();
    const payload = {
      job_id: AppState.jobId,
      language: localStorage.getItem("preferredLanguage") || "pt-br",
      template_id: AppState.templateSelecionado || document.getElementById("template-modelo").value,
      antena_principal_data: antenaPrincipalData,
      imagem: imagemFilename,
      bounds_file: boundsFile,
      pivos_data: pivosData,
      ciclos_data: AppState.ciclosGlobais,
      bombas_data: bombasData,
      repetidoras_data: repetidorasData,
      repetidoras_data_kmz: repetidorasDataKmz,
      map_image_base64: mapImageBase64
    };

    await exportBundle(payload, fileHandle);
    mostrarMensagem(t("messages.success.pdf_export_complete"), "sucesso");
  } catch (err) {
    console.error("Erro no processo de exportação do relatório:", err);
    mostrarMensagem(t("messages.errors.pdf_export_fail", { error: err.message }), "erro");
  } finally {
    mostrarLoader(false);
  }
}

async function handleResetClick(notify = true) {
  clearMapLayers();
  AppState.reset();
  await startNewSession();

  ["btn-los-pivot-a-pivot", "btn-buscar-locais-repetidora", "btn-visada", "toggle-legenda", "toggle-antenas-legendas", "toggle-distancias-pivos", "btn-draw-pivot", "btn-draw-pivot-setorial", "btn-draw-pivot-pacman", "btn-draw-irripump", "editar-pivos", "btn-mover-pivo-sem-circulo", "btn-toggle-delete-pivo", "desfazer-edicao"].forEach((id) => {
    const el = document.getElementById(id);
    el && el.classList.remove("glass-button-active");
  });

  const editarPivosBtn = document.getElementById("editar-pivos");
  editarPivosBtn && (editarPivosBtn.innerHTML = '<i data-lucide="pencil" class="w-5 h-5"></i>');

  const desfazerBtn = document.getElementById("desfazer-edicao");
  desfazerBtn && desfazerBtn.classList.add("hidden");

  const moverPivoBtn = document.getElementById("btn-mover-pivo-sem-circulo");
  moverPivoBtn && moverPivoBtn.classList.add("hidden");

  const legendaBtn = document.getElementById("toggle-legenda");
  if (legendaBtn) {
    const icon = legendaBtn.querySelector(".sidebar-icon");
    const iconPath = "assets/images/captions.svg";
    icon && (icon.style.webkitMaskImage = `url(${iconPath})`, icon.style.maskImage = `url(${iconPath})`);
  }

  const antenaLegendaBtn = document.getElementById("toggle-antenas-legendas");
  if (antenaLegendaBtn) {
    const icon = antenaLegendaBtn.querySelector(".sidebar-icon");
    icon && (icon.style.webkitMaskImage = "url('assets/images/radio.svg')", icon.style.maskImage = "url('assets/images/radio.svg')");
  }

  updatePdfButtonState(false);
  updateKmzButtonState(false);

  if (map) {
    map.getContainer().style.cursor = "";
    window.candidateRepeaterSitesLayerGroup && window.candidateRepeaterSitesLayerGroup.clearLayers();
    map.off("click", handlePivotDrawClick);
    map.off("mousemove", handlePivotDrawMouseMove);
    map.off("click", handleSectorialPivotDrawClick);
    map.off("mousemove", handleSectorialDrawMouseMove);
    map.setView([-15, -55], 5);
  }

  document.getElementById("simular-btn")?.classList.add("hidden");

  const listaRepetidoras = document.getElementById("lista-repetidoras");
  listaRepetidoras && (listaRepetidoras.innerHTML = "");

  ["painel-repetidora", "desfazer-edicao"].forEach((id) => {
    const el = document.getElementById(id);
    el && el.classList.add("hidden");
  });

  updateDownloadActivePngsButtonState();

  const fileNameLabel = document.getElementById("nome-arquivo-label");
  if (fileNameLabel) {
    fileNameLabel.textContent = t("ui.labels.choose_kmz");
    fileNameLabel.hasAttribute("title") && fileNameLabel.removeAttribute("title");
  }

  const fileInput = document.getElementById("arquivo");
  fileInput && (fileInput.value = "");

  const opacityRange = document.getElementById("range-opacidade");
  opacityRange && (opacityRange.value = 1);

  atualizarPainelDados();
  reposicionarPaineisLaterais();
  updateLegendsVisibility();
  notify && mostrarMensagem(t("messages.success.app_reset"), "sucesso");
  lucide?.createIcons?.();
}

async function handleExportClick() {
  if (!AppState.jobId) {
    mostrarMensagem(t("messages.errors.session_not_started"), "erro");
    return;
  }
  if (!AppState.antenaGlobal && AppState.repetidoras.length === 0) {
    mostrarMensagem(t("messages.errors.nothing_to_export"), "erro");
    return;
  }

  let fileHandle = null;
  try {
    fileHandle = await pickSaveTarget("estudo-irricontrol.kmz");
  } catch (err) {
    if (err?.name === "AbortError") return;
  }

  mostrarLoader(true);
  mostrarMensagem(t("messages.success.kmz_export_preparing"), "info");

  try {
    const repetidorasDataKmz = [];
    AppState.repetidoras.forEach((rep) => {
      const visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
      (!visibilityBtn || visibilityBtn.getAttribute("data-visible") === "true") && rep.imagem_filename && repetidorasDataKmz.push({
        imagem: rep.imagem_filename,
        altura: rep.altura,
        sobre_pivo: rep.sobre_pivo,
        nome: rep.is_from_kmz ? rep.nome : null,
        type: rep.type || "default"
      });
    });

    let antenaPrincipalData = null;
    let imagemFilename = null;
    let boundsFile = null;

    if (AppState.antenaGlobal) {
      antenaPrincipalData = {
        nome: AppState.antenaGlobal.nome,
        lat: AppState.antenaGlobal.lat,
        lon: AppState.antenaGlobal.lon,
        altura: AppState.antenaGlobal.altura,
        altura_receiver: AppState.antenaGlobal.altura_receiver,
        type: AppState.antenaGlobal.type || "default"
      };
      imagemFilename = AppState.antenaGlobal.imagem_filename;
      imagemFilename && (boundsFile = imagemFilename.replace(/\.png$/, ".json"));
    }

    const payload = {
      job_id: AppState.jobId,
      template_id: AppState.templateSelecionado || document.getElementById("template-modelo").value,
      language: localStorage.getItem("preferredLanguage") || "pt-br",
      antena_principal_data: antenaPrincipalData,
      imagem: imagemFilename,
      bounds_file: boundsFile,
      pivos_data: AppState.lastPivosDataDrawn,
      ciclos_data: AppState.ciclosGlobais,
      bombas_data: AppState.lastBombasDataDrawn,
      repetidoras_data: repetidorasDataKmz
    };

    await exportKmz(payload, fileHandle);
    mostrarMensagem(t("messages.success.kmz_export_complete"), "sucesso");
  } catch (err) {
    console.error("Erro no processo de exportação KMZ:", err);
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
  } finally {
    mostrarLoader(false);
  }
}

function updateActionButtonsI18n() {
  try {
    const labelEl = document.querySelector('label[for="arquivo"]');
    if (labelEl) {
      const fileInput = document.getElementById("arquivo");
      let title = t("tooltips.load_kmz");
      fileInput?.files?.length > 0 && (title = fileInput.files[0].name || title);
      labelEl.setAttribute("title", title);
      labelEl.setAttribute("aria-label", t("ui.labels.choose_kmz"));
    }

    updateKmzButtonState(hasActiveCoverageOverlays());

    const resetBtn = document.getElementById("resetar-btn");
    resetBtn && (resetBtn.setAttribute("title", t("tooltips.reset")), resetBtn.setAttribute("aria-label", t("ui.buttons.reset")));
  } catch {}
}
