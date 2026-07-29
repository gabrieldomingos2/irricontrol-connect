let tempPacmanShape = null;

function generatePacmanCoords(center, radius, startBearing, endBearing, steps = 80) {
  let start = startBearing;
  let end = endBearing;
  end <= start && (end += 360);

  const coords = [[center.lat, center.lng]];
  const arcWidth = 360 - (end - start);

  for (let i = 0; i <= steps; i++) {
    const bearing = end + i * arcWidth / steps;
    const point = center.destination(radius, bearing);
    coords.push([point.lat, point.lng]);
  }

  coords.push([center.lat, center.lng]);
  return coords;
}

function drawTempPacman(center, radiusPoint, cursorPoint) {
  if (tempPacmanShape) {
    map.removeLayer(tempPacmanShape);
    tempPacmanShape = null;
  }

  if (radiusPoint) {
    const radius = center.distanceTo(radiusPoint);
    const startBearing = calculateBearing(center, radiusPoint);
    const endBearing = calculateBearing(center, cursorPoint);
    const coords = generatePacmanCoords(center, radius, startBearing, endBearing);
    tempPacmanShape = L.polygon(coords, {
      color: "#D97706",
      weight: 3,
      dashArray: "8, 8",
      fillColor: "#D97706",
      fillOpacity: 0.2,
      interactive: false
    }).addTo(map);
  } else {
    const radius = center.distanceTo(cursorPoint);
    radius > 5 && (tempPacmanShape = L.circle(center, {
      radius,
      color: "#D97706",
      weight: 3,
      dashArray: "5, 5",
      fillColor: "#D97706",
      fillOpacity: 0.1,
      interactive: false
    }).addTo(map));
  }
}

function removeTempPacman() {
  tempPacmanShape && (map.removeLayer(tempPacmanShape), tempPacmanShape = null);
}
