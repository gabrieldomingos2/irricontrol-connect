function showRenameRepeaterMenu(marker, currentName, isMainAntenna, repeaterId) {
  removeRenameMenu();

  const menu = document.createElement("div");
  menu.className = "rename-menu";

  const options = isMainAntenna
    ? [
        { text: t("entity_names.central"), value: "central" },
        { text: t("entity_names.central_repeater_combined"), value: "central_repeater_combined" }
      ]
    : [
        { text: t("entity_names.tower"), value: "tower" },
        { text: t("entity_names.pole"), value: "pole" },
        { text: t("entity_names.water_tank"), value: "water_tank" },
        { text: t("entity_names.central"), value: "central" },
        { text: t("entity_names.central_repeater_combined"), value: "central_repeater_combined" }
      ];

  options.forEach((option) => {
    const btn = document.createElement("button");
    btn.textContent = option.text;
    btn.className = "block w-full text-left px-3 py-1 text-white hover:bg-gray-700 rounded-sm text-sm";
    btn.onclick = (event) => {
      event.stopPropagation();
      isMainAntenna
        ? typeof handleRenameMainAntenna == "function" && handleRenameMainAntenna(option.value)
        : typeof handleRenameRepeater == "function" && handleRenameRepeater(repeaterId, option.value);
      removeRenameMenu();
    };
    menu.appendChild(btn);
  });

  const restoreBtn = document.createElement("button");
  restoreBtn.textContent = t("ui.titles.restore_original_name");
  restoreBtn.className = "block w-full text-left px-3 py-1 text-white hover:bg-gray-700 rounded-sm text-sm mt-2 border-t border-gray-600 pt-2";
  restoreBtn.onclick = (event) => {
    event.stopPropagation();
    isMainAntenna
      ? AppState.antenaGlobal?.original_name && typeof handleRenameMainAntenna == "function" && handleRenameMainAntenna("default")
      : AppState.repetidoras.find((r) => r.id === repeaterId)?.original_name && typeof handleRenameRepeater == "function" && handleRenameRepeater(repeaterId, "default");
    removeRenameMenu();
  };
  menu.appendChild(restoreBtn);

  const container = map.getContainer();
  menu.style.visibility = "hidden";
  container.appendChild(menu);

  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const anchorPoint = map.latLngToContainerPoint(marker.getLatLng());

  let top = anchorPoint.y;
  let left = anchorPoint.x + 20;

  anchorPoint.y + menuHeight + 10 > containerHeight && (top = anchorPoint.y - menuHeight - 10);
  left + menuWidth > containerWidth && (left = anchorPoint.x - menuWidth - 20);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "visible";

  setTimeout(() => {
    document.addEventListener("click", removeRenameMenu, { once: true });
  }, 100);
}

function removeRenameMenu() {
  document.querySelector(".rename-menu")?.remove();
}

function drawAntenaCandidates(candidates) {
  if (!map || !AppState.antenaCandidatesLayerGroup) return;

  AppState.antenaCandidatesLayerGroup.clearLayers();

  (candidates || []).forEach((candidate) => {
    const customId = `candidate-${candidate.nome}-${candidate.lat}`;
    const marker = L.marker([candidate.lat, candidate.lon], {
      icon: window.antenaIcon,
      customData: candidate,
      customId
    }).addTo(AppState.antenaCandidatesLayerGroup);

    const label = getFormattedAntennaOrRepeaterName({ ...candidate, is_from_kmz: true });
    const labelWidth = label.length * 7 + 10;
    const labelMarker = L.marker([candidate.lat, candidate.lon], {
      icon: L.divIcon({
        className: "label-pivo",
        html: escapeHtml(label),
        iconSize: [labelWidth, 20],
        iconAnchor: [labelWidth / 2, 45]
      }),
      interactive: false,
      customId,
      labelType: "antena_candidate"
    }).addTo(AppState.antenaCandidatesLayerGroup);

    AppState.marcadoresLegenda.push(labelMarker);

    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      typeof handleSpecialMarkerSelection == "function" && handleSpecialMarkerSelection(marker);

      const candidateData = event.target.options.customData;
      AppState.coordenadaClicada = event.latlng;

      const panel = document.getElementById("painel-repetidora");
      const alturaAntenaInput = document.getElementById("altura-antena-rep");
      const alturaReceiverInput = document.getElementById("altura-receiver-rep");
      const numberMatch = (candidateData.nome || "").match(/\d+/);
      const suggestedHeight = numberMatch?.[0] ? parseInt(numberMatch[0], 10) : candidateData.altura == null ? 5 : candidateData.altura;

      alturaAntenaInput.value = suggestedHeight;
      alturaReceiverInput && (alturaReceiverInput.value = 3);
      AppState.clickedCandidateData = candidateData;

      if (panel) {
        panel.classList.remove("hidden");
        typeof mostrarMensagem == "function" && mostrarMensagem(t("messages.success.tower_selected_for_simulation", { name: candidateData.nome }), "sucesso");
      }
    });
  });

  updateLegendsVisibility();
}

function drawPivos(pivots, useEditedPositions = false) {
  if (!map || !Array.isArray(pivots)) return;

  AppState.marcadoresPivos.forEach((marker) => map.removeLayer(marker));
  AppState.marcadoresPivos = [];

  const nonPivotLegends = AppState.marcadoresLegenda.filter((l) => l.options.labelType !== "pivot");
  AppState.marcadoresLegenda.filter((l) => l.options.labelType === "pivot").forEach((l) => map.removeLayer(l));
  AppState.marcadoresLegenda = nonPivotLegends;
  AppState.pivotsMap = {};

  pivots.forEach((pivot) => {
    const color = pivot.fora ? "red" : "green";
    const position = useEditedPositions && AppState.posicoesEditadas?.[pivot.nome]
      ? L.latLng(AppState.posicoesEditadas[pivot.nome].lat, AppState.posicoesEditadas[pivot.nome].lng)
      : L.latLng(pivot.lat, pivot.lon);
    const iconSize = getDynamicIconSize(map.getZoom());

    let markerClassName = "pivo-marker-container";
    AppState.selectedPivoNome === pivot.nome && (markerClassName += " pivo-marker-container-selected");

    const icon = L.divIcon({
      className: markerClassName,
      iconSize: [iconSize, iconSize],
      html: `<div class="pivo-marker-dot" style="background-color:${color};"></div>`
    });
    const marker = L.marker(position, { icon }).addTo(map);

    let labelHtml = escapeHtml(pivot.nome);
    let hasSourceInfo = false;
    let labelWidth = pivot.nome.length * 6.5 + 15;

    if (AppState.distanciasPivosVisiveis) {
      const closestSource = findClosestSignalSource(position);
      if (closestSource) {
        const distanceLabel = closestSource.distance > 999 ? (closestSource.distance / 1000).toFixed(1) + " km" : Math.round(closestSource.distance) + " m";
        let sourceName = "";
        if (closestSource.isMainAntenna) {
          sourceName = getFormattedAntennaOrRepeaterName({
            isMainAntenna: true,
            type: AppState.antenaGlobal?.type,
            nome: AppState.antenaGlobal?.nome,
            altura: AppState.antenaGlobal?.altura
          });
        } else {
          const repeater = AppState.repetidoras.find((r) => r.id === closestSource.id);
          if (repeater) {
            sourceName = getFormattedAntennaOrRepeaterName({
              isMainAntenna: false,
              type: repeater.type,
              nome: repeater.nome,
              altura: repeater.altura
            });
          }
        }
        labelHtml = `${escapeHtml(pivot.nome)}<br><span class="source-name-pivo">${escapeHtml(sourceName)}</span><br><span class="distancia-pivo">${escapeHtml(distanceLabel)}</span>`;
        hasSourceInfo = true;
        labelWidth = Math.max(labelWidth, sourceName.length * 6.5 + 15, distanceLabel.length * 6.5 + 15);
      }
    }

    const labelHeight = hasSourceInfo ? 55 : 20;
    const labelMarker = L.marker(position, {
      icon: L.divIcon({
        className: "label-pivo",
        html: labelHtml,
        iconSize: [labelWidth, labelHeight],
        iconAnchor: [labelWidth / 2, -15]
      }),
      labelType: "pivot",
      interactive: false
    }).addTo(map);
    AppState.marcadoresLegenda.push(labelMarker);

    const tooltipStatus = pivot.fora
      ? `<span style="color:#ff4d4d;font-weight:bold;">${t("tooltips.out_of_signal")}</span>`
      : `<span style="color:#22c55e;font-weight:bold;">${t("tooltips.in_signal")}</span>`;
    marker.bindTooltip(`<div style="text-align:center;">${tooltipStatus}</div>`, {
      permanent: false,
      direction: "top",
      offset: [0, -10],
      className: "tooltip-sinal"
    });

    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      if (AppState.selectedSpecialMarker) {
        AppState.selectedSpecialMarker.getElement()?.classList.remove("marker-selected");
        AppState.selectedSpecialMarker = null;
      }

      const markerEl = marker.getElement();
      if (markerEl) {
        if (AppState.selectedPivoNome === pivot.nome) {
          markerEl.classList.remove("pivo-marker-container-selected");
          AppState.selectedPivoNome = null;
        } else {
          AppState.selectedPivoNome && AppState.pivotsMap[AppState.selectedPivoNome]?.getElement()?.classList.remove("pivo-marker-container-selected");
          markerEl.classList.add("pivo-marker-container-selected");
          AppState.selectedPivoNome = pivot.nome;
        }

        if (AppState.modoEdicaoPivos) {
          marker.bindPopup(`<div class="popup-glass">✏️ ${pivot.fora ? t("tooltips.out_of_signal") : t("tooltips.in_signal")}</div>`).openPopup();
        } else if (AppState.modoLoSPivotAPivot && typeof handleLoSTargetClick == "function") {
          handleLoSTargetClick(pivot, marker);
        } else if (AppState.modoBuscaLocalRepetidora && typeof handlePivotSelectionForRepeaterSite == "function") {
          handlePivotSelectionForRepeaterSite(pivot, marker);
        } else {
          AppState.ultimoCliqueFoiSobrePivo = true;
          AppState.coordenadaClicada = event.latlng;
          typeof removePositioningMarker == "function" && removePositioningMarker();
          document.getElementById("painel-repetidora")?.classList.remove("hidden");
        }
      }
    });

    marker.on("contextmenu", async (event) => {
      L.DomEvent.stop(event);
      if (AppState.modoEdicaoPivos || !await showCustomConfirm(t("messages.confirm.remove_pivot", { name: pivot.nome }))) return;

      const cicloName = `Ciclo ${pivot.nome}`;
      AppState.lastPivosDataDrawn = AppState.lastPivosDataDrawn.filter((p) => p.nome !== pivot.nome);
      AppState.ciclosGlobais = (AppState.ciclosGlobais || []).filter((c) => c.nome_original_circulo !== cicloName);
      AppState.currentProcessedKmzData?.pivos && (AppState.currentProcessedKmzData.pivos = AppState.currentProcessedKmzData.pivos.filter((p) => p.nome !== pivot.nome));
      AppState.currentProcessedKmzData?.ciclos && (AppState.currentProcessedKmzData.ciclos = AppState.currentProcessedKmzData.ciclos.filter((c) => c.nome_original_circulo !== cicloName));
      AppState.selectedPivoNome === pivot.nome && (AppState.selectedPivoNome = null);

      drawPivos(AppState.lastPivosDataDrawn, false);
      typeof drawCirculos == "function" && drawCirculos(AppState.ciclosGlobais);
      typeof atualizarPainelDados == "function" && atualizarPainelDados();
      typeof mostrarMensagem == "function" && mostrarMensagem(t("messages.success.pivot_removed", { name: pivot.nome }), "sucesso");
    });

    AppState.marcadoresPivos.push(marker);
    AppState.pivotsMap[pivot.nome] = marker;
  });

  updatePivotIcons();
  updateLegendsVisibility();
}

function updateAntenaOrRepeaterLabel(entity) {
  if (!entity.label || !map.hasLayer(entity.label)) return;

  const label = getFormattedAntennaOrRepeaterName(entity);
  const labelWidth = label.length * 7 + 10;
  entity.label.setIcon(L.divIcon({
    className: "label-pivo",
    html: escapeHtml(label),
    iconSize: [labelWidth, 20],
    iconAnchor: [labelWidth / 2, 45]
  }));
}

function drawBombas(bombas) {
  if (!map || !Array.isArray(bombas)) return;

  AppState.marcadoresBombas.forEach((marker) => map.removeLayer(marker));
  AppState.marcadoresBombas = [];

  const nonBombaLegends = AppState.marcadoresLegenda.filter((l) => l.options.labelType !== "bomba");
  AppState.marcadoresLegenda.filter((l) => l.options.labelType === "bomba").forEach((l) => map.removeLayer(l));
  AppState.marcadoresLegenda = nonBombaLegends;

  bombas.forEach((bomba, index) => {
    const icon = bomba.fora === false ? window.bombaIconAzul : window.bombaIconVermelho;
    const marker = L.marker([bomba.lat, bomba.lon], { icon }).addTo(map);
    AppState.marcadoresBombas.push(marker);

    const tooltipStatus = bomba.fora === false
      ? `<span style="color:#22c55e;">${t("tooltips.in_signal")}</span>`
      : `<span style="color:#ff4d4d;">${t("tooltips.out_of_signal")}</span>`;
    marker.bindTooltip(`<div style="text-align:center;">${tooltipStatus}</div>`, {
      permanent: false,
      direction: "top",
      offset: [0, -28],
      className: "tooltip-sinal"
    });

    const bombaName = bomba.nome || `Irripump ${String(index + 1).padStart(2, "0")}`;

    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      AppState.modoLoSPivotAPivot && typeof handleLoSTargetClick == "function" && handleLoSTargetClick({ nome: bombaName, fora: bomba.fora }, marker);
    });

    marker.on("contextmenu", async (event) => {
      L.DomEvent.stop(event);
      if (!await showCustomConfirm(t("messages.confirm.remove_irripump", { name: bombaName }))) return;

      map.removeLayer(marker);
      const label = AppState.marcadoresLegenda.find((l) => l.getLatLng().equals(marker.getLatLng()) && l.options.labelType === "bomba" && l.options.icon.options.html.includes(bombaName));
      if (label) {
        map.removeLayer(label);
        AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((l) => l !== label);
      }

      AppState.lastBombasDataDrawn = AppState.lastBombasDataDrawn.filter((b) => !(b.lat === bomba.lat && b.lon === bomba.lon));
      drawBombas(AppState.lastBombasDataDrawn);
      typeof atualizarPainelDados == "function" && atualizarPainelDados();
      typeof reavaliarPivosViaAPI == "function" && reavaliarPivosViaAPI();
      typeof mostrarMensagem == "function" && mostrarMensagem(t("messages.success.irripump_removed", { name: bombaName }), "sucesso");
    });

    let labelHtml = escapeHtml(bombaName);
    let hasSourceInfo = false;
    let labelWidth = bombaName.length * 6.5 + 15;

    if (AppState.distanciasPivosVisiveis) {
      const closestSource = findClosestSignalSource(L.latLng(bomba.lat, bomba.lon));
      if (closestSource) {
        const distanceLabel = closestSource.distance > 999 ? (closestSource.distance / 1000).toFixed(1) + " km" : Math.round(closestSource.distance) + " m";
        let sourceName = "";
        if (closestSource.isMainAntenna) {
          sourceName = getFormattedAntennaOrRepeaterName({
            isMainAntenna: true,
            type: AppState.antenaGlobal?.type,
            nome: AppState.antenaGlobal?.nome,
            altura: AppState.antenaGlobal?.altura
          });
        } else {
          const repeater = AppState.repetidoras.find((r) => r.id === closestSource.id);
          if (repeater) {
            sourceName = getFormattedAntennaOrRepeaterName({
              isMainAntenna: false,
              type: repeater.type,
              nome: repeater.nome,
              altura: repeater.altura
            });
          }
        }
        labelHtml = `${escapeHtml(bombaName)}<br><span class="source-name-pivo">${escapeHtml(sourceName)}</span><br><span class="distancia-pivo">${escapeHtml(distanceLabel)}</span>`;
        hasSourceInfo = true;
        labelWidth = Math.max(labelWidth, sourceName.length * 6.5 + 15, distanceLabel.length * 6.5 + 15);
      }
    }

    const labelHeight = hasSourceInfo ? 55 : 20;
    const labelMarker = L.marker([bomba.lat, bomba.lon], {
      icon: L.divIcon({
        className: "label-pivo",
        html: labelHtml,
        iconSize: [labelWidth, labelHeight],
        iconAnchor: [labelWidth / 2, -5]
      }),
      labelType: "bomba",
      interactive: false
    }).addTo(map);
    AppState.marcadoresLegenda.push(labelMarker);
  });

  updateLegendsVisibility();
}

function addRepetidoraNoPainel(repeater) {
  const list = document.getElementById("lista-repetidoras");
  if (!list) return;

  const item = document.createElement("div");
  item.className = "flex justify-between items-center bg-gray-800/60 px-3 py-2 rounded-lg border border-white/10";
  item.id = `rep-item-${repeater.id}`;

  const diagnosticBtnHtml = `
    <button class="text-white/60 hover:text-sky-300 transition relative top-px"
      title="${t("tooltips.run_diagnostic_from_source")}"
      data-id="${repeater.id}" data-action="diagnostico">
      <span class="sidebar-icon w-4 h-4"
        style="-webkit-mask-image:url(assets/images/mountain.svg);mask-image:url(assets/images/mountain.svg);">
      </span>
    </button>`;

  item.innerHTML = `
    <span class="text-white/80 text-sm">${escapeHtml(getFormattedAntennaOrRepeaterName(repeater))}</span>
    <div class="flex gap-3 items-center">
      ${diagnosticBtnHtml}
      <button class="text-white/60 hover:text-sky-300 transition"
        title="${t("tooltips.show_hide_coverage")}"
        data-id="${repeater.id}" data-action="toggle-visibility" data-visible="true">
        <i data-lucide="eye" class="w-4 h-4 text-green-500"></i>
      </button>
      <button class="text-red-500 hover:text-red-400 text-xs font-bold transition"
        title="${t("ui.titles.remove_repeater")}"
        data-id="${repeater.id}" data-action="remover">❌</button>
    </div>`;

  list.appendChild(item);
  lucide?.createIcons?.();

  repeater.marker?.on("contextmenu", (event) => {
    L.DomEvent.stop(event);
    showRenameRepeaterMenu(repeater.marker, repeater.nome, false, repeater.id);
  });

  item.querySelector('[data-action="diagnostico"]')?.addEventListener("click", () => {
    runTargetedDiagnostic?.(repeater);
  });

  item.querySelector('[data-action="remover"]')?.addEventListener("click", () => {
    repeater.marker && map.removeLayer(repeater.marker);
    repeater.overlay && map.removeLayer(repeater.overlay);
    repeater.label && map.removeLayer(repeater.label);
    list.removeChild(item);
    AppState.idsDisponiveis.push(repeater.id);
    AppState.idsDisponiveis.sort((a, b) => a - b);
    AppState.repetidoras = AppState.repetidoras.filter((r) => r.id !== repeater.id);
    AppState.overlaysVisiveis = AppState.overlaysVisiveis.filter((o) => o !== repeater.overlay);
    AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((l) => l !== repeater.label);
    typeof atualizarPainelDados == "function" && atualizarPainelDados();
    setTimeout(() => {
      reavaliarPivosViaAPI?.();
      updateDownloadActivePngsButtonState?.();
      typeof hasActiveCoverageOverlays == "function" && (
        typeof updatePdfButtonState == "function" && updatePdfButtonState(hasActiveCoverageOverlays()),
        typeof updateKmzButtonState == "function" && updateKmzButtonState(hasActiveCoverageOverlays())
      );
    }, 100);
  });

  const visibilityBtn = item.querySelector('[data-action="toggle-visibility"]');
  visibilityBtn?.addEventListener("click", () => {
    const willBeVisible = !(visibilityBtn.getAttribute("data-visible") === "true");
    visibilityBtn.setAttribute("data-visible", String(willBeVisible));
    const opacity = parseFloat(document.getElementById("range-opacidade").value);
    repeater.overlay && repeater.overlay.setOpacity(willBeVisible ? opacity : 0);
    visibilityBtn.innerHTML = willBeVisible ? '<i data-lucide="eye" class="w-4 h-4 text-green-500"></i>' : '<i data-lucide="eye-off" class="w-4 h-4 text-gray-500"></i>';
    lucide?.createIcons?.();
    setTimeout(() => {
      reavaliarPivosViaAPI?.();
      updateDownloadActivePngsButtonState?.();
    }, 100);
  });
}

function addAntenaAoPainel(antenna) {
  document.getElementById("antena-item")?.remove();

  const list = document.getElementById("lista-repetidoras");
  if (!list) return;

  const item = document.createElement("div");
  item.className = "flex justify-between items-center bg-gray-800/60 px-3 py-2 rounded-lg border border-white/10";
  item.id = "antena-item";

  const diagnosticBtnHtml = `
    <button class="text-white/60 hover:text-sky-300 transition relative top-px"
      title="${t("tooltips.run_diagnostic_from_source")}"
      data-action="diagnostico">
      <span class="sidebar-icon w-4 h-4"
        style="-webkit-mask-image:url(assets/images/mountain.svg);mask-image:url(assets/images/mountain.svg);">
      </span>
    </button>`;

  item.innerHTML = `
    <span class="text-white/80 text-sm">${escapeHtml(getFormattedAntennaOrRepeaterName(antenna))}</span>
    <div class="flex gap-3 items-center">
      ${diagnosticBtnHtml}
      <button class="text-white/60 hover:text-sky-300 transition"
        title="${t("tooltips.show_hide_coverage")}"
        data-action="toggle-visibility" data-visible="true">
        <i data-lucide="eye" class="w-4 h-4 text-green-500"></i>
      </button>
      <button class="text-red-500 hover:text-red-400 text-xs font-bold transition"
        title="${t("ui.titles.remove_repeater")}"
        data-action="remover">❌</button>
    </div>`;

  list.firstChild ? list.insertBefore(item, list.firstChild) : list.appendChild(item);
  lucide?.createIcons?.();

  item.querySelector('[data-action="diagnostico"]')?.addEventListener("click", () => {
    runTargetedDiagnostic?.(antenna);
  });

  item.querySelector('[data-action="remover"]')?.addEventListener("click", () => {
    handleDeleteMainStudy();
  });

  const visibilityBtn = item.querySelector('[data-action="toggle-visibility"]');
  visibilityBtn?.addEventListener("click", () => {
    const willBeVisible = !(visibilityBtn.getAttribute("data-visible") === "true");
    visibilityBtn.setAttribute("data-visible", String(willBeVisible));
    const opacity = parseFloat(document.getElementById("range-opacidade").value);
    antenna?.overlay && antenna.overlay.setOpacity(willBeVisible ? opacity : 0);
    visibilityBtn.innerHTML = willBeVisible ? '<i data-lucide="eye" class="w-4 h-4 text-green-500"></i>' : '<i data-lucide="eye-off" class="w-4 h-4 text-gray-500"></i>';
    lucide?.createIcons?.();
    setTimeout(() => reavaliarPivosViaAPI?.(), 100);
  });
}

function updateLegendsVisibility() {
  Array.isArray(AppState.marcadoresLegenda) && AppState.marcadoresLegenda.forEach((marker) => {
    const el = marker.getElement?.();
    if (!el) return;

    const labelType = marker.options.labelType;
    let visible = false;
    if (labelType === "pivot" || labelType === "bomba") {
      visible = AppState.legendasAtivas;
    } else if (labelType === "antena" || labelType === "repetidora" || labelType === "antena_candidate") {
      visible = AppState.antenaLegendasAtivas;
    }
    el.style.display = visible ? "" : "none";
  });
}

function updateOverlaysOpacity(opacity) {
  const isOverlayVisible = (overlay) => {
    let visibilityBtn = null;
    if (AppState.antenaGlobal?.overlay === overlay) {
      visibilityBtn = document.querySelector("#antena-item button[data-visible]");
    } else {
      const repeater = AppState.repetidoras.find((r) => r.overlay === overlay);
      repeater && (visibilityBtn = document.querySelector(`#rep-item-${repeater.id} button[data-visible]`));
    }
    return !visibilityBtn || visibilityBtn.getAttribute("data-visible") === "true";
  };

  AppState.overlaysVisiveis.forEach((overlay) => {
    map.hasLayer(overlay) && overlay.setOpacity(isOverlayVisible(overlay) ? opacity : 0);
  });
}

function drawCandidateRepeaterSites(sites, target) {
  window.candidateRepeaterSitesLayerGroup || (window.candidateRepeaterSitesLayerGroup = L.layerGroup().addTo(map));
  window.candidateRepeaterSitesLayerGroup.clearLayers();

  if (!Array.isArray(sites) || sites.length === 0) return;

  sites.forEach((site) => {
    if (typeof site.lat > "u") return;

    const latLng = [site.lat, site.lon];
    const icon = L.divIcon({ className: "suggestion-marker-dot", iconSize: [12, 12] });
    const marker = L.marker(latLng, { icon });

    const losText = t(site.has_los ? "tooltips.los_ok" : "tooltips.los_no");
    const losColor = site.has_los ? "#22c55e" : "#FF9800";
    const distanceLabel = t("ui.labels.pivo_distance_label");

    const tooltipHtml = `
      <div class="suggestion-tooltip-content">
        <div class="tooltip-elevation">${site.elevation?.toFixed(1) || "N/A"}m</div>
        <div class="tooltip-status" style="color: ${losColor};">${losText}</div>
        <div class="tooltip-distance">
          ${distanceLabel} ${site.distance_to_target ? site.distance_to_target.toFixed(0) + "m" : "N/A"}
        </div>
      </div>`;

    marker.bindTooltip(tooltipHtml, {
      direction: "top",
      offset: [0, -10],
      permanent: false,
      className: "suggestion-tooltip"
    });
    marker.addTo(window.candidateRepeaterSitesLayerGroup);
  });
}

function togglePivoDistances(show) {
  AppState.lastPivosDataDrawn?.length > 0 && drawPivos(AppState.lastPivosDataDrawn, false);
  AppState.lastBombasDataDrawn?.length > 0 && drawBombas(AppState.lastBombasDataDrawn);
  const messageKey = show ? "messages.success.pivot_distances_shown" : "messages.success.pivot_distances_hidden";
  typeof mostrarMensagem == "function" && mostrarMensagem(t(messageKey), "sucesso");
}
