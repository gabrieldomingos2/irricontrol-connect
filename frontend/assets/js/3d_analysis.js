window.Analysis3D = (() => {
  const modalEl = document.getElementById("modal-3d-analysis");
  const mapContainerEl = document.getElementById("map-3d-container");
  const profileChartCanvas = document.getElementById("profile-chart-canvas");
  const towerHeightSlider = document.getElementById("tower-height-slider-vertical") || document.getElementById("tower-height-slider");
  const towerHeightValueEl = document.getElementById("tower-height-value-vertical") || document.getElementById("tower-height-value");
  const receiverHeightSlider = document.getElementById("receiver-height-slider-vertical") || document.getElementById("receiver-height-slider");
  const receiverHeightValueEl = document.getElementById("receiver-height-value-vertical") || document.getElementById("receiver-height-value");
  const closeModalBtn = document.getElementById("close-3d-modal-btn");

  let mapboxMap;
  let profileChart;
  let elevationProfile = [];
  let receiverHeight = 3;
  let towerHeight = 5;

  function destinationPoint(lat, lon, distanceMeters, bearingDeg) {
    const toRad = (v) => v * Math.PI / 180;
    const toDeg = (v) => v * 180 / Math.PI;
    const bearingRad = toRad(bearingDeg);
    const latRad = toRad(lat);
    const lonRad = toRad(lon);
    const angularDistance = distanceMeters / 6378137;

    const destLatRad = Math.asin(Math.sin(latRad) * Math.cos(angularDistance) + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad));
    const destLonRad = lonRad + Math.atan2(Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad), Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(destLatRad));

    return [toDeg(destLonRad), toDeg(destLatRad)];
  }

  function buildCirclePolygon(center, radiusMeters, steps = 64) {
    const ring = [];
    for (let i = 0; i < steps; i++) {
      const bearing = i / steps * 360;
      ring.push(destinationPoint(center.lat, center.lon, radiusMeters, bearing));
    }
    ring.push(ring[0]);
    return [ring];
  }

  function drawPivotOverlays(context) {
    if (!mapboxMap || !context) return;

    const features = [];
    (context.pivos || []).forEach((pivot) => {
      if (pivot.tipo === "custom" && Array.isArray(pivot.coordenadas)) {
        const ring = pivot.coordenadas.map((coord) => [coord[1], coord[0]]);
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ring] }
        });
      } else if (pivot.raio) {
        const center = {
          lat: pivot.circle_center_lat || pivot.lat,
          lon: pivot.circle_center_lon || pivot.lon
        };
        const polygon = buildCirclePolygon(center, pivot.raio);
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: polygon }
        });
      }
    });

    const geojson = { type: "FeatureCollection", features };
    const existingSource = mapboxMap.getSource("pivots-source");
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      mapboxMap.addSource("pivots-source", { type: "geojson", data: geojson });
    }

    mapboxMap.getLayer("pivots-layer-line") || mapboxMap.addLayer({
      id: "pivots-layer-line",
      type: "line",
      source: "pivots-source",
      paint: {
        "line-color": "#FF4136",
        "line-width": 2,
        "line-opacity": 0.8
      }
    });
  }

  function computeLosLine(towerHeightMeters) {
    const startElev = elevationProfile[0].elev + towerHeightMeters;
    const endElev = elevationProfile[elevationProfile.length - 1].elev + receiverHeight;
    let isBlocked = false;

    return {
      points: elevationProfile.map((point, index) => {
        const fraction = index / (elevationProfile.length - 1);
        const losElev = startElev + fraction * (endElev - startElev);
        point.elev > losElev && (isBlocked = true);
        return losElev;
      }),
      isBlocked
    };
  }

  function updateLosLine(newTowerHeight = null) {
    newTowerHeight != null && (towerHeight = newTowerHeight);
    towerHeightValueEl && (towerHeightValueEl.textContent = `${Number(towerHeight).toFixed(0)} m`);
    receiverHeightValueEl && (receiverHeightValueEl.textContent = `${Number(receiverHeight).toFixed(0)} m`);

    const losLine = computeLosLine(Number(towerHeight));

    if (profileChart) {
      profileChart.data.datasets[1].data = losLine.points;
      profileChart.data.datasets[1].borderColor = losLine.isBlocked ? "#ef4444" : "#22c55e";
      profileChart.update("none");
    }

    mapboxMap && mapboxMap.getLayer("los-line-layer") && mapboxMap.setPaintProperty("los-line-layer", "line-color", losLine.isBlocked ? "#ef4444" : "#22c55e");
  }

  function initMapboxScene(profile, losLine, context) {
    // Token buscado do backend (bootstrap.js:loadMapboxToken), não mais
    // hardcoded aqui — ver simulation.py:/mapbox_token.
    mapboxgl.accessToken = window.MAPBOX_ACCESS_TOKEN;
    mapboxMap = new mapboxgl.Map({
      container: mapContainerEl,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [profile[0].lon, profile[0].lat],
      zoom: 14
    });

    mapboxMap.on("load", () => {
      mapboxMap.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1"
      });
      mapboxMap.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

      const startCoord = [profile[0].lon, profile[0].lat];
      const endCoord = [profile[profile.length - 1].lon, profile[profile.length - 1].lat];

      new mapboxgl.Marker({ color: "#22c55e", scale: 0.8 }).setLngLat(startCoord).addTo(mapboxMap);
      new mapboxgl.Marker({ color: "#f87171", scale: 0.8 }).setLngLat(endCoord).addTo(mapboxMap);

      mapboxMap.addSource("los-line-source", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [startCoord, endCoord] }
        }
      });

      mapboxMap.addLayer({
        id: "los-line-layer",
        type: "line",
        source: "los-line-source",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": losLine.isBlocked ? "#ef4444" : "#22c55e",
          "line-width": 4,
          "line-dasharray": [2, 2]
        }
      });

      drawPivotOverlays(context);

      const bounds = new mapboxgl.LngLatBounds(startCoord, endCoord);
      mapboxMap.fitBounds(bounds, { padding: { top: 100, bottom: 100, left: 50, right: 50 } });
    });
  }

  function renderProfileChart(losLine) {
    profileChart && profileChart.destroy();

    const startLatLng = L.latLng(elevationProfile[0].lat, elevationProfile[0].lon);
    const endLatLng = L.latLng(elevationProfile[elevationProfile.length - 1].lat, elevationProfile[elevationProfile.length - 1].lon);
    const totalDistance = startLatLng.distanceTo(endLatLng);
    const labels = elevationProfile.map((point) => (point.dist * totalDistance).toFixed(0) + "m");
    const terrainData = elevationProfile.map((point) => point.elev);

    profileChart = new Chart(profileChartCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: t("ui.chart_labels.terrain"),
          data: terrainData,
          borderColor: "rgba(156, 163, 175, 0.7)",
          backgroundColor: "rgba(156, 163, 175, 0.3)",
          fill: "start",
          pointRadius: 0,
          borderWidth: 1.5
        }, {
          label: t("ui.chart_labels.line_of_sight"),
          data: losLine.points,
          borderColor: losLine.isBlocked ? "#ef4444" : "#22c55e",
          borderWidth: 3,
          pointRadius: 0,
          fill: false
        }]
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          y: {
            title: {
              display: true,
              text: t("ui.chart_labels.elevation_m"),
              color: "#9ca3af"
            }
          },
          x: {
            title: {
              display: true,
              text: t("ui.chart_labels.distance_m"),
              color: "#9ca3af"
            },
            ticks: {
              color: "#9ca3af",
              maxRotation: 45,
              minRotation: 45
            }
          }
        },
        plugins: {
          legend: {
            labels: { color: "#d1d5db" }
          }
        }
      }
    });
  }

  function show(profileResult, initialTowerHeight, initialReceiverHeight, context) {
    elevationProfile = profileResult.perfil;
    towerHeight = Number(initialTowerHeight ?? towerHeight);
    receiverHeight = Number(initialReceiverHeight ?? receiverHeight);
    modalEl.classList.remove("hidden");

    const losLine = computeLosLine(towerHeight);
    setTimeout(() => {
      if (window.MAPBOX_ACCESS_TOKEN) {
        initMapboxScene(elevationProfile, losLine, context);
      } else {
        console.warn("Mapa 3D indisponível: token do Mapbox não foi carregado do servidor.");
        typeof mostrarMensagem == "function" && mostrarMensagem(t("messages.errors.mapbox_token_unavailable"), "erro");
      }
      renderProfileChart(losLine);
    }, 50);

    towerHeightSlider && (towerHeightSlider.value = towerHeight);
    towerHeightValueEl && (towerHeightValueEl.textContent = `${towerHeight} m`);
    receiverHeightSlider && (receiverHeightSlider.value = receiverHeight);
    receiverHeightValueEl && (receiverHeightValueEl.textContent = `${receiverHeight} m`);
  }

  towerHeightSlider && towerHeightSlider.addEventListener("input", (event) => {
    updateLosLine(parseFloat(event.target.value));
  });

  receiverHeightSlider && receiverHeightSlider.addEventListener("input", (event) => {
    receiverHeight = parseFloat(event.target.value);
    updateLosLine();
  });

  closeModalBtn && closeModalBtn.addEventListener("click", () => {
    modalEl.classList.add("hidden");
    mapboxMap && (mapboxMap.remove(), mapboxMap = null);
    profileChart && (profileChart.destroy(), profileChart = null);
  });

  return { show };
})();
