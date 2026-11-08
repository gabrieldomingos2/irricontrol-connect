// =====================================================================
// Perfil de elevação (régua estilo Google Earth) — integração no app.
// O motor (terreno, gráfico, régua) fica em assets/js/elevation-profile.js;
// aqui só monta a interface, liga o botão da topbar e conversa com o AppState.
// =====================================================================

let elevationProfileTool = null;

// Limites da altura do painel do gráfico (px). Arrastando a alça na borda.
const EP_PANEL_MIN = 160;
const EP_PANEL_MAX = 380;
const EP_PANEL_DEFAULT = 270;
const EP_PANEL_STORAGE_KEY = "IRRI_EP_PANEL_HEIGHT";

function buildElevationProfileUI() {
  const wrapper = document.getElementById("map-wrapper");
  if (!wrapper || document.getElementById("ep-panel")) return;

  const panel = document.createElement("div");
  panel.id = "ep-panel";
  panel.className = "hidden";
  panel.innerHTML = `
    <div id="ep-resize" data-i18n="elevation_profile.resize_hint" data-i18n-attr="title" title="${t("elevation_profile.resize_hint")}">
      <span class="ep-grip"></span>
    </div>
    <div class="ep-header">
      <div id="ep-stats"></div>
      <div class="ep-actions">
        <span id="ep-loading" aria-live="polite"></span>
        <button type="button" id="ep-new" data-i18n="elevation_profile.new_path">${t("elevation_profile.new_path")}</button>
        <button type="button" id="ep-clear" data-i18n="elevation_profile.clear">${t("elevation_profile.clear")}</button>
      </div>
    </div>
    <div id="ep-chart-wrap"><canvas id="ep-canvas"></canvas></div>`;

  wrapper.appendChild(panel);
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);

  document.getElementById("ep-new").addEventListener("click", () => elevationProfileTool?.start());
  document.getElementById("ep-clear").addEventListener("click", () => elevationProfileTool?.clear());

  let saved = NaN;
  try { saved = parseFloat(localStorage.getItem(EP_PANEL_STORAGE_KEY)); } catch {}
  setElevationPanelHeight(Number.isFinite(saved) ? saved : EP_PANEL_DEFAULT, false);
  setupElevationPanelResize();
}

function setElevationPanelHeight(px, persist = true) {
  const wrapper = document.getElementById("map-wrapper");
  if (!wrapper) return;
  // nunca deixa o gráfico engolir o mapa: no máximo 60% da área do mapa
  const max = Math.min(EP_PANEL_MAX, Math.round(wrapper.clientHeight * 0.6) || EP_PANEL_MAX);
  const h = Math.round(Math.max(EP_PANEL_MIN, Math.min(max, px)));
  wrapper.style.setProperty("--ep-h", h + "px");
  if (persist) { try { localStorage.setItem(EP_PANEL_STORAGE_KEY, String(h)); } catch {} }
}

function setupElevationPanelResize() {
  const handle = document.getElementById("ep-resize");
  const wrapper = document.getElementById("map-wrapper");
  if (!handle || !wrapper) return;
  let startY = 0, startH = 0, scale = 1, raf = 0, dragging = false;

  const relayout = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      map?.invalidateSize?.({ animate: false, pan: false });
    });
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    const panel = document.getElementById("ep-panel");
    startY = e.clientY;
    startH = panel.offsetHeight; // px do CSS (o app aplica escala na UI — ver ui_scale.js)
    scale = panel.getBoundingClientRect().height / (panel.offsetHeight || 1) || 1;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("ep-resizing");
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    setElevationPanelHeight(startH + (startY - e.clientY) / scale, false); // subir = aumentar
    relayout();
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("ep-resizing");
    setElevationPanelHeight(document.getElementById("ep-panel").offsetHeight, true);
    relayout();
  };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
  handle.addEventListener("dblclick", () => { setElevationPanelHeight(EP_PANEL_DEFAULT, true); relayout(); });
}

// Vários tiles podem falhar de uma vez: mostra o aviso no máximo 1x a cada 10 s.
const EP_TILE_ERROR_TOAST_MS = 10000;
let _epLastTileErrorToast = 0;

function ensureElevationProfileTool() {
  if (elevationProfileTool) return elevationProfileTool;
  if (!window.ElevationProfile || !map) return null;
  buildElevationProfileUI();
  elevationProfileTool = new ElevationProfile.ElevationPathTool(map, {
    canvas: document.getElementById("ep-canvas"),
    statsEl: document.getElementById("ep-stats"),
    onState: (s) => {
      if ("loading" in s) {
        const el = document.getElementById("ep-loading");
        el && (el.textContent = s.loading ? t("elevation_profile.loading_terrain", { tiles: s.tiles }) : "");
      }
    },
  }, {
    terrainOptions: {
      onError: (key, err) => {
        console.warn("Perfil de elevação: tile de terreno falhou", key, err);
        const now = Date.now();
        if (now - _epLastTileErrorToast < EP_TILE_ERROR_TOAST_MS) return;
        _epLastTileErrorToast = now;
        typeof mostrarMensagem == "function" && mostrarMensagem(t("elevation_profile.tile_error"), "erro");
      },
    },
  });
  return elevationProfileTool;
}

function setElevationPanelVisible(visible) {
  document.getElementById("ep-panel")?.classList.toggle("hidden", !visible);
  document.getElementById("map-wrapper")?.classList.toggle("ep-open", visible);
  map?.invalidateSize?.({ animate: false, pan: false });
  elevationProfileTool?.chart?.render();
}

function toggleModoPerfilElevacao() {
  const activating = !AppState.modoPerfilElevacao;
  activating && deactivateAllModes();

  if (activating && !ensureElevationProfileTool()) {
    typeof mostrarMensagem == "function" && mostrarMensagem(t("elevation_profile.unavailable"), "erro");
    return;
  }

  AppState.modoPerfilElevacao = activating;
  document.getElementById("btn-perfil-elevacao")?.classList.toggle("glass-button-active", activating);
  setElevationPanelVisible(activating);

  if (activating) {
    elevationProfileTool.start();
    typeof mostrarMensagem == "function" && mostrarMensagem(t("elevation_profile.start_hint"), "info");
  } else {
    elevationProfileTool.drawing && elevationProfileTool.finish();
    elevationProfileTool.clear();
  }
}

function closeElevationProfile() {
  AppState.modoPerfilElevacao && toggleModoPerfilElevacao();
}

// Ao trocar o idioma, redesenha a barra de estatísticas e o gráfico no novo idioma.
document.addEventListener("i18n:applied", () => {
  if (!elevationProfileTool) return;
  elevationProfileTool._renderStats?.();
  elevationProfileTool.chart?.render();
});

window.toggleModoPerfilElevacao = toggleModoPerfilElevacao;
window.closeElevationProfile = closeElevationProfile;