function deactivateAllModes() {
  AppState.modoDesenhoPivo && toggleModoDesenhoPivo();
  AppState.modoDesenhoPivoSetorial && toggleModoDesenhoPivoSetorial();
  AppState.modoDesenhoPivoPacman && toggleModoDesenhoPivoPacman();
  AppState.modoDesenhoIrripump && toggleModoDesenhoIrripump();
  AppState.modoEdicaoPivos && togglePivoEditing();
  AppState.modoLoSPivotAPivot && toggleLoSPivotAPivotMode();
  AppState.modoBuscaLocalRepetidora && handleBuscarLocaisRepetidoraActivation();
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function handleSpecialMarkerSelection(marker) {
  if (AppState.selectedPivoNome) {
    AppState.pivotsMap[AppState.selectedPivoNome]?.getElement()?.classList.remove("pivo-marker-container-selected");
    AppState.selectedPivoNome = null;
  }

  const previouslySelected = AppState.selectedSpecialMarker;
  const el = marker.getElement();

  previouslySelected && previouslySelected !== marker && previouslySelected.getElement()?.classList.remove("marker-selected");

  if (el) {
    if (el.classList.contains("marker-selected")) {
      el.classList.remove("marker-selected");
      AppState.selectedSpecialMarker = null;
    } else {
      el.classList.add("marker-selected");
      AppState.selectedSpecialMarker = marker;
    }
  }
}

function deselectAllMarkers() {
  if (AppState.selectedPivoNome) {
    AppState.pivotsMap[AppState.selectedPivoNome]?.getElement()?.classList.remove("pivo-marker-container-selected");
    AppState.selectedPivoNome = null;
  }
  if (AppState.selectedSpecialMarker) {
    AppState.selectedSpecialMarker.getElement()?.classList.remove("marker-selected");
    AppState.selectedSpecialMarker = null;
  }
}

function handleGlobalKeys(event) {
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;

  if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    focusOnFarm();
    return;
  }

  if (event.key === "Escape") {
    let cancelledDrawingMode = false;
    if (AppState.modoDesenhoPivo || AppState.modoDesenhoPivoSetorial || AppState.modoDesenhoPivoPacman || AppState.modoDesenhoIrripump) {
      deactivateAllModes();
      cancelledDrawingMode = true;
    }
    if (cancelledDrawingMode) {
      event.preventDefault();
      event.stopPropagation();
      mostrarMensagem(t("messages.info.drawing_modes_cancelled_by_esc"), "info");
    }
    AppState.modoLoSPivotAPivot && toggleLoSPivotAPivotMode();
    AppState.modoBuscaLocalRepetidora && handleBuscarLocaisRepetidoraActivation();
    if (AppState.marcadorPosicionamento) {
      removePositioningMarker();
      document.getElementById("painel-repetidora")?.classList.add("hidden");
    }
    deselectAllMarkers();
    map && (map.getContainer().style.cursor = "");
  }
}

function focusOnFarm() {
  const points = [];
  AppState.lastPivosDataDrawn && AppState.lastPivosDataDrawn.forEach((p) => points.push([p.lat, p.lon]));
  AppState.lastBombasDataDrawn && AppState.lastBombasDataDrawn.forEach((p) => points.push([p.lat, p.lon]));
  AppState.repetidoras && AppState.repetidoras.forEach((p) => points.push([p.lat, p.lon]));
  AppState.antenaGlobal && points.push([AppState.antenaGlobal.lat, AppState.antenaGlobal.lon]);

  if (points.length > 0) {
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [70, 70] });
  }
}

function toggleModoMoverPivoSemCirculo() {
  const isActive = !AppState.modoMoverPivoSemCirculo;
  AppState.modoMoverPivoSemCirculo = isActive;

  const btn = document.getElementById("btn-mover-pivo-sem-circulo");
  btn && btn.classList.toggle("glass-button-active", isActive);

  isActive
    ? mostrarMensagem(t("messages.info.move_pivot_center_on"), "sucesso")
    : mostrarMensagem(t("messages.info.move_pivot_center_off"), "sucesso");
}
