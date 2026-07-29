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
