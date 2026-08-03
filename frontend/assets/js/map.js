let map;

function ensureAppState() {
  window.AppState || (window.AppState = {});
  const state = window.AppState;
  "visadaVisivel" in state || (state.visadaVisivel = true);
  "visadaLayerGroup" in state || (state.visadaLayerGroup = null);
  "antenaCandidatesLayerGroup" in state || (state.antenaCandidatesLayerGroup = null);
}

function initMap() {
  ensureAppState();
  if (map && map.remove) {
    try {
      map.off();
      map.remove();
    } catch {}
    map = null;
  }

  const mapContainer = document.getElementById("map");
  if (!mapContainer) {
    console.error("Elemento #map não encontrado.");
    return;
  }

  map = L.map(mapContainer, {
    zoomControl: false,
    preferCanvas: true,
    zoomAnimation: true,
    zoomAnimationThreshold: 1,
    fadeAnimation: false,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelDebounceTime: 40,
    wheelPxPerZoomLevel: 90,
    scrollWheelZoom: true,
    inertia: true,
    inertiaDeceleration: 2500,
    inertiaMaxSpeed: 1500
  }).setView([-15, -55], 5);

  L.tileLayer(`${window.BACKEND_URL}${window.API_PREFIX}/tiles/satellite/{z}/{x}/{y}`, {
    maxZoom: 20,
    attribution: "",
    crossOrigin: true,
    // Only fetch tiles once the zoom animation settles, instead of mid-animation:
    // avoids firing dozens of concurrent tile requests during a fast wheel-zoom,
    // which was overwhelming the tile proxy and tripping ERR_HTTP2_PROTOCOL_ERROR.
    updateWhenZooming: false,
    updateInterval: 150,
    keepBuffer: 4
  }).addTo(map);

  AppState.visadaLayerGroup = L.layerGroup().addTo(map);
  AppState.antenaCandidatesLayerGroup = L.layerGroup().addTo(map);

  typeof criarGradienteVisada == "function" && criarGradienteVisada();

  window.candidateRepeaterSitesLayerGroup || (
    window.candidateRepeaterSitesLayerGroup = L.layerGroup().addTo(map),
    console.log("candidateRepeaterSitesLayerGroup inicializado e adicionado ao mapa.")
  );

  const visadaBtn = document.getElementById("btn-visada");
  if (visadaBtn) {
    visadaBtn.addEventListener("click", toggleVisada);
    visadaBtn.classList.toggle("glass-button-active", !AppState.visadaVisivel);
    visadaBtn.setAttribute("aria-pressed", String(AppState.visadaVisivel));
  } else {
    console.error("Botão #btn-visada não encontrado.");
  }

  setupCandidateRemovalListener();

  map.on("zoomend", () => {
    if (typeof updatePivotIcons == "function") {
      try {
        updatePivotIcons();
      } catch (err) {
        console.warn("updatePivotIcons lançou erro:", err);
      }
    }
  });

  window.addEventListener("resize", () => {
    map && map.invalidateSize && map.invalidateSize();
  });

  applyVisadaVisibility();
}

function setVisadaVisible(visible) {
  ensureAppState();
  AppState.visadaVisivel = !!visible;
  applyVisadaVisibility();

  const visadaBtn = document.getElementById("btn-visada");
  if (visadaBtn) {
    visadaBtn.classList.toggle("glass-button-active", !AppState.visadaVisivel);
    visadaBtn.setAttribute("aria-pressed", String(AppState.visadaVisivel));
  }
}

function applyVisadaVisibility() {
  const visadaLayerGroup = AppState.visadaLayerGroup;
  if (!visadaLayerGroup) return;

  const isVisible = !!AppState.visadaVisivel;

  const applyToLayer = (layer) => {
    const opacity = isVisible ? 1 : 0;

    if (layer && typeof layer.getLayers == "function") {
      layer.getLayers().forEach(applyToLayer);
      return;
    }

    if (typeof layer.setOpacity == "function") {
      try {
        layer.setOpacity(opacity);
      } catch {}
      layer._image && (layer._image.style.pointerEvents = isVisible ? "auto" : "none");
      return;
    }

    if (typeof layer.setStyle == "function") {
      if (layer.options && typeof layer.options.__fillOpacityOriginal > "u") {
        const originalFillOpacity = typeof layer.options.fillOpacity == "number" ? layer.options.fillOpacity : 0.5;
        layer.options.__fillOpacityOriginal = originalFillOpacity;
      }
      const fillOpacity = layer.options?.__fillOpacityOriginal ?? 0.5;
      try {
        layer.setStyle({
          opacity: opacity,
          fillOpacity: isVisible ? fillOpacity : 0
        });
      } catch {}
      layer._path && (layer._path.style.pointerEvents = isVisible ? "auto" : "none");
      return;
    }

    if (layer && typeof layer.getElement == "function") {
      const el = layer.getElement();
      el && (el.style.opacity = opacity, el.style.pointerEvents = isVisible ? "auto" : "none");
      return;
    }

    layer && layer._icon && (layer._icon.style.opacity = opacity, layer._icon.style.pointerEvents = isVisible ? "auto" : "none");
  };

  visadaLayerGroup.eachLayer(applyToLayer);
  console.log(`Visada: ${isVisible ? "Ativada" : "Desativada"}`);
}

function toggleVisada() {
  setVisadaVisible(!AppState.visadaVisivel);
}

function setupCandidateRemovalListener() {
  if (!map) {
    console.error("Mapa não inicializado.");
    return;
  }

  map.on("click", function(event) {
    const target = event.originalEvent?.target;
    if (!target || !target.classList || !target.classList.contains("candidate-remove-btn")) {
      return;
    }

    const markerId = target.dataset.markerId;
    if (!markerId) return;

    L.DomEvent.stop(event);

    if (window.candidateRepeaterSitesLayerGroup) {
      const layersToRemove = [];
      window.candidateRepeaterSitesLayerGroup.eachLayer((layer) => {
        layer?.options?.customId === markerId && layersToRemove.push(layer);
      });

      if (layersToRemove.length) {
        layersToRemove.forEach((layer) => window.candidateRepeaterSitesLayerGroup.removeLayer(layer));
        console.log("Candidato removido:", markerId);
        typeof mostrarMensagem == "function" && mostrarMensagem(t("messages.success.repeater_suggestion_removed"), "sucesso");
      } else {
        console.warn("Nenhuma camada encontrada para remover:", markerId);
      }
    }
  });
}

window.initMap = initMap;
window.setVisadaVisible = setVisadaVisible;
