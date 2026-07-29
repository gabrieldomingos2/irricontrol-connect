function handleReconfigMainStudy() {
  map.closePopup();
  const panel = document.getElementById("painel-repetidora");
  const alturaAntenaInput = document.getElementById("altura-antena-rep");
  const alturaReceiverInput = document.getElementById("altura-receiver-rep");

  if (AppState.antenaGlobal) {
    alturaAntenaInput.value = AppState.antenaGlobal.altura;
    alturaReceiverInput.value = AppState.antenaGlobal.altura_receiver;
    AppState.clickedCandidateData = AppState.antenaGlobal;
    AppState.coordenadaClicada = L.latLng(AppState.antenaGlobal.lat, AppState.antenaGlobal.lon);
    panel.classList.remove("hidden");
  }
}

async function handleDeleteMainStudy() {
  map.closePopup();
  if (!AppState.antenaGlobal) return;

  const originalCandidate = AppState.currentProcessedKmzData?.antenas.find((a) => a.lat === AppState.antenaGlobal.lat && a.lon === AppState.antenaGlobal.lon);

  AppState.marcadorAntena && map.removeLayer(AppState.marcadorAntena);
  AppState.antenaGlobal.overlay && map.removeLayer(AppState.antenaGlobal.overlay);
  AppState.antenaGlobal.label && map.removeLayer(AppState.antenaGlobal.label);
  document.getElementById("antena-item")?.remove();
  AppState.overlaysVisiveis = AppState.overlaysVisiveis.filter((o) => o !== AppState.antenaGlobal.overlay);
  AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((l) => l !== AppState.antenaGlobal.label);
  AppState.antenaGlobal = null;
  AppState.marcadorAntena = null;

  originalCandidate && drawAntenaCandidates([originalCandidate]);
  await reavaliarPivosViaAPI();
  atualizarPainelDados();
  updatePdfButtonState(hasActiveCoverageOverlays());
  updateKmzButtonState(hasActiveCoverageOverlays());
  updateDownloadActivePngsButtonState();
  mostrarMensagem(t("messages.success.main_study_removed"), "info");
}

async function startMainSimulation(candidate) {
  if (!candidate || !AppState.jobId) {
    mostrarMensagem(t("messages.errors.invalid_data_or_session"), "erro");
    return;
  }

  mostrarLoader(true);
  map?.closePopup();

  try {
    if (AppState.antenaGlobal) {
      AppState.antenaGlobal.overlay && map.removeLayer(AppState.antenaGlobal.overlay);
      AppState.antenaGlobal.label && map.removeLayer(AppState.antenaGlobal.label);
      AppState.overlaysVisiveis = AppState.overlaysVisiveis.filter((o) => o !== AppState.antenaGlobal.overlay);
      AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((l) => l !== AppState.antenaGlobal.label);
    }
    AppState.marcadorAntena && map.removeLayer(AppState.marcadorAntena);
    AppState.templateSelecionado = document.getElementById("template-modelo").value;

    const pivosAtuais = (AppState.lastPivosDataDrawn || []).map((p) => ({
      nome: p.nome,
      lat: p.lat,
      lon: p.lon,
      type: "pivo"
    }));
    const bombasAtuais = (AppState.lastBombasDataDrawn || []).map((b) => ({
      nome: b.nome,
      lat: b.lat,
      lon: b.lon,
      type: "bomba"
    }));
    const requestPayload = {
      job_id: AppState.jobId,
      ...candidate,
      pivos_atuais: pivosAtuais,
      bombas_atuais: bombasAtuais,
      template: AppState.templateSelecionado
    };

    const result = await simulateSignal(requestPayload);

    if (AppState.antenaCandidatesLayerGroup) {
      const candidateId = `candidate-${candidate.nome}-${candidate.lat}`;
      const layersToRemove = [];
      AppState.antenaCandidatesLayerGroup.eachLayer((layer) => {
        layer.options.customId === candidateId && layersToRemove.push(layer);
      });
      layersToRemove.forEach((layer) => AppState.antenaCandidatesLayerGroup.removeLayer(layer));
      AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((l) => l.options.customId !== candidateId);
    }

    const imagemFilename = result.imagem_salva ? result.imagem_salva.split("/").pop() : null;
    AppState.antenaGlobal = {
      ...candidate,
      overlay: drawImageOverlay(result.imagem_salva, result.bounds),
      bounds: result.bounds,
      imagem_filename: imagemFilename,
      type: candidate.type || "default",
      original_name: candidate.nome,
      is_from_kmz: true,
      had_height_in_kmz: candidate.had_height_in_kmz || false
    };

    AppState.marcadorAntena = L.marker([AppState.antenaGlobal.lat, AppState.antenaGlobal.lon], { icon: antenaIcon }).addTo(map);

    AppState.marcadorAntena.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      typeof handleSpecialMarkerSelection == "function" && handleSpecialMarkerSelection(event.target);
      AppState.modoLoSPivotAPivot
        ? handleLoSTargetClick({ ...AppState.antenaGlobal, fora: false, id: "main_antenna" }, AppState.marcadorAntena)
        : handleReconfigMainStudy();
    });

    AppState.marcadorAntena.on("contextmenu", (event) => {
      L.DomEvent.stop(event);
      showRenameRepeaterMenu(AppState.marcadorAntena, AppState.antenaGlobal.nome, true, null);
    });

    const tooltipHtml = `<div style="text-align: center;">${AppState.antenaGlobal.altura !== null ? `<span>${t("ui.labels.antenna_height_tooltip", { height: AppState.antenaGlobal.altura })}</span>` : ""}<span>${t("ui.labels.receiver_height_tooltip", { height: AppState.antenaGlobal.altura_receiver })}</span></div>`;
    AppState.marcadorAntena.bindTooltip(tooltipHtml, {
      permanent: false,
      direction: "top",
      offset: [0, -40],
      className: "tooltip-sinal"
    });

    const label = getFormattedAntennaOrRepeaterName(AppState.antenaGlobal);
    const labelWidth = label.length * 7 + 10;
    const labelMarker = L.marker([AppState.antenaGlobal.lat, AppState.antenaGlobal.lon], {
      icon: L.divIcon({
        className: "label-pivo",
        html: label,
        iconSize: [labelWidth, 20],
        iconAnchor: [labelWidth / 2, 45]
      }),
      labelType: "antena"
    }).addTo(map);

    AppState.marcadoresLegenda.push(labelMarker);
    AppState.antenaGlobal.label = labelMarker;
    addAntenaAoPainel(AppState.antenaGlobal);

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
    mostrarMensagem(t("messages.success.simulation_complete"), "sucesso");
    updateDownloadActivePngsButtonState();
    updatePdfButtonState(hasActiveCoverageOverlays());
    updateKmzButtonState(hasActiveCoverageOverlays());
    fitMapToAllElements();
  } catch (err) {
    console.error("Erro ao simular sinal:", err);
    mostrarMensagem(t("messages.errors.simulation_fail", { error: err.message }), "erro");
    AppState.antenaGlobal = null;
  } finally {
    mostrarLoader(false);
  }
}

function countEntitiesWithBaseName(baseName, exclude = null) {
  let count = 0;
  const escaped = escapeRegExp(baseName.trim());
  const pattern = new RegExp(`^${escaped}( \\d+)?$`, "i");
  const entities = [AppState.antenaGlobal, ...AppState.repetidoras].filter(Boolean);

  for (const entity of entities) {
    if (exclude) {
      const sameId = entity.id && entity.id === exclude.id;
      const sameMainAntenna = entity === AppState.antenaGlobal && exclude === AppState.antenaGlobal;
      if (sameId || sameMainAntenna) continue;
    }
    entity.nome && pattern.test(entity.nome) && count++;
  }

  return count;
}

function findNextSequentialNumberForType(baseName, exclude = null) {
  const usedNumbers = [];
  const escaped = escapeRegExp(baseName.trim());
  const pattern = new RegExp(`^${escaped}\\s+(\\d+)$`, "i");

  [AppState.antenaGlobal, ...AppState.repetidoras].filter(Boolean).forEach((entity) => {
    if (exclude) {
      const sameId = entity.id && entity.id === exclude.id;
      const sameMainAntenna = entity === AppState.antenaGlobal && exclude === AppState.antenaGlobal;
      if (sameId || sameMainAntenna) return;
    }
    if (entity.nome) {
      const match = entity.nome.match(pattern);
      match && match[1] && usedNumbers.push(parseInt(match[1], 10));
    }
  });

  return usedNumbers.length === 0 ? 1 : Math.max(...usedNumbers) + 1;
}

function handleRenameRepeater(repeaterId, newType) {
  const repeater = AppState.repetidoras.find((r) => r.id === repeaterId);
  if (!repeater) return;

  repeater.type = newType;
  if (newType !== "default") {
    const baseName = t(`entity_names.${newType}`);
    if (countEntitiesWithBaseName(baseName, repeater) === 0) {
      repeater.nome = baseName;
    } else {
      const nextNumber = findNextSequentialNumberForType(baseName, repeater);
      repeater.nome = `${baseName} ${nextNumber}`;
    }
  } else {
    repeater.nome = repeater.original_name;
  }

  typeof updateAntenaOrRepeaterLabel == "function" && updateAntenaOrRepeaterLabel(repeater);
  const labelSpan = document.querySelector(`#rep-item-${repeater.id} span`);
  labelSpan && (labelSpan.textContent = getFormattedAntennaOrRepeaterName(repeater, false));
  atualizarPainelDados();
  mostrarMensagem(t("messages.success.repeater_renamed", { name: repeater.nome }), "sucesso");
}

function handleRenameMainAntenna(newType) {
  if (!AppState.antenaGlobal) return;

  AppState.antenaGlobal.type = newType;
  if (newType !== "default") {
    const baseName = t(`entity_names.${newType}`);
    if (countEntitiesWithBaseName(baseName, AppState.antenaGlobal) === 0) {
      AppState.antenaGlobal.nome = baseName;
    } else {
      const nextNumber = findNextSequentialNumberForType(baseName, AppState.antenaGlobal);
      AppState.antenaGlobal.nome = `${baseName} ${nextNumber}`;
    }
  } else {
    AppState.antenaGlobal.nome = AppState.antenaGlobal.original_name;
  }

  typeof updateAntenaOrRepeaterLabel == "function" && updateAntenaOrRepeaterLabel(AppState.antenaGlobal);
  const labelSpan = document.querySelector("#antena-item span");
  labelSpan && (labelSpan.textContent = getFormattedAntennaOrRepeaterName(AppState.antenaGlobal, false));
  atualizarPainelDados();
  mostrarMensagem(t("messages.success.main_antenna_renamed", { name: AppState.antenaGlobal.nome }), "sucesso");
  setTimeout(removeRenameMenu, 50);
}

async function handleMapClick(event) {
  if (event.originalEvent?.target?.closest?.(".leaflet-marker-icon")) return;

  deselectAllMarkers();
  if (AppState.modoDesenhoPivoSetorial || AppState.modoDesenhoPivo || AppState.modoDesenhoPivoPacman) return;

  if (AppState.modoDesenhoIrripump) {
    handleIrripumpDrawClick(event);
    return;
  }

  if (AppState.modoEdicaoPivos || AppState.modoLoSPivotAPivot) return;

  AppState.clickedCandidateData = null;
  AppState.ultimoCliqueFoiSobrePivo = false;
  AppState.coordenadaClicada = event.latlng;
  typeof removePositioningMarker == "function" && removePositioningMarker();

  AppState.marcadorPosicionamento = L.marker(AppState.coordenadaClicada, {
    icon: posicionamentoIcon,
    interactive: false,
    opacity: 0.7,
    zIndexOffset: 1000
  }).addTo(map);

  document.getElementById("painel-repetidora")?.classList.remove("hidden");

  const alturaAntenaInput = document.getElementById("altura-antena-rep");
  const alturaReceiverInput = document.getElementById("altura-receiver-rep");
  alturaAntenaInput && (alturaAntenaInput.value = 5);
  alturaReceiverInput && (alturaReceiverInput.value = 3);
}

async function handleConfirmRepetidoraClick() {
  if (!AppState.coordenadaClicada || !AppState.jobId) {
    mostrarMensagem(t("messages.errors.invalid_data_or_session"), "erro");
    return;
  }

  const alturaAntena = parseFloat(document.getElementById("altura-antena-rep").value);
  const alturaReceiver = parseFloat(document.getElementById("altura-receiver-rep").value);
  AppState.templateSelecionado = document.getElementById("template-modelo").value;
  mostrarLoader(true);

  try {
    if (AppState.antenaGlobal && AppState.clickedCandidateData && AppState.clickedCandidateData.lat === AppState.antenaGlobal.lat && AppState.clickedCandidateData.lon === AppState.antenaGlobal.lon) {
      console.log("Ressimulando a antena principal...");
      const updatedCandidate = { ...AppState.antenaGlobal, altura: alturaAntena, altura_receiver: alturaReceiver };
      await startMainSimulation(updatedCandidate);
      AppState.clickedCandidateData = null;
      return;
    }

    if (!AppState.antenaGlobal) {
      let candidate;
      if (AppState.clickedCandidateData) {
        console.log("Iniciando simulação principal com candidato KMZ.");
        candidate = { ...AppState.clickedCandidateData };
      } else if (AppState.coordenadaClicada) {
        console.log("Iniciando simulação principal com ponto manual.");
        const nextId = AppState.idsDisponiveis.length > 0 ? AppState.idsDisponiveis.shift() : ++AppState.contadorRepetidoras;
        const name = `${t("ui.labels.repeater")} ${nextId}`;
        candidate = {
          nome: name,
          original_name: name,
          lat: AppState.coordenadaClicada.lat,
          lon: AppState.coordenadaClicada.lng,
          type: "default",
          is_from_kmz: false,
          had_height_in_kmz: false
        };
      } else {
        mostrarMensagem(t("messages.errors.invalid_data_or_session"), "erro");
        mostrarLoader(false);
        return;
      }

      AppState.clickedCandidateData = null;
      typeof removePositioningMarker == "function" && removePositioningMarker();
      await startMainSimulation({
        ...candidate,
        altura: alturaAntena || candidate.altura,
        altura_receiver: alturaReceiver || candidate.altura_receiver
      });
      return;
    }

    typeof removePositioningMarker == "function" && removePositioningMarker();

    const nextId = AppState.idsDisponiveis.length > 0 ? AppState.idsDisponiveis.shift() : ++AppState.contadorRepetidoras;
    const name = `${t("ui.labels.repeater")} ${nextId}`;
    const marker = L.marker(AppState.coordenadaClicada, { icon: antenaIcon }).addTo(map);

    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      typeof handleSpecialMarkerSelection == "function" && handleSpecialMarkerSelection(event.target);
      if (AppState.modoLoSPivotAPivot) {
        const repeater = AppState.repetidoras.find((r) => r.marker === event.target);
        repeater && handleLoSTargetClick({ ...repeater, fora: false }, event.target);
      }
    });

    const repeater = {
      id: nextId,
      marker,
      overlay: null,
      label: null,
      altura: alturaAntena,
      altura_receiver: alturaReceiver,
      lat: AppState.coordenadaClicada.lat,
      lon: AppState.coordenadaClicada.lng,
      imagem_filename: null,
      sobre_pivo: AppState.ultimoCliqueFoiSobrePivo || false,
      nome: name,
      original_name: name,
      is_from_kmz: false,
      type: "default",
      had_height_in_kmz: false
    };

    const label = getFormattedAntennaOrRepeaterName(repeater);
    const labelWidth = label.length * 7 + 10;
    const labelMarker = L.marker(AppState.coordenadaClicada, {
      icon: L.divIcon({
        className: "label-pivo",
        html: label,
        iconSize: [labelWidth, 20],
        iconAnchor: [labelWidth / 2, 45]
      }),
      labelType: "repetidora"
    }).addTo(map);

    AppState.marcadoresLegenda.push(labelMarker);
    repeater.label = labelMarker;

    const tooltipHtml = `<div style="text-align: center;">${alturaAntena !== null ? `<span>${t("ui.labels.antenna_height_tooltip", { height: alturaAntena })}</span>` : ""}<span>${t("ui.labels.receiver_height_tooltip", { height: alturaReceiver })}</span></div>`;
    marker.bindTooltip(tooltipHtml, {
      permanent: false,
      direction: "top",
      offset: [0, -40],
      className: "tooltip-sinal"
    });

    AppState.repetidoras.push(repeater);

    const pivosAtuais = AppState.lastPivosDataDrawn.map((p) => ({
      nome: p.nome,
      lat: p.lat,
      lon: p.lon,
      type: "pivo"
    }));
    const bombasAtuais = (AppState.lastBombasDataDrawn || []).map((b) => ({
      nome: b.nome,
      lat: b.lat,
      lon: b.lon,
      type: "bomba"
    }));
    const requestPayload = {
      job_id: AppState.jobId,
      lat: repeater.lat,
      lon: repeater.lon,
      altura: repeater.altura,
      altura_receiver: repeater.altura_receiver,
      pivos_atuais: pivosAtuais,
      bombas_atuais: bombasAtuais,
      template: AppState.templateSelecionado
    };

    const result = await simulateManual(requestPayload);
    repeater.overlay = drawImageOverlay(result.imagem_salva, result.bounds, 1);
    repeater.imagem_filename = result.imagem_filename.split("/").pop();
    addRepetidoraNoPainel(repeater);
    await reavaliarPivosViaAPI();
    mostrarMensagem(t("messages.success.repeater_added", { name: getFormattedAntennaOrRepeaterName(repeater) }), "sucesso");
    updateDownloadActivePngsButtonState();
    updatePdfButtonState(hasActiveCoverageOverlays());
    updateKmzButtonState(hasActiveCoverageOverlays());
    fitMapToAllElements();
  } catch (err) {
    mostrarMensagem(t("messages.errors.simulation_fail", { error: err.message }), "erro");
    const failedRepeater = AppState.repetidoras.pop();
    if (failedRepeater) {
      failedRepeater.marker && map.removeLayer(failedRepeater.marker);
      failedRepeater.label && map.removeLayer(failedRepeater.label);
      AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((l) => l !== failedRepeater.label);
    }
  } finally {
    mostrarLoader(false);
    AppState.coordenadaClicada = null;
    atualizarPainelDados();
    reposicionarPaineisLaterais();
  }
}

function handleBuscarLocaisRepetidoraActivation() {
  const activating = !AppState.modoBuscaLocalRepetidora;
  activating && deactivateAllModes();
  AppState.modoBuscaLocalRepetidora = activating;

  const btn = document.getElementById("btn-buscar-locais-repetidora");
  btn && btn.classList.toggle("glass-button-active", activating);

  if (activating) {
    mostrarMensagem(t("messages.info.los_mode_on"), "sucesso");
    AppState.pivoAlvoParaLocalRepetidora = null;
    AppState.marcadorPosicionamento && typeof removePositioningMarker == "function" && removePositioningMarker();
    document.getElementById("painel-repetidora")?.classList.add("hidden");
    map && (map.getContainer().style.cursor = "crosshair");
  } else {
    AppState.xSelecionadoMarker && (map.removeLayer(AppState.xSelecionadoMarker), AppState.xSelecionadoMarker = null);
    mostrarMensagem(t("messages.info.los_mode_off_find_repeater"), "sucesso");
    mostrarMensagem(t("messages.info.find_repeater_long_process_warning"), "info");
    AppState.pivoAlvoParaLocalRepetidora = null;
    map && (map.getContainer().style.cursor = "");
    window.candidateRepeaterSitesLayerGroup && window.candidateRepeaterSitesLayerGroup.clearLayers();
  }
}

async function handlePivotSelectionForRepeaterSite(pivotData, marker) {
  if (!AppState.modoBuscaLocalRepetidora) return;

  if (!AppState.jobId) {
    mostrarMensagem(t("messages.errors.run_study_first"), "erro");
    return;
  }

  const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === pivotData.nome);
  if (pivot && !pivot.fora) {
    mostrarMensagem(t("messages.errors.select_uncovered_pivot"), "erro");
    return;
  }

  AppState.xSelecionadoMarker && (map.removeLayer(AppState.xSelecionadoMarker), AppState.xSelecionadoMarker = null);
  AppState.pivoAlvoParaLocalRepetidora = {
    nome: pivotData.nome,
    lat: marker.getLatLng().lat,
    lon: marker.getLatLng().lng,
    altura_receiver: AppState.antenaGlobal && typeof AppState.antenaGlobal.altura_receiver == "number" ? AppState.antenaGlobal.altura_receiver : 3
  };
  mostrarMensagem(t("messages.info.target_pivot_selected", { name: AppState.pivoAlvoParaLocalRepetidora.nome }), "info");

  const loaderTips = [
    t("messages.info.find_repeater_long_process_warning"),
    t("loader_tips.inaccurate_search"),
    t("loader_tips.try_manual_repeater"),
    t("loader_tips.consider_nearby_locations"),
    t("loader_tips.blocked_los_compensation")
  ];
  mostrarLoader(true, loaderTips);
  map && (map.getContainer().style.cursor = "wait");

  const activeOverlays = [];
  const antennaVisibilityBtn = document.querySelector("#antena-item button[data-visible]");
  const antennaIsVisible = !antennaVisibilityBtn || antennaVisibilityBtn.getAttribute("data-visible") === "true";

  if (AppState.antenaGlobal?.overlay && map.hasLayer(AppState.antenaGlobal.overlay) && antennaIsVisible && AppState.antenaGlobal.imagem_filename) {
    const bounds = AppState.antenaGlobal.overlay.getBounds();
    activeOverlays.push({
      id: "antena_principal",
      imagem: AppState.antenaGlobal.imagem_filename,
      bounds: [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]
    });
  }

  AppState.repetidoras.forEach((rep) => {
    const visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
    const isVisible = !visibilityBtn || visibilityBtn.getAttribute("data-visible") === "true";
    if (rep.overlay && map.hasLayer(rep.overlay) && isVisible && rep.imagem_filename) {
      const bounds = rep.overlay.getBounds();
      activeOverlays.push({
        id: `repetidora_${rep.id}`,
        imagem: rep.imagem_filename,
        bounds: [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]
      });
    }
  });

  if (activeOverlays.length === 0) {
    mostrarMensagem(t("messages.errors.no_coverage_to_search"), "erro");
    mostrarLoader(false);
    map && (map.getContainer().style.cursor = AppState.modoBuscaLocalRepetidora ? "crosshair" : "");
    return;
  }

  try {
    const requestPayload = {
      job_id: AppState.jobId,
      target_pivot_lat: AppState.pivoAlvoParaLocalRepetidora.lat,
      target_pivot_lon: AppState.pivoAlvoParaLocalRepetidora.lon,
      target_pivot_nome: AppState.pivoAlvoParaLocalRepetidora.nome,
      altura_antena_repetidora_proposta: parseFloat(document.getElementById("altura-antena-rep").value) || 5,
      altura_receiver_pivo: AppState.pivoAlvoParaLocalRepetidora.altura_receiver,
      active_overlays: activeOverlays,
      pivot_polygons_coords: AppState.ciclosGlobais ? AppState.ciclosGlobais.map((c) => c.coordenadas) : []
    };
    const result = await findHighPointsForRepeater(requestPayload);

    window.candidateRepeaterSitesLayerGroup && window.candidateRepeaterSitesLayerGroup.clearLayers();

    if (result?.candidate_sites?.length > 0) {
      drawCandidateRepeaterSites(result.candidate_sites, AppState.pivoAlvoParaLocalRepetidora);
      mostrarMensagem(t("messages.success.found_candidate_sites", { count: result.candidate_sites.length }), "sucesso");
    } else {
      mostrarMensagem(t("messages.info.no_promising_sites_found"), "info");
    }
  } catch (err) {
    console.error("Erro ao buscar locais para repetidora:", err);
    mostrarMensagem(t("messages.errors.find_repeater_fail", { error: err.message || "Erro desconhecido" }), "erro");
  } finally {
    mostrarLoader(false);
    map && (map.getContainer().style.cursor = AppState.modoBuscaLocalRepetidora ? "crosshair" : "");
  }
}

async function handleDownloadActivePngsClick() {
  if (!AppState.jobId) {
    mostrarMensagem(t("messages.errors.session_not_started"), "erro");
    return;
  }

  const repetidorasData = [];
  const antennaVisibilityBtn = document.querySelector("#antena-item button[data-visible]");
  const antennaIsVisible = !antennaVisibilityBtn || antennaVisibilityBtn.getAttribute("data-visible") === "true";

  let antenaPrincipalData = null;
  let imagemFilename = null;
  let boundsFile = null;

  if (AppState.antenaGlobal && AppState.antenaGlobal.imagem_filename && antennaIsVisible) {
    antenaPrincipalData = {
      nome: AppState.antenaGlobal.nome,
      lat: AppState.antenaGlobal.lat,
      lon: AppState.antenaGlobal.lon,
      altura: AppState.antenaGlobal.altura,
      altura_receiver: AppState.antenaGlobal.altura_receiver,
      type: AppState.antenaGlobal.type || "default"
    };
    imagemFilename = AppState.antenaGlobal.imagem_filename;
    boundsFile = imagemFilename.replace(/\.png$/, ".json");
  }

  AppState.repetidoras.forEach((rep) => {
    const visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
    const isVisible = !visibilityBtn || visibilityBtn.getAttribute("data-visible") === "true";
    isVisible && rep.imagem_filename && repetidorasData.push({
      imagem: rep.imagem_filename,
      altura: rep.altura,
      sobre_pivo: rep.sobre_pivo,
      nome: rep.is_from_kmz ? rep.nome : null,
      type: rep.type || "default"
    });
  });

  if (!antenaPrincipalData && repetidorasData.length === 0) {
    mostrarMensagem(t("messages.info.no_active_png_overlays"), "info");
    return;
  }

  try {
    mostrarLoader(true);
    const payload = {
      job_id: AppState.jobId,
      template_id: AppState.templateSelecionado || document.getElementById("template-modelo").value,
      language: localStorage.getItem("preferredLanguage") || "pt-br",
      antena_principal_data: antenaPrincipalData,
      imagem: imagemFilename,
      bounds_file: boundsFile,
      pivos_data: [],
      ciclos_data: [],
      bombas_data: [],
      repetidoras_data: repetidorasData
    };
    await exportKmz(payload);
  } catch (err) {
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
  } finally {
    mostrarLoader(false);
  }
}

function hasActiveCoverageOverlays() {
  if (!AppState.jobId) return false;
  if (AppState.antenaGlobal && AppState.antenaGlobal.imagem_filename) return true;
  for (const rep of AppState.repetidoras) {
    if (rep.imagem_filename) return true;
  }
  return false;
}

function updateDownloadActivePngsButtonState() {
  const btn = document.getElementById("btn-download-active-pngs");
  btn && (btn.disabled = !hasActiveCoverageOverlays());
}

function removePositioningMarker() {
  AppState.marcadorPosicionamento && map.hasLayer(AppState.marcadorPosicionamento) && (map.removeLayer(AppState.marcadorPosicionamento), AppState.marcadorPosicionamento = null);
}

function parseCoordinates(rawInput) {
  const input = rawInput.trim();

  const dmsToDecimal = (deg, min, sec, hemisphere) => {
    let decimal = parseFloat(deg) + parseFloat(min) / 60 + parseFloat(sec) / 3600;
    (hemisphere === "S" || hemisphere === "W") && (decimal = decimal * -1);
    return decimal;
  };

  const dmsPattern = /^(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([NS])\s*,?\s*(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([WE])$/i;
  const dmsMatch = input.match(dmsPattern);

  if (dmsMatch) {
    try {
      const lat = dmsToDecimal(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4].toUpperCase());
      const lon = dmsToDecimal(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8].toUpperCase());
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    } catch (err) {
      console.error("Erro ao converter DMS:", err);
      return null;
    }
  }

  const parts = input.replace(/,/g, " ").replace(/\s+/g, " ").trim().split(" ");
  if (parts.length === 2) {
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
  }

  return null;
}

function handleCoordinateSearch() {
  const input = document.getElementById("lat-long-input-field");
  const rawValue = input.value;

  if (!rawValue) {
    mostrarMensagem(t("messages.errors.coordinate_input_empty"), "erro");
    return;
  }

  const coords = parseCoordinates(rawValue);
  if (coords) {
    const latLng = L.latLng(coords.lat, coords.lon);
    removePositioningMarker();
    AppState.marcadorPosicionamento = L.marker(latLng, { icon: antenaIcon, interactive: true }).addTo(map);
    map.setView(latLng, 15);
    mostrarMensagem(t("messages.success.location_found"), "sucesso");
    AppState.coordenadaClicada = latLng;
    document.getElementById("painel-repetidora")?.classList.remove("hidden");
    input.value = "";
  } else {
    mostrarMensagem(t("messages.errors.invalid_coordinate_format"), "erro");
  }
}
