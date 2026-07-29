function findMatchingBomba(bombas, target) {
  if (!Array.isArray(bombas) || !target) return null;
  const tolerance = 1e-5;
  const byCoords = bombas.find((b) => typeof b.lat == "number" && typeof b.lon == "number" && Math.abs(b.lat - target.lat) <= tolerance && Math.abs(b.lon - target.lon) <= tolerance);
  return byCoords || bombas.find((b) => b.nome && target.nome && b.nome.trim() === target.nome.trim()) || null;
}

async function handleIrripumpDrawClick(event) {
  if (!AppState.jobId) {
    mostrarMensagem(t("messages.errors.session_not_started_for_draw"), "erro");
    toggleModoDesenhoIrripump();
    return;
  }

  mostrarLoader(true);
  try {
    const nextNumber = AppState.lastBombasDataDrawn.length + 1;
    const name = `${t("entity_names.irripump")} ${String(nextNumber).padStart(2, "0")}`;
    const bomba = {
      nome: name,
      lat: event.latlng.lat,
      lon: event.latlng.lng,
      fora: true
    };

    AppState.lastBombasDataDrawn.push(bomba);
    drawBombas(AppState.lastBombasDataDrawn);
    atualizarPainelDados();
    await reavaliarPivosViaAPI();
    mostrarMensagem(t("messages.success.irripump_created", { name }), "sucesso");
    setTimeout(() => {
      AppState.modoDesenhoIrripump && mostrarMensagem(t("messages.info.draw_irripump_still_active"), "info");
    }, 2500);
  } catch (err) {
    console.error("Falha ao criar o Irripump:", err);
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
  } finally {
    mostrarLoader(false);
  }
}

function toggleModoDesenhoPivo() {
  const activating = !AppState.modoDesenhoPivo;
  activating && deactivateAllModes();
  AppState.modoDesenhoPivo = activating;

  document.getElementById("btn-draw-pivot")?.classList.toggle("glass-button-active", AppState.modoDesenhoPivo);

  if (AppState.modoDesenhoPivo) {
    map.getContainer().style.cursor = "crosshair";
    mostrarMensagem(t("messages.info.draw_pivot_step1"), "info");
    map.on("click", handlePivotDrawClick);
    map.on("mousemove", handlePivotDrawMouseMove);
  } else {
    map.getContainer().style.cursor = "";
    AppState.centroPivoTemporario = null;
    typeof removeTempCircle == "function" && removeTempCircle();
    removeDrawingTooltip(map);
    mostrarMensagem(t("messages.info.draw_pivot_off"), "sucesso");
    map.off("click", handlePivotDrawClick);
    map.off("mousemove", handlePivotDrawMouseMove);
  }
}

function handlePivotDrawMouseMove(event) {
  if (AppState.modoDesenhoPivo && AppState.centroPivoTemporario) {
    typeof drawTempCircle == "function" && drawTempCircle(AppState.centroPivoTemporario, event.latlng);
    const radius = AppState.centroPivoTemporario.distanceTo(event.latlng);
    const label = `${t("ui.labels.radius")}: ${radius.toFixed(1)} m`;
    updateDrawingTooltip(map, event, label);
  }
}

async function handlePivotDrawClick(event) {
  if (!AppState.modoDesenhoPivo) return;

  if (!AppState.jobId) {
    mostrarMensagem(t("messages.errors.session_not_started_for_draw"), "erro");
    toggleModoDesenhoPivo();
    return;
  }

  if (!AppState.centroPivoTemporario) {
    AppState.centroPivoTemporario = event.latlng;
    mostrarMensagem(t("messages.info.draw_pivot_step2"), "info");
    return;
  }

  const clickLatLng = event.latlng;
  mostrarLoader(true);
  try {
    const requestPayload = {
      job_id: AppState.jobId,
      center: [AppState.centroPivoTemporario.lat, AppState.centroPivoTemporario.lng],
      pivos_atuais: AppState.lastPivosDataDrawn,
      language: localStorage.getItem("preferredLanguage") || "pt-br"
    };
    const radius = AppState.centroPivoTemporario.distanceTo(clickLatLng);
    const newPivot = {
      ...(await generatePivotInCircle(requestPayload)).novo_pivo,
      fora: true,
      raio: radius,
      circle_center_lat: AppState.centroPivoTemporario.lat,
      circle_center_lon: AppState.centroPivoTemporario.lng
    };
    const circleCoords = generateCircleCoords(AppState.centroPivoTemporario, radius);
    const ciclo = {
      nome_original_circulo: `Ciclo ${newPivot.nome}`,
      coordenadas: circleCoords
    };

    AppState.lastPivosDataDrawn.push(newPivot);
    AppState.ciclosGlobais.push(ciclo);
    AppState.currentProcessedKmzData?.pivos && AppState.currentProcessedKmzData.pivos.push(newPivot);
    AppState.currentProcessedKmzData?.ciclos && AppState.currentProcessedKmzData.ciclos.push(ciclo);
    typeof removeTempCircle == "function" && removeTempCircle();
    atualizarPainelDados();
    drawPivos(AppState.lastPivosDataDrawn, false);
    drawCirculos(AppState.ciclosGlobais);
    await reavaliarPivosViaAPI();
    mostrarMensagem(t("messages.success.pivot_created", { name: newPivot.nome }), "sucesso");
    setTimeout(() => {
      AppState.modoDesenhoPivo && mostrarMensagem(t("messages.info.draw_pivot_still_active"), "info");
    }, 2500);
  } catch (err) {
    console.error("Falha ao criar o pivô:", err);
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
    typeof removeTempCircle == "function" && removeTempCircle();
  } finally {
    AppState.centroPivoTemporario = null;
    mostrarLoader(false);
    removeDrawingTooltip(map);
  }
}

async function reavaliarPivosViaAPI() {
  if (!AppState.jobId || AppState.lastPivosDataDrawn.length === 0 && AppState.lastBombasDataDrawn.length === 0) return;

  let pivos = AppState.lastPivosDataDrawn.map((p) => ({
    nome: p.nome,
    lat: p.lat,
    lon: p.lon,
    type: "pivo"
  }));

  const bombas = (AppState.lastBombasDataDrawn || []).map((b) => ({
    nome: b.nome,
    lat: b.lat,
    lon: b.lon,
    type: "bomba"
  }));

  if (pivos.length === 0 && bombas.length > 0) {
    console.warn("Workaround: Enviando a primeira bomba como 'pivô' para forçar o processamento do backend.");
    const fakesPivo = { ...bombas[0], type: "pivo" };
    pivos.push(fakesPivo);
  }

  const overlays = [];
  const signalSources = [];
  const antennaVisibilityBtn = document.querySelector("#antena-item button[data-visible]");
  const antennaIsVisible = !antennaVisibilityBtn || antennaVisibilityBtn.getAttribute("data-visible") === "true";

  if (AppState.antenaGlobal && antennaIsVisible) {
    signalSources.push({ lat: AppState.antenaGlobal.lat, lon: AppState.antenaGlobal.lon });
    if (AppState.antenaGlobal.overlay && map.hasLayer(AppState.antenaGlobal.overlay) && AppState.antenaGlobal.imagem_filename) {
      const bounds = AppState.antenaGlobal.overlay.getBounds();
      overlays.push({
        id: "antena_principal",
        imagem: AppState.antenaGlobal.imagem_filename,
        bounds: [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]
      });
    }
  }

  AppState.repetidoras.forEach((rep) => {
    const visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
    const isVisible = !visibilityBtn || visibilityBtn.getAttribute("data-visible") === "true";
    if (isVisible) {
      signalSources.push({ lat: rep.lat, lon: rep.lon });
      if (rep.overlay && map.hasLayer(rep.overlay) && rep.imagem_filename) {
        const bounds = rep.overlay.getBounds();
        overlays.push({
          id: `repetidora_${rep.id}`,
          imagem: rep.imagem_filename,
          bounds: [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]
        });
      }
    }
  });

  try {
    const requestPayload = {
      job_id: AppState.jobId,
      pivos,
      bombas,
      overlays,
      signal_sources: signalSources
    };
    const result = await reevaluatePivots(requestPayload);

    if (result.pivos) {
      AppState.lastPivosDataDrawn = AppState.lastPivosDataDrawn.map((p) => {
        const updated = result.pivos.find((r) => r.nome.trim() === p.nome.trim());
        return updated ? { ...p, fora: updated.fora } : p;
      });
      drawPivos(AppState.lastPivosDataDrawn, false);
    }

    if (result.bombas) {
      AppState.lastBombasDataDrawn = AppState.lastBombasDataDrawn.map((b) => {
        const updated = findMatchingBomba(result.bombas, b);
        return updated ? { ...b, fora: updated.fora } : b;
      });
      drawBombas(AppState.lastBombasDataDrawn);
    }

    atualizarPainelDados();
  } catch (err) {
    console.error("Erro ao reavaliar cobertura via API:", err);
    mostrarMensagem(t("messages.errors.reevaluate_fail", { error: err.message }), "erro");
  }
}

function _getCircleCenter(pivot) {
  return pivot.circle_center_lat !== undefined && pivot.circle_center_lon !== undefined
    ? L.latLng(pivot.circle_center_lat, pivot.circle_center_lon)
    : L.latLng(pivot.lat, pivot.lon);
}

function _getPivotRadius(pivot) {
  if (typeof pivot.raio == "number" && pivot.raio > 0) return pivot.raio;
  if (pivot.coordenadas && pivot.coordenadas.length > 0) {
    const center = _getCircleCenter(pivot);
    let maxRadius = 0;
    for (const [lat, lon] of pivot.coordenadas) {
      const dist = center.distanceTo(L.latLng(lat, lon));
      dist > maxRadius && (maxRadius = dist);
    }
    return maxRadius;
  }
  return 0;
}

function createEditablePivotMarker(pivotData) {
  const name = pivotData.nome;
  const latLng = L.latLng(pivotData.lat, pivotData.lon);
  const undoBtn = document.getElementById("desfazer-edicao");
  const icon = L.divIcon({
    className: "pivo-edit-handle-custom-pin",
    html: '<svg viewBox="0 0 28 40" width="18" height="26" xmlns="http://www.w3.org/2000/svg"><path d="M14 0 C7.486 0 2 5.486 2 12.014 C2 20.014 14 40 14 40 C14 40 26 20.014 26 12.014 C26 5.486 20.514 0 14 0 Z M14 18 C10.686 18 8 15.314 8 12 C8 8.686 10.686 6 14 6 C17.314 6 20 8.686 20 12 C20 15.314 17.314 18 14 18 Z" fill="#FF3333" stroke="#660000" stroke-width="1"/></svg>',
    iconSize: [18, 26],
    iconAnchor: [9, 26]
  });
  const marker = L.marker(latLng, { draggable: true, icon }).addTo(map);
  AppState.pivotsMap[name] = marker;

  let dragStartLatLng = null;
  let dragStartSnapshot = null;

  marker.on("dragstart", (event) => {
    dragStartLatLng = event.target.getLatLng().clone();
    const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
    pivot && (dragStartSnapshot = JSON.parse(JSON.stringify(pivot)));
  });

  marker.on("drag", (event) => {
    const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
    if (!pivot || !dragStartLatLng) return;

    const newLatLng = event.target.getLatLng();
    if (!AppState.modoMoverPivoSemCirculo) {
      if (pivot.tipo === "custom" && pivot.coordenadas) {
        const deltaLat = newLatLng.lat - dragStartLatLng.lat;
        const deltaLng = newLatLng.lng - dragStartLatLng.lng;
        pivot.coordenadas = pivot.coordenadas.map(([lat, lon]) => [lat + deltaLat, lon + deltaLng]);
      }
      pivot.circle_center_lat !== undefined && (pivot.circle_center_lat = newLatLng.lat, pivot.circle_center_lon = newLatLng.lng);
    }

    drawCirculos();

    const resizeHandle = (AppState.resizeHandlesMap || {})[name];
    if (resizeHandle) {
      const currentPivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
      if (currentPivot) {
        const center = _getCircleCenter(currentPivot);
        const radius = _getPivotRadius(currentPivot);
        radius > 0 && resizeHandle.setLatLng(center.destination(radius, 90));
      }
    }

    dragStartLatLng = newLatLng.clone();
  });

  marker.on("dragend", async (event) => {
    const finalLatLng = event.target.getLatLng();
    const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);

    if (pivot && dragStartSnapshot) {
      const historyEntry = {
        type: "move",
        pivotName: name,
        from: { lat: dragStartSnapshot.lat, lon: dragStartSnapshot.lon },
        previousCoordenadas: dragStartSnapshot.coordenadas || null,
        previousCircleCenter: dragStartSnapshot.circle_center_lat !== undefined
          ? { lat: dragStartSnapshot.circle_center_lat, lon: dragStartSnapshot.circle_center_lon }
          : null
      };
      AppState.historyStack.push(historyEntry);
      undoBtn && (undoBtn.disabled = false);
    }

    pivot.lat = finalLatLng.lat;
    pivot.lon = finalLatLng.lng;
    dragStartLatLng = null;
    dragStartSnapshot = null;
    drawCirculos();
  });

  marker.on("contextmenu", async (event) => {
    L.DomEvent.stop(event);
    if (!AppState.modoEdicaoPivos) return;

    if (await showCustomConfirm(t("messages.confirm.remove_pivot", { name }))) {
      const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
      const cicloName = `Ciclo ${name}`;
      const ciclo = AppState.ciclosGlobais.find((c) => c.nome_original_circulo === cicloName);

      if (pivot) {
        const historyEntry = {
          type: "delete",
          deletedPivot: { ...pivot },
          deletedCiclo: ciclo ? { ...ciclo } : null
        };
        AppState.historyStack.push(historyEntry);
        undoBtn && (undoBtn.disabled = false);
      }

      map.removeLayer(marker);
      AppState.lastPivosDataDrawn = AppState.lastPivosDataDrawn.filter((p) => p.nome !== name);
      AppState.ciclosGlobais = AppState.ciclosGlobais.filter((c) => c.nome_original_circulo !== cicloName);
      drawCirculos();
      delete AppState.pivotsMap[name];
      mostrarMensagem(t("messages.success.pivot_removed", { name }), "sucesso");
      atualizarPainelDados();
    }
  });
}

function createResizeHandle(pivotData) {
  const name = pivotData.nome;
  const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
  if (!pivot) return;

  const radius = _getPivotRadius(pivot);
  if (radius <= 0) return;

  const center = _getCircleCenter(pivot);
  const icon = L.divIcon({
    className: "",
    html: '<div style="width:14px;height:14px;background:#f97316;border:2px solid #fff;border-radius:50%;cursor:ew-resize;box-shadow:0 1px 4px rgba(0,0,0,.7);"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
  const handle = L.marker(center.destination(radius, 90), {
    icon,
    draggable: true,
    zIndexOffset: 1600
  }).addTo(map);
  const undoBtn = document.getElementById("desfazer-edicao");

  let dragStartRadius = null;
  let dragStartCoords = null;

  handle.on("dragstart", () => {
    const currentPivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
    if (currentPivot) {
      dragStartRadius = typeof currentPivot.raio == "number" ? currentPivot.raio : null;
      dragStartCoords = currentPivot.coordenadas ? JSON.parse(JSON.stringify(currentPivot.coordenadas)) : null;
    }
  });

  handle.on("drag", (event) => {
    const currentPivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
    if (!currentPivot) return;

    const center = _getCircleCenter(currentPivot);
    const newRadius = center.distanceTo(event.target.getLatLng());
    if (newRadius < 10) return;

    if (typeof currentPivot.raio == "number") {
      currentPivot.raio = newRadius;
      if (currentPivot.tipo === "setorial") {
        currentPivot.coordenadas = generateSectorCoords(center, newRadius, currentPivot.angulo_central, currentPivot.abertura_arco);
      } else if (currentPivot.tipo === "pacman") {
        currentPivot.coordenadas = generatePacmanCoords(center, newRadius, currentPivot.angulo_inicio, currentPivot.angulo_fim);
      }
    } else if (currentPivot.coordenadas && currentPivot.coordenadas.length > 0) {
      const originalRadius = _getPivotRadius(currentPivot);
      if (originalRadius > 0) {
        const scale = newRadius / originalRadius;
        currentPivot.coordenadas = currentPivot.coordenadas.map(([lat, lon]) => [center.lat + (lat - center.lat) * scale, center.lng + (lon - center.lng) * scale]);
      }
    }

    drawCirculos();
  });

  handle.on("dragend", () => {
    if (AppState.lastPivosDataDrawn.find((p) => p.nome === name) && (dragStartRadius !== null || dragStartCoords !== null)) {
      AppState.historyStack.push({
        type: "resize",
        pivotName: name,
        previousRadius: dragStartRadius,
        previousCoordenadas: dragStartCoords
      });
      undoBtn && (undoBtn.disabled = false);
    }
    dragStartRadius = null;
    dragStartCoords = null;
  });

  AppState.resizeHandlesMap[name] = handle;
}

function enablePivoEditingMode() {
  AppState.modoEdicaoPivos = true;
  console.log("Ativando modo de edição.");
  AppState.historyStack = [];

  const undoBtn = document.getElementById("desfazer-edicao");
  undoBtn && (undoBtn.disabled = true);

  AppState.marcadoresPivos.forEach((marker) => map.removeLayer(marker));
  AppState.marcadoresPivos = [];

  AppState.marcadoresLegenda.filter((m) => m.options.labelType === "pivot").forEach((m) => map.hasLayer(m) && map.removeLayer(m));
  AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((m) => m.options.labelType !== "pivot");

  Object.values(AppState.pivotsMap).forEach((marker) => marker && map.hasLayer(marker) && map.removeLayer(marker));
  AppState.pivotsMap = {};

  Object.values(AppState.resizeHandlesMap || {}).forEach((handle) => handle && map.hasLayer(handle) && map.removeLayer(handle));
  AppState.resizeHandlesMap = {};

  AppState.lastPivosDataDrawn.forEach((pivot) => {
    createEditablePivotMarker(pivot);
    createResizeHandle(pivot);
  });

  mostrarMensagem(t("messages.info.edit_mode_activated"), "sucesso");
}

function disablePivoEditingMode() {
  console.log("Salvando e desativando modo de edição.");
  AppState.modoEdicaoPivos = false;

  Object.values(AppState.pivotsMap).forEach((marker) => {
    marker && map.hasLayer(marker) && map.removeLayer(marker);
  });
  AppState.pivotsMap = {};

  Object.values(AppState.resizeHandlesMap || {}).forEach((handle) => handle && map.hasLayer(handle) && map.removeLayer(handle));
  AppState.resizeHandlesMap = {};

  drawPivos(AppState.lastPivosDataDrawn, false);
  mostrarMensagem(t("messages.info.positions_updated_resimulate"), "sucesso");
  AppState.historyStack = [];

  const undoBtn = document.getElementById("desfazer-edicao");
  undoBtn && (undoBtn.disabled = true, undoBtn.classList.add("hidden"));

  const editBtn = document.getElementById("editar-pivos");
  if (editBtn) {
    editBtn.classList.remove("glass-button-active");
    editBtn.innerHTML = '<i data-lucide="pencil" class="w-5 h-5"></i>';
    lucide?.createIcons?.();
  }
}

function desfazerUltimaAcao() {
  if (AppState.historyStack.length === 0) {
    mostrarMensagem(t("messages.info.nothing_to_undo"), "info");
    return;
  }

  const action = AppState.historyStack.pop();
  const undoBtn = document.getElementById("desfazer-edicao");

  if (action.type === "move") {
    const { pivotName, from, previousCircleCenter, previousCoordenadas } = action;
    const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === pivotName);
    const marker = AppState.pivotsMap[pivotName];

    if (pivot && marker) {
      const restoredLatLng = L.latLng(from.lat, from.lon);
      pivot.lat = from.lat;
      pivot.lon = from.lon;
      previousCircleCenter && (pivot.circle_center_lat = previousCircleCenter.lat, pivot.circle_center_lon = previousCircleCenter.lon);
      previousCoordenadas && (pivot.coordenadas = previousCoordenadas);
      marker.setLatLng(restoredLatLng);
      drawCirculos();
      mostrarMensagem(t("messages.success.action_undone_move", { pivot_name: pivotName }), "sucesso");
    }
  } else if (action.type === "resize") {
    const { pivotName, previousRadius, previousCoordenadas } = action;
    const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === pivotName);

    if (pivot) {
      previousRadius !== null && (pivot.raio = previousRadius);
      previousCoordenadas && (pivot.coordenadas = previousCoordenadas);

      const handle = (AppState.resizeHandlesMap || {})[pivotName];
      if (handle) {
        const center = _getCircleCenter(pivot);
        const radius = _getPivotRadius(pivot);
        radius > 0 && handle.setLatLng(center.destination(radius, 90));
      }

      drawCirculos();
      mostrarMensagem(t("messages.success.action_undone_move", { pivot_name: pivotName }), "sucesso");
    }
  } else if (action.type === "delete") {
    const { deletedPivot, deletedCiclo } = action;
    AppState.lastPivosDataDrawn.push(deletedPivot);
    deletedCiclo && AppState.ciclosGlobais.push(deletedCiclo);
    createEditablePivotMarker(deletedPivot);
    drawCirculos();
    atualizarPainelDados();
    mostrarMensagem(t("messages.success.action_undone_delete", { pivot_name: deletedPivot.nome }), "sucesso");
  }

  undoBtn && AppState.historyStack.length === 0 && (undoBtn.disabled = true);
}

function handleToggleDistanciasPivos() {
  AppState.distanciasPivosVisiveis = !AppState.distanciasPivosVisiveis;

  const btn = document.getElementById("toggle-distancias-pivos");
  if (btn) {
    btn.classList.toggle("glass-button-active", AppState.distanciasPivosVisiveis);
    btn.title = AppState.distanciasPivosVisiveis ? t("ui.titles.hide_pivot_distances") : t("ui.titles.show_pivot_distances");
  }

  togglePivoDistances(AppState.distanciasPivosVisiveis);
}

function handleCancelDraw(event) {
  let cancelled = false;
  let messageKey = "";

  if (AppState.modoDesenhoPivo && AppState.centroPivoTemporario) {
    typeof removeTempCircle == "function" && removeTempCircle();
    removeDrawingTooltip(map);
    messageKey = "messages.info.draw_pivot_cancelled";
    cancelled = true;
  } else if (AppState.modoDesenhoPivoSetorial && AppState.centroPivoTemporario) {
    typeof removeTempSector == "function" && removeTempSector();
    removeDrawingTooltip(map);
    messageKey = "messages.info.draw_sector_cancelled";
    cancelled = true;
  } else if (AppState.modoDesenhoPivoPacman && AppState.centroPivoTemporario) {
    typeof removeTempPacman == "function" && removeTempPacman();
    removeDrawingTooltip(map);
    messageKey = "messages.info.draw_pacman_cancelled";
    cancelled = true;
  }

  if (cancelled) {
    L.DomEvent.preventDefault(event);
    L.DomEvent.stopPropagation(event);
    console.log("Ação de desenho cancelada pelo usuário.");
    AppState.centroPivoTemporario = null;
    AppState.pontoRaioTemporario = null;
    messageKey && mostrarMensagem(t(messageKey), "info");
  }
}

function getNextPivotNumber() {
  let highest = 0;
  const pivotLabel = escapeRegExp(t("entity_names.pivot") || "Pivô");
  const pattern = new RegExp(`(?:${pivotLabel}|Pivô|Pivot|Pivote)\\s+(\\d+)$`, "i");

  AppState.lastPivosDataDrawn.forEach((pivot) => {
    const match = pivot.nome.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      num > highest && (highest = num);
    }
  });

  return highest + 1;
}

function toggleModoDesenhoPivoSetorial() {
  const activating = !AppState.modoDesenhoPivoSetorial;
  activating && deactivateAllModes();
  AppState.modoDesenhoPivoSetorial = activating;

  document.getElementById("btn-draw-pivot-setorial")?.classList.toggle("glass-button-active", AppState.modoDesenhoPivoSetorial);

  if (activating) {
    map.getContainer().style.cursor = "crosshair";
    map.on("click", handleSectorialPivotDrawClick);
    map.on("mousemove", handleSectorialDrawMouseMove);
    mostrarMensagem(t("messages.info.draw_sector_pivot_step1"), "info");
  } else {
    map.getContainer().style.cursor = "";
    map.off("click", handleSectorialPivotDrawClick);
    map.off("mousemove", handleSectorialDrawMouseMove);
    AppState.centroPivoTemporario = null;
    typeof removeTempSector == "function" && removeTempSector();
    mostrarMensagem(t("messages.info.draw_sector_pivot_off"), "sucesso");
  }
}

async function handleSectorialPivotDrawClick(event) {
  if (!AppState.modoDesenhoPivoSetorial) return;

  if (!AppState.centroPivoTemporario) {
    AppState.centroPivoTemporario = event.latlng;
    mostrarMensagem(t("messages.info.draw_sector_pivot_step2"), "info");
    return;
  }

  const clickLatLng = event.latlng;
  const distance = AppState.centroPivoTemporario.distanceTo(clickLatLng);

  typeof removeTempSector == "function" && removeTempSector();

  if (distance < 10) {
    AppState.centroPivoTemporario = null;
    mostrarMensagem(t("messages.errors.draw_pivot_radius_too_small"), "erro");
    return;
  }

  mostrarLoader(true);
  try {
    const bearing = calculateBearing(AppState.centroPivoTemporario, event.latlng);
    const nextNumber = getNextPivotNumber();
    const pivot = {
      nome: `${t("entity_names.pivot")} ${nextNumber}`,
      lat: AppState.centroPivoTemporario.lat,
      lon: AppState.centroPivoTemporario.lng,
      fora: true,
      tipo: "setorial",
      raio: AppState.centroPivoTemporario.distanceTo(event.latlng),
      angulo_central: bearing,
      abertura_arco: 180,
      circle_center_lat: AppState.centroPivoTemporario.lat,
      circle_center_lon: AppState.centroPivoTemporario.lng
    };

    AppState.lastPivosDataDrawn.push(pivot);

    const ciclo = {
      nome_original_circulo: `Ciclo ${pivot.nome}`,
      coordenadas: []
    };
    AppState.ciclosGlobais.push(ciclo);

    atualizarPainelDados();
    typeof drawPivos == "function" && drawPivos(AppState.lastPivosDataDrawn, false);
    typeof drawCirculos == "function" && drawCirculos(AppState.ciclosGlobais);
    await reavaliarPivosViaAPI();
    mostrarMensagem(t("messages.success.sector_pivot_created", { name: pivot.nome }), "sucesso");
  } catch (err) {
    console.error("Erro ao criar pivô setorial:", err);
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
  } finally {
    AppState.centroPivoTemporario = null;
    removeDrawingTooltip(map);
    mostrarLoader(false);
    setTimeout(() => {
      AppState.modoDesenhoPivoSetorial && mostrarMensagem(t("messages.info.draw_sector_pivot_still_active"), "info");
    }, 2000);
  }
}

function handleSectorialDrawMouseMove(event) {
  if (AppState.modoDesenhoPivoSetorial && AppState.centroPivoTemporario) {
    typeof drawTempSector == "function" && drawTempSector(AppState.centroPivoTemporario, event.latlng);
    const radius = AppState.centroPivoTemporario.distanceTo(event.latlng);
    const label = `${t("ui.labels.radius")}: ${radius.toFixed(1)} m`;
    updateDrawingTooltip(map, event, label);
  }
}

function toggleModoDesenhoPivoPacman() {
  const activating = !AppState.modoDesenhoPivoPacman;
  activating && deactivateAllModes();
  AppState.modoDesenhoPivoPacman = activating;

  document.getElementById("btn-draw-pivot-pacman")?.classList.toggle("glass-button-active", AppState.modoDesenhoPivoPacman);

  if (activating) {
    map.getContainer().style.cursor = "crosshair";
    map.on("click", handlePacmanPivotDrawClick);
    map.on("mousemove", handlePacmanDrawMouseMove);
    mostrarMensagem(t("messages.info.draw_pacman_step1"), "info");
  } else {
    map.getContainer().style.cursor = "";
    map.off("click", handlePacmanPivotDrawClick);
    map.off("mousemove", handlePacmanDrawMouseMove);
    AppState.centroPivoTemporario = null;
    AppState.pontoRaioTemporario = null;
    typeof removeTempPacman == "function" && removeTempPacman();
    mostrarMensagem(t("messages.info.draw_pacman_off"), "sucesso");
  }
}

function handlePacmanDrawMouseMove(event) {
  if (AppState.modoDesenhoPivoPacman && AppState.centroPivoTemporario) {
    typeof drawTempPacman == "function" && drawTempPacman(AppState.centroPivoTemporario, AppState.pontoRaioTemporario, event.latlng);

    let label = "";
    if (AppState.pontoRaioTemporario) {
      const center = AppState.centroPivoTemporario;
      const startBearing = calculateBearing(center, AppState.pontoRaioTemporario);
      let sweep = calculateBearing(center, event.latlng) - startBearing;
      sweep < 0 && (sweep += 360);
      label = `${t("ui.labels.dry_angle")}: ${sweep.toFixed(1)}°`;
    } else {
      const radius = AppState.centroPivoTemporario.distanceTo(event.latlng);
      label = `${t("ui.labels.radius")}: ${radius.toFixed(1)} m`;
    }

    updateDrawingTooltip(map, event, label);
  }
}

async function handlePacmanPivotDrawClick(event) {
  if (!AppState.modoDesenhoPivoPacman) return;

  if (!AppState.centroPivoTemporario) {
    AppState.centroPivoTemporario = event.latlng;
    mostrarMensagem(t("messages.info.draw_pacman_step2"), "info");
    return;
  }

  if (!AppState.pontoRaioTemporario) {
    AppState.pontoRaioTemporario = event.latlng;
    mostrarMensagem(t("messages.info.draw_pacman_step3"), "info");
    return;
  }

  const clickLatLng = event.latlng;
  mostrarLoader(true);
  try {
    const center = AppState.centroPivoTemporario;
    const radius = center.distanceTo(AppState.pontoRaioTemporario);
    if (radius < 10) throw new Error(t("messages.errors.draw_pivot_radius_too_small"));

    const startAngle = calculateBearing(center, AppState.pontoRaioTemporario);
    const endAngle = calculateBearing(center, clickLatLng);
    const nextNumber = getNextPivotNumber();
    const pivot = {
      nome: `${t("entity_names.pivot")} ${nextNumber}`,
      lat: center.lat,
      lon: center.lng,
      fora: true,
      tipo: "pacman",
      raio: radius,
      angulo_inicio: startAngle,
      angulo_fim: endAngle,
      circle_center_lat: center.lat,
      circle_center_lon: center.lng
    };

    AppState.lastPivosDataDrawn.push(pivot);

    const ciclo = {
      nome_original_circulo: `Ciclo ${pivot.nome}`,
      coordenadas: []
    };
    AppState.ciclosGlobais.push(ciclo);

    drawPivos(AppState.lastPivosDataDrawn, false);
    drawCirculos(AppState.ciclosGlobais);
    await reavaliarPivosViaAPI();
    mostrarMensagem(t("messages.success.pacman_pivot_created", { name: pivot.nome }), "sucesso");
  } catch (err) {
    console.error("Erro ao criar pivô Pac-Man:", err);
    mostrarMensagem(err.message, "erro");
  } finally {
    AppState.centroPivoTemporario = null;
    AppState.pontoRaioTemporario = null;
    typeof removeTempPacman == "function" && removeTempPacman();
    removeDrawingTooltip(map);
    mostrarLoader(false);
    setTimeout(() => {
      AppState.modoDesenhoPivoPacman && mostrarMensagem(t("messages.info.draw_pacman_still_active"), "info");
    }, 2500);
  }
}

function toggleModoDesenhoIrripump() {
  const activating = !AppState.modoDesenhoIrripump;
  activating && deactivateAllModes();
  AppState.modoDesenhoIrripump = activating;

  document.getElementById("btn-draw-irripump")?.classList.toggle("glass-button-active", AppState.modoDesenhoIrripump);

  if (activating) {
    map.getContainer().style.cursor = "crosshair";
    mostrarMensagem(t("messages.info.draw_irripump_step1"), "info");
  } else {
    map.getContainer().style.cursor = "";
    mostrarMensagem(t("messages.info.draw_irripump_off"), "sucesso");
  }
}
