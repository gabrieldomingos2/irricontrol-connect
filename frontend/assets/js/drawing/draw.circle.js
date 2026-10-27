function drawCirculos() {
  if (!map) return;

  AppState.circulosPivos.forEach((circle) => map.removeLayer(circle));
  AppState.circulosPivos = [];

  AppState.lastPivosDataDrawn.forEach((pivot) => {
    const center = pivot.circle_center_lat && pivot.circle_center_lon
      ? L.latLng(pivot.circle_center_lat, pivot.circle_center_lon)
      : L.latLng(pivot.lat, pivot.lon);

    if (pivot.tipo === "custom" && Array.isArray(pivot.coordenadas) && pivot.coordenadas.length > 0) {
      const polygon = L.polygon(pivot.coordenadas, {
        color: "#cc0000",
        weight: 3,
        opacity: 0.9,
        fillOpacity: 0,
        className: "circulo-custom-kmz"
      }).addTo(map);
      AppState.circulosPivos.push(polygon);
    } else if (pivot.tipo === "setorial") {
      const coords = generateSectorCoords(center, pivot.raio, pivot.angulo_central, pivot.abertura_arco);
      const polygon = L.polygon(coords, {
        color: "#cc0000",
        weight: 3,
        opacity: 0.9,
        fillOpacity: 0,
        className: "circulo-pivo-setorial"
      }).addTo(map);
      AppState.circulosPivos.push(polygon);
    } else if (pivot.tipo === "pacman") {
      const coords = generatePacmanCoords(center, pivot.raio, pivot.angulo_inicio, pivot.angulo_fim);
      const polygon = L.polygon(coords, {
        color: "#cc0000",
        weight: 3,
        opacity: 0.9,
        fillOpacity: 0,
        className: "circulo-pivo-pacman"
      }).addTo(map);
      AppState.circulosPivos.push(polygon);
    } else {
      const circle = L.circle(center, {
        radius: pivot.raio || 100,
        color: "#cc0000",
        weight: 3,
        opacity: 0.9,
        fillOpacity: 0,
        className: "circulo-vermelho-pulsante"
      }).addTo(map);
      AppState.circulosPivos.push(circle);
    }
  });

  // Mantém AppState.ciclosGlobais (o que vai pro KMZ/PDF) igual ao que
  // está desenhado no mapa. Sem isso, editar o pivô (mover/redimensionar)
  // só mudava o desenho na tela e o KMZ saía com a 1ª versão do círculo.
  syncCiclosComPivos();
}

// Recalcula as coordenadas de cada "Ciclo <nome>" a partir do estado
// ATUAL do pivô (centro + raio, ou polígono custom). Setorial/pacman
// não entram: o backend gera a área deles direto dos dados do pivô.
function syncCiclosComPivos() {
  if (!Array.isArray(AppState.ciclosGlobais)) AppState.ciclosGlobais = [];
  const ciclos = AppState.ciclosGlobais;

  (AppState.lastPivosDataDrawn || []).forEach((pivot) => {
    if (!pivot || pivot.tipo === "setorial" || pivot.tipo === "pacman") return;

    const nomeCiclo = `Ciclo ${pivot.nome}`;
    const existing = ciclos.find((c) => c.nome_original_circulo === nomeCiclo);
    const temRaio = typeof pivot.raio === "number" && pivot.raio > 0;

    let coords = null;
    if (pivot.tipo === "custom" && Array.isArray(pivot.coordenadas) && pivot.coordenadas.length > 2) {
      coords = pivot.coordenadas.map(([lat, lon]) => [lat, lon]);
    } else if (temRaio) {
      const center = pivot.circle_center_lat !== undefined && pivot.circle_center_lon !== undefined
        ? L.latLng(pivot.circle_center_lat, pivot.circle_center_lon)
        : L.latLng(pivot.lat, pivot.lon);
      coords = generateCircleCoords(center, pivot.raio);
    }
    if (!coords) return;

    if (existing) existing.coordenadas = coords;
    else if (temRaio) ciclos.push({ nome_original_circulo: nomeCiclo, coordenadas: coords });
  });
}

let tempCircle = null;

function drawTempCircle(center, edge) {
  const radius = center.distanceTo(edge);
  if (tempCircle) {
    tempCircle.setLatLng(center).setRadius(radius);
    return;
  }
  tempCircle = L.circle(center, {
    radius,
    color: "#D97706",
    weight: 3,
    dashArray: "5, 5",
    fillColor: "#D97706",
    fillOpacity: 0.1,
    interactive: false
  }).addTo(map);
}

function removeTempCircle() {
  tempCircle && (map.removeLayer(tempCircle), tempCircle = null);
}

function generateCircleCoords(center, radiusMeters, steps = 128) {
  const coords = [];
  const latRad = center.lat * (Math.PI / 180);
  const lonRad = center.lng * (Math.PI / 180);

  for (let i = 0; i < steps; i++) {
    const bearingRad = i / steps * 360 * (Math.PI / 180);
    const destLatRad = Math.asin(Math.sin(latRad) * Math.cos(radiusMeters / 6378137) + Math.cos(latRad) * Math.sin(radiusMeters / 6378137) * Math.cos(bearingRad));
    const destLonRad = lonRad + Math.atan2(Math.sin(bearingRad) * Math.sin(radiusMeters / 6378137) * Math.cos(latRad), Math.cos(radiusMeters / 6378137) - Math.sin(latRad) * Math.sin(destLatRad));
    coords.push([destLatRad * (180 / Math.PI), destLonRad * (180 / Math.PI)]);
  }

  coords.push(coords[0]);
  return coords;
}
