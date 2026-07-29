let tempSectorShape = null;

function drawTempSector(center, edge) {
  const radius = center.distanceTo(edge);
  if (radius < 5) return;

  const bearing = calculateBearing(center, edge);
  const coords = generateSectorCoords(center, radius, bearing, 180);

  if (tempSectorShape) {
    tempSectorShape.setLatLngs(coords);
    return;
  }

  tempSectorShape = L.polygon(coords, {
    color: "#D97706",
    weight: 3,
    dashArray: "8, 8",
    fillColor: "#D97706",
    fillOpacity: 0.2,
    interactive: false
  }).addTo(map);
}

function removeTempSector() {
  tempSectorShape && (map.removeLayer(tempSectorShape), tempSectorShape = null);
}

function calculateBearing(from, to) {
  const toRad = (v) => v * Math.PI / 180;
  const fromLatRad = toRad(from.lat);
  const fromLonRad = toRad(from.lng);
  const toLatRad = toRad(to.lat);
  const toLonRad = toRad(to.lng);

  const y = Math.sin(toLonRad - fromLonRad) * Math.cos(toLatRad);
  const x = Math.cos(fromLatRad) * Math.sin(toLatRad) - Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(toLonRad - fromLonRad);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function generateSectorCoords(center, radius, centerBearing, arcWidth = 180) {
  const coords = [[center.lat, center.lng]];
  const startBearing = centerBearing - arcWidth / 2;
  const steps = 40;

  for (let i = 0; i <= steps; i++) {
    const bearing = startBearing + i * arcWidth / steps;
    const point = L.latLng(center).destination(radius, bearing);
    coords.push([point.lat, point.lng]);
  }

  return coords;
}

L.LatLng.prototype.destination || (L.LatLng.prototype.destination = function(distanceMeters, bearingDeg) {
  const toRad = (v) => v * Math.PI / 180;
  const toDeg = (v) => v * 180 / Math.PI;
  const bearingRad = toRad(bearingDeg);
  const latRad = toRad(this.lat);
  const lonRad = toRad(this.lng);

  const destLatRad = Math.asin(Math.sin(latRad) * Math.cos(distanceMeters / 6378137) + Math.cos(latRad) * Math.sin(distanceMeters / 6378137) * Math.cos(bearingRad));
  const destLonRad = lonRad + Math.atan2(Math.sin(bearingRad) * Math.sin(distanceMeters / 6378137) * Math.cos(latRad), Math.cos(distanceMeters / 6378137) - Math.sin(latRad) * Math.sin(destLatRad));

  return L.latLng(toDeg(destLatRad), toDeg(destLonRad));
});
