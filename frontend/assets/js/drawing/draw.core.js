const TORRE_ICON_PATH = "assets/images/cloudrf.png";
const BOMBA_ICON_AZUL_PATH = "assets/images/homegardenbusiness.png";
const BOMBA_ICON_VERMELHO_PATH = "assets/images/homegardenbusiness-red.png";
const ATTENTION_ICON_PATH = "assets/images/attention-icon-original.svg";
const CHECK_ICON_PATH = "assets/images/circle-check-big.svg";
const MOUNTAIN_ICON_PATH = "assets/images/attention-icon-original.svg";
const CAPTIONS_ON_ICON_PATH = "assets/images/captions.svg";
const CAPTIONS_OFF_ICON_PATH = "assets/images/captions-off.svg";

(function() {
  window.AppState || (window.AppState = {});
  AppState.marcadoresLegenda ??= [];
  AppState.marcadoresPivos ??= [];
  AppState.marcadoresBombas ??= [];
  AppState.circulosPivos ??= [];
  AppState.overlaysVisiveis ??= [];
  AppState.pivotsMap ??= {};
  AppState.idsDisponiveis ??= [];
  AppState.repetidoras ??= [];
  AppState.lastPivosDataDrawn ??= [];
  AppState.lastBombasDataDrawn ??= [];
  AppState.visadaLayerGroup ??= null;
  AppState.antenaCandidatesLayerGroup ??= null;
})();

const antenaIcon = L.divIcon({
  className: "leaflet-div-icon-transparent",
  html: `<div class="selection-effect-wrapper"><img src="${TORRE_ICON_PATH}" style="width:28px;height:28px;"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28]
});
const bombaIconAzul = L.divIcon({
  className: "leaflet-div-icon-transparent",
  html: `<div class="selection-effect-wrapper"><img src="${BOMBA_ICON_AZUL_PATH}" style="width:28px;height:28px;"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28]
});
const bombaIconVermelho = L.divIcon({
  className: "leaflet-div-icon-transparent",
  html: `<div class="selection-effect-wrapper"><img src="${BOMBA_ICON_VERMELHO_PATH}" style="width:28px;height:28px;"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28]
});
const posicionamentoIcon = L.icon({
  iconUrl: TORRE_ICON_PATH,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -30]
});

window.antenaIcon = antenaIcon;
window.bombaIconAzul = bombaIconAzul;
window.bombaIconVermelho = bombaIconVermelho;
window.posicionamentoIcon = posicionamentoIcon;

function getDynamicIconSize(zoom) {
  if (zoom <= 10) return 10;
  if (zoom >= 17) return 20;
  const interpolated = (zoom - 10) / 7 * 10 + 10;
  return Math.round(interpolated);
}

function updatePivotIcons() {
  if (!map || !Array.isArray(AppState.lastPivosDataDrawn) || !Array.isArray(AppState.marcadoresPivos)) return;

  const iconSize = getDynamicIconSize(map.getZoom());
  AppState.lastPivosDataDrawn.forEach((pivot, index) => {
    const marker = AppState.marcadoresPivos[index];
    if (!marker) return;

    const color = pivot.fora ? "red" : "green";
    let className = "pivo-marker-container";
    AppState.selectedPivoNome === pivot.nome && (className += " pivo-marker-container-selected");

    const icon = L.divIcon({
      className,
      iconSize: [iconSize, iconSize],
      html: `<div class="pivo-marker-dot" style="background-color:${color};"></div>`
    });
    marker.setIcon(icon);
  });
}

function findClosestSignalSource(fromLatLng) {
  let closest = null;
  let closestDistance = Infinity;

  const antennaVisibilityBtn = document.querySelector("#antena-item button[data-visible]");
  const antennaIsVisible = !antennaVisibilityBtn || antennaVisibilityBtn.getAttribute("data-visible") === "true";

  if (AppState.antenaGlobal && antennaIsVisible) {
    const antennaLatLng = L.latLng(AppState.antenaGlobal.lat, AppState.antenaGlobal.lon);
    const distance = fromLatLng.distanceTo(antennaLatLng);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = {
        id: "main_antenna",
        name: AppState.antenaGlobal.nome || t("ui.labels.main_antenna_default"),
        distance,
        isMainAntenna: true,
        type: AppState.antenaGlobal.type
      };
    }
  }

  AppState.repetidoras.forEach((rep) => {
    const visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
    const isVisible = !visibilityBtn || visibilityBtn.getAttribute("data-visible") === "true";
    if (!rep.marker || !isVisible) return;

    const repLatLng = rep.marker.getLatLng();
    const distance = fromLatLng.distanceTo(repLatLng);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = {
        id: rep.id,
        name: rep.nome,
        distance,
        isMainAntenna: false,
        type: rep.type
      };
    }
  });

  return closest;
}

function getFormattedAntennaOrRepeaterName(entity) {
  if (!entity) return "";

  const rawName = entity.nome || "";
  const showHeightSuffix = entity.is_from_kmz && entity.had_height_in_kmz;
  const heightSuffixPattern = /(?:\s*-?\s*\d+(?:\.\d+)?\s*m)+$/i;
  const baseName = showHeightSuffix ? rawName.replace(heightSuffixPattern, "").trim() : rawName.trim();

  if (showHeightSuffix) {
    const heightSuffix = entity.altura != null ? ` - ${entity.altura}m` : "";
    return `${baseName}${heightSuffix}`;
  }
  return baseName;
}

function drawImageOverlay(imagePath, bounds, opacity = 1) {
  if (!map || !imagePath || !bounds) return null;

  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const backend = window.BACKEND_URL ?? (isLocal ? "http://localhost:8000" : "https://irricontrol-connect.onrender.com");
  const fullUrl = /^https?:/.test(imagePath) ? imagePath : `${backend}${imagePath}`;

  const south = Math.min(bounds[0], bounds[2]);
  const north = Math.max(bounds[0], bounds[2]);
  const west = Math.min(bounds[1], bounds[3]);
  const east = Math.max(bounds[1], bounds[3]);

  const overlay = L.imageOverlay(fullUrl, [[south, west], [north, east]], {
    opacity,
    interactive: false,
    crossOrigin: true
  }).addTo(map);

  AppState.overlaysVisiveis.push(overlay);
  return overlay;
}

function fitMapToAllElements() {
  if (!map) return;

  const points = [];

  (AppState.lastPivosDataDrawn || []).forEach((pivot) => {
    const center = pivot.circle_center_lat && pivot.circle_center_lon
      ? L.latLng(pivot.circle_center_lat, pivot.circle_center_lon)
      : L.latLng(pivot.lat, pivot.lon);

    let shape;
    if (pivot.tipo === "custom" && Array.isArray(pivot.coordenadas) && pivot.coordenadas.length > 0) {
      shape = pivot.coordenadas;
    } else if (pivot.tipo === "setorial") {
      shape = generateSectorCoords(center, pivot.raio, pivot.angulo_central, pivot.abertura_arco);
    } else if (pivot.tipo === "pacman") {
      shape = generatePacmanCoords(center, pivot.raio, pivot.angulo_inicio, pivot.angulo_fim);
    } else {
      shape = generateCircleCoords(center, pivot.raio || 100);
    }

    Array.isArray(shape) && shape.length > 0 ? shape.forEach((point) => points.push(point)) : points.push([pivot.lat, pivot.lon]);
  });

  (AppState.lastBombasDataDrawn || []).forEach((bomba) => points.push([bomba.lat, bomba.lon]));
  AppState.antenaGlobal && points.push([AppState.antenaGlobal.lat, AppState.antenaGlobal.lon]);
  (AppState.repetidoras || []).forEach((rep) => points.push([rep.lat, rep.lon]));

  points.length > 0 && map.fitBounds(points, { padding: [80, 80] });
}

function waitForMapReady(timeoutMs = 8000, pollIntervalMs = 150) {
  if (!map) return Promise.resolve();

  return new Promise((resolve) => {
    if (!map._animatingZoom && !map._panAnim?._inProgress) {
      resolve();
      return;
    }
    map.once("moveend", resolve);
  }).then(() => new Promise((resolve) => {
    const startTime = Date.now();
    const container = map.getContainer();

    function poll() {
      const images = container.querySelectorAll("img");
      const allLoaded = Array.from(images).every((img) => img.complete && img.naturalWidth > 0);
      allLoaded || Date.now() - startTime > timeoutMs ? resolve() : setTimeout(poll, pollIntervalMs);
    }
    poll();
  }));
}

function drawTileLayersOntoCanvas(ctx) {
  map.eachLayer((layer) => {
    if (!(layer instanceof L.GridLayer) || !layer._tiles) return;

    const tileSize = layer.getTileSize();
    Object.values(layer._tiles).forEach((tile) => {
      const el = tile.el;
      if (!tile.current || !el || !el.complete || !el.naturalWidth) return;

      const zoom = tile.coords.z;
      const nwPoint = tile.coords.scaleBy(tileSize);
      const sePoint = L.point(tile.coords.x + 1, tile.coords.y + 1).scaleBy(tileSize);
      const nw = map.latLngToContainerPoint(map.unproject(nwPoint, zoom));
      const se = map.latLngToContainerPoint(map.unproject(sePoint, zoom));

      try {
        ctx.drawImage(el, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
      } catch {}
    });
  });
}

function _preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

const _snapshotIconCache = {};

function _getSnapshotIcons() {
  return _snapshotIconCache.promise || (_snapshotIconCache.promise = Promise.all([
    _preloadImage(TORRE_ICON_PATH),
    _preloadImage(BOMBA_ICON_AZUL_PATH),
    _preloadImage(BOMBA_ICON_VERMELHO_PATH)
  ]).then(([torre, bombaAzul, bombaVermelho]) => ({ torre, bombaAzul, bombaVermelho })));
}

function _drawSnapshotLabel(ctx, text, x, y) {
  if (!text) return;
  ctx.font = "bold 11px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const padding = 5;
  const width = ctx.measureText(text).width + padding * 2;
  const height = 15;

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(x - width / 2, y, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y + height / 2 + 1);
}

function drawCoverageOverlaysOntoCanvas(ctx) {
  (AppState.overlaysVisiveis || []).forEach((overlay) => {
    const imageEl = overlay._image;
    const bounds = overlay.getBounds?.();
    if (!imageEl || !bounds || !imageEl.complete || !imageEl.naturalWidth) return;

    const nw = map.latLngToContainerPoint(bounds.getNorthWest());
    const se = map.latLngToContainerPoint(bounds.getSouthEast());

    try {
      ctx.drawImage(imageEl, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
    } catch {}
  });
}

function drawPivotShapesOntoCanvas(ctx) {
  (AppState.lastPivosDataDrawn || []).forEach((pivot) => {
    const center = pivot.circle_center_lat && pivot.circle_center_lon
      ? L.latLng(pivot.circle_center_lat, pivot.circle_center_lon)
      : L.latLng(pivot.lat, pivot.lon);

    let shape;
    if (pivot.tipo === "custom" && Array.isArray(pivot.coordenadas) && pivot.coordenadas.length > 0) {
      shape = pivot.coordenadas;
    } else if (pivot.tipo === "setorial") {
      shape = generateSectorCoords(center, pivot.raio, pivot.angulo_central, pivot.abertura_arco);
    } else if (pivot.tipo === "pacman") {
      shape = generatePacmanCoords(center, pivot.raio, pivot.angulo_inicio, pivot.angulo_fim);
    } else {
      shape = generateCircleCoords(center, pivot.raio || 100);
    }

    if (!Array.isArray(shape) || shape.length < 2) return;

    ctx.beginPath();
    shape.forEach(([lat, lon], index) => {
      const point = map.latLngToContainerPoint([lat, lon]);
      index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.strokeStyle = "#cc0000";
    ctx.lineWidth = 3;
    ctx.stroke();
  });
}

function _drawSnapshotIcon(ctx, image, point) {
  image?.naturalWidth && ctx.drawImage(image, point.x - 14, point.y - 28, 28, 28);
}

function drawEntitiesOntoCanvas(ctx, icons) {
  (AppState.lastPivosDataDrawn || []).forEach((pivot) => {
    const point = map.latLngToContainerPoint([pivot.lat, pivot.lon]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = pivot.fora ? "red" : "green";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    _drawSnapshotLabel(ctx, pivot.nome, point.x, point.y + 7);
  });

  (AppState.lastBombasDataDrawn || []).forEach((bomba, index) => {
    const point = map.latLngToContainerPoint([bomba.lat, bomba.lon]);
    _drawSnapshotIcon(ctx, bomba.fora === false ? icons.bombaAzul : icons.bombaVermelho, point);
    const label = bomba.nome || `Irripump ${String(index + 1).padStart(2, "0")}`;
    _drawSnapshotLabel(ctx, label, point.x, point.y + 4);
  });

  if (AppState.antenaGlobal) {
    const antenna = AppState.antenaGlobal;
    const point = map.latLngToContainerPoint([antenna.lat, antenna.lon]);
    _drawSnapshotIcon(ctx, icons.torre, point);
    _drawSnapshotLabel(ctx, getFormattedAntennaOrRepeaterName(antenna), point.x, point.y + 4);
  }

  (AppState.repetidoras || []).forEach((rep) => {
    const point = map.latLngToContainerPoint([rep.lat, rep.lon]);
    _drawSnapshotIcon(ctx, icons.torre, point);
    _drawSnapshotLabel(ctx, getFormattedAntennaOrRepeaterName(rep), point.x, point.y + 4);
  });
}

async function captureMapSnapshot() {
  if (!map) return null;

  try {
    await waitForMapReady();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const container = map.getContainer();
    const width = Math.round(container.clientWidth);
    const height = Math.round(container.clientHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    const icons = await _getSnapshotIcons();

    drawTileLayersOntoCanvas(ctx);
    drawCoverageOverlaysOntoCanvas(ctx);
    drawPivotShapesOntoCanvas(ctx);
    drawEntitiesOntoCanvas(ctx, icons);

    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("Falha ao capturar snapshot do mapa:", err);
    return null;
  }
}

function criarGradienteVisada(gradientId = "gradient-visada") {
  const overlayPane = map.getPane("overlayPane");
  let svg = overlayPane.querySelector("svg");

  if (!svg) {
    const tempLine = L.polyline([[0, 0], [0, 0]]).addTo(map);
    svg = overlayPane.querySelector("svg");
    map.removeLayer(tempLine);
    if (!svg) return;
  }

  if (svg.querySelector(`#${gradientId}`)) return;

  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  gradient.innerHTML = '<stop offset="0%" stop-color="green"/><stop offset="50%" stop-color="yellow"/><stop offset="100%" stop-color="red"/>';
  defs.appendChild(gradient);
}

function drawVisadaComGradiente(fromLatLng, toLatLng) {
  return L.polyline([fromLatLng, toLatLng], {
    color: "yellow",
    weight: 2,
    opacity: AppState.visadaVisivel ? 1 : 0,
    dashArray: "8 8"
  }).addTo(AppState.visadaLayerGroup);
}

function drawDiagnostico(fromLatLng, toLatLng, bloqueio, pontoMaisAlto, label, distanceLabel = null, profileResult = null, profileRequest = null, context = null) {
  if (!map || !AppState.visadaLayerGroup) return;

  const line = drawVisadaComGradiente(fromLatLng, toLatLng);
  const isCriticallyBlocked = bloqueio?.diff > 0.1;

  let iconPath, iconSize, markerLatLng, tooltipHtml, accentColor;

  if (isCriticallyBlocked) {
    iconPath = ATTENTION_ICON_PATH;
    iconSize = [24, 24];
    markerLatLng = [bloqueio.lat, bloqueio.lon];
    tooltipHtml = `<strong>${label}</strong>`;
    distanceLabel && (tooltipHtml += `<br>${t("ui.labels.pivo_distance_label")} ${distanceLabel}`);
    tooltipHtml += `<br>${t("tooltips.blockage_point", { elevation: bloqueio.elev.toFixed(1) })}`;
    accentColor = "#FF9800";
    tooltipHtml += `<br><span style="color:${accentColor};">${t("tooltips.blockage_present", { diff: bloqueio.diff.toFixed(1) })}</span>`;
  } else {
    iconPath = MOUNTAIN_ICON_PATH;
    iconSize = [22, 22];
    markerLatLng = [pontoMaisAlto.lat, pontoMaisAlto.lon];
    tooltipHtml = `<strong>${label}</strong>`;
    distanceLabel && (tooltipHtml += `<br>${t("ui.labels.pivo_distance_label")} ${distanceLabel}`);
    accentColor = "#FF9800";
    tooltipHtml += `<br><span style="color:${accentColor};">${t("tooltips.highest_point_short", { elevation: pontoMaisAlto.elev.toFixed(1) })}</span>`;
  }

  if (markerLatLng?.[0] && markerLatLng?.[1]) {
    const icon = L.divIcon({
      className: "label-bloqueio-dinamico blockage-icon-button",
      html: `<img src="${iconPath}" style="width:${iconSize[0]}px;height:${iconSize[1]}px;">`,
      iconSize,
      iconAnchor: [iconSize[0] / 2, iconSize[1] / 2]
    });

    const marker = L.marker(markerLatLng, { icon }).addTo(AppState.visadaLayerGroup).bindTooltip(tooltipHtml, {
      permanent: false,
      direction: "top",
      className: "tooltip-sinal tooltip-visada-diagnostico",
      offset: [0, -(iconSize[1] / 2 + 5)]
    });

    marker.on("click", () => {
      profileResult && profileRequest && window.Analysis3D
        ? window.Analysis3D.show(profileResult, profileRequest.altura_antena, profileRequest.altura_receiver, context)
        : console.warn("Dados do perfil de elevação não disponíveis para este ícone.");
    });

    AppState.marcadoresBloqueio?.push?.(marker);
  }

  AppState.linhasDiagnostico?.push?.(line);
}

function clearMapLayers() {
  if (!map) return;

  [
    AppState.marcadorAntena,
    AppState.antenaCandidatesLayerGroup,
    AppState.marcadorPosicionamento,
    AppState.visadaLayerGroup,
    window.candidateRepeaterSitesLayerGroup,
    ...AppState.marcadoresPivos || [],
    ...AppState.circulosPivos || [],
    ...AppState.marcadoresBombas || [],
    ...AppState.marcadoresLegenda || [],
    ...Object.values(AppState.pivotsMap || {})
  ].forEach((layer) => {
    layer && (typeof layer.clearLayers == "function" ? layer.clearLayers() : map.hasLayer(layer) && map.removeLayer(layer));
  });

  AppState.repetidoras.forEach((rep) => {
    rep.marker && map.removeLayer(rep.marker);
    rep.overlay && map.removeLayer(rep.overlay);
    rep.label && map.removeLayer(rep.label);
  });

  AppState.antenaGlobal?.overlay && map.removeLayer(AppState.antenaGlobal.overlay);
}
