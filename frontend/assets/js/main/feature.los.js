async function runTargetedDiagnostic(source) {
  if (!source) {
    mostrarMensagem(t("messages.errors.run_study_first"), "erro");
    return;
  }

  AppState.visadaVisivel = true;
  document.getElementById("btn-visada")?.classList.remove("opacity-50");

  const sourceName = getFormattedAntennaOrRepeaterName(source.isMainAntenna ? AppState.antenaGlobal : source);
  const sourceLatLng = source.marker ? source.marker.getLatLng() : L.latLng(source.lat, source.lon);

  mostrarLoader(true);
  AppState.visadaLayerGroup && AppState.visadaLayerGroup.clearLayers();
  AppState.linhasDiagnostico = [];
  AppState.marcadoresBloqueio = [];

  const targets = [];
  const defaultReceiverHeight = AppState.antenaGlobal?.altura_receiver ?? 3;

  AppState.lastPivosDataDrawn.filter((p) => p.fora).forEach((p) => {
    const marker = AppState.pivotsMap[p.nome];
    marker && targets.push({
      nome: p.nome,
      latlng: marker.getLatLng(),
      altura_receiver: defaultReceiverHeight
    });
  });

  AppState.lastBombasDataDrawn.forEach((bomba, index) => {
    if (bomba.fora) {
      const marker = AppState.marcadoresBombas[index];
      marker && targets.push({
        nome: `Irripump ${String(index + 1).padStart(2, "0")}`,
        latlng: marker.getLatLng(),
        altura_receiver: defaultReceiverHeight
      });
    }
  });

  const radiusKm = 4.5;
  const radiusMeters = radiusKm * 1000;
  const totalTargets = targets.length;
  const targetsInRange = targets.filter((target) => sourceLatLng.distanceTo(target.latlng) <= radiusMeters);

  if (targetsInRange.length === 0) {
    totalTargets > 0
      ? mostrarMensagem(t("messages.info.no_uncovered_targets_in_radius", { limit: `${radiusKm}km` }), "info")
      : mostrarMensagem(t("messages.info.no_uncovered_targets"), "sucesso");
    mostrarLoader(false);
    return;
  }

  const ignoredByDistance = totalTargets - targetsInRange.length;
  let statusMessage = t("messages.info.analyzing_targets_from_source", {
    count: targetsInRange.length,
    source: sourceName
  });
  ignoredByDistance > 0 && (statusMessage += ` ${t("messages.info.targets_ignored_by_distance", { count: ignoredByDistance, limit: `${radiusKm}km` })}`);
  mostrarMensagem(statusMessage, "sucesso");

  await Promise.allSettled(targetsInRange.map(async (target) => {
    const targetLatLng = target.latlng;
    const distanceMeters = sourceLatLng.distanceTo(targetLatLng);
    const distanceLabel = distanceMeters > 999 ? (distanceMeters / 1000).toFixed(1) + " km" : Math.round(distanceMeters) + " m";
    const profileRequest = {
      pontos: [
        [sourceLatLng.lat, sourceLatLng.lng],
        [targetLatLng.lat, targetLatLng.lng]
      ],
      altura_antena: source.altura || 15,
      altura_receiver: target.altura_receiver,
      return_highest_point: true
    };

    try {
      const profile = await getElevationProfile(profileRequest);
      const label = `${sourceName} → ${target.nome}`;
      const context = {
        pivos: AppState.lastPivosDataDrawn,
        ciclos: AppState.ciclosGlobais,
        antena: AppState.antenaGlobal,
        repetidoras: AppState.repetidoras
      };
      drawDiagnostico(profileRequest.pontos[0], profileRequest.pontos[1], profile.bloqueio, profile.ponto_mais_alto, label, distanceLabel, profile, profileRequest, context);
    } catch (err) {
      console.error(`Erro no diagnóstico do alvo ${target.nome}:`, err);
      mostrarMensagem(t("messages.errors.los_diagnostic_fail", { name: target.nome }), "erro");
    }
  }));

  typeof lucide < "u" && lucide.createIcons();
  mostrarLoader(false);
  mostrarMensagem(t("messages.success.los_diagnostic_complete"), "sucesso");
}

function toggleLoSPivotAPivotMode() {
  const activating = !AppState.modoLoSPivotAPivot;
  activating && deactivateAllModes();
  AppState.modoLoSPivotAPivot = activating;

  document.getElementById("btn-los-pivot-a-pivot")?.classList.toggle("glass-button-active", AppState.modoLoSPivotAPivot);

  if (activating) {
    mostrarMensagem(t("messages.info.los_mode_step1_source"), "sucesso");
    AppState.marcadorPosicionamento && removePositioningMarker();
    document.getElementById("painel-repetidora")?.classList.add("hidden");
    AppState.losSourcePivot = null;
    AppState.losTargetPivot = null;
    map.getContainer().style.cursor = "help";
  } else {
    mostrarMensagem(t("messages.info.los_mode_deactivated"), "sucesso");
    AppState.losSourcePivot = null;
    AppState.losTargetPivot = null;
    map.getContainer().style.cursor = "";
    if (AppState.visadaLayerGroup) {
      AppState.visadaLayerGroup.clearLayers();
      AppState.linhasDiagnostico = [];
      AppState.marcadoresBloqueio = [];
    }
  }
}

async function handleLoSTargetClick(clickedItem, marker) {
  if (!AppState.modoLoSPivotAPivot) return;

  const defaultSourceHeight = 5;
  const defaultReceiverHeight = AppState.antenaGlobal?.altura_receiver ?? 3;

  if (!AppState.losSourcePivot) {
    let sourceHeight;
    let isMainAntenna = false;
    let sourceType = "pivot";

    if (clickedItem.id) {
      if (clickedItem.id === "main_antenna" || AppState.antenaGlobal && clickedItem.id === AppState.antenaGlobal.id) {
        sourceHeight = AppState.antenaGlobal.altura;
        isMainAntenna = true;
        sourceType = AppState.antenaGlobal.type;
      } else {
        const repeater = AppState.repetidoras.find((rep) => rep.id === clickedItem.id);
        if (repeater) {
          sourceHeight = repeater.altura;
          sourceType = repeater.type;
        } else {
          sourceHeight = defaultSourceHeight;
        }
      }
    } else {
      sourceHeight = defaultSourceHeight;
    }

    AppState.losSourcePivot = {
      ...clickedItem,
      latlng: marker.getLatLng(),
      altura: sourceHeight,
      isMainAntenna,
      type: sourceType
    };
    mostrarMensagem(t("messages.info.los_source_selected", { name: clickedItem.nome }), "sucesso");
    return;
  }

  const source = AppState.losSourcePivot;
  const target = { ...clickedItem, latlng: marker.getLatLng() };

  if (source.nome === target.nome) {
    mostrarMensagem(t("messages.info.los_source_already_selected", { name: clickedItem.nome }), "info");
    return;
  }

  let transmitter, receiver;
  const sourceHasSignal = source.fora === false || source.id;
  const targetHasSignal = target.fora === false || clickedItem.id;

  if (!sourceHasSignal && !targetHasSignal) {
    mostrarMensagem(t("messages.errors.los_need_one_signal_source"), "erro");
    AppState.losSourcePivot = null;
    return;
  }

  if (sourceHasSignal) {
    transmitter = source;
    receiver = target;
  } else {
    transmitter = target;
    receiver = source;
  }

  transmitter.altura = transmitter.altura || (transmitter.id ? AppState.antenaGlobal?.altura : defaultSourceHeight);
  receiver.altura = defaultReceiverHeight;

  mostrarLoader(true);
  let hadError = false;

  try {
    typeof setVisadaVisible == "function" && setVisadaVisible(true);

    const distanceMeters = transmitter.latlng.distanceTo(receiver.latlng);
    const distanceLabel = distanceMeters > 999 ? (distanceMeters / 1000).toFixed(1) + " km" : Math.round(distanceMeters) + " m";
    const profileRequest = {
      pontos: [
        [transmitter.latlng.lat, transmitter.latlng.lng],
        [receiver.latlng.lat, receiver.latlng.lng]
      ],
      altura_antena: transmitter.altura,
      altura_receiver: receiver.altura,
      return_highest_point: true
    };

    const profile = await getElevationProfile(profileRequest);
    const isCriticallyBlocked = profile.bloqueio?.diff > 0.1;
    const context = {
      pivos: AppState.lastPivosDataDrawn,
      ciclos: AppState.ciclosGlobais,
      antena: AppState.antenaGlobal,
      repetidoras: AppState.repetidoras
    };

    window.Analysis3D && typeof window.Analysis3D.show == "function" && window.Analysis3D.show(profile, profileRequest.altura_antena, profileRequest.altura_receiver, context);

    const transmitterName = getFormattedAntennaOrRepeaterName(transmitter);
    drawDiagnostico(profileRequest.pontos[0], profileRequest.pontos[1], profile.bloqueio, profile.ponto_mais_alto, `${transmitterName} → ${receiver.nome}`, distanceLabel, profile, profileRequest, context);

    let resultKey = "los_result_clear";
    if (isCriticallyBlocked) {
      resultKey = "los_result_blocked";
    } else if (profile.bloqueio) {
      resultKey = "los_result_clear_critical";
    }

    mostrarMensagem(t(`messages.info.${resultKey}`, {
      source: transmitterName,
      target: receiver.nome,
      distance: distanceLabel
    }), isCriticallyBlocked ? "erro" : "sucesso");
  } catch (err) {
    hadError = true;
    console.error("Erro no diagnóstico LoS Alvo a Alvo:", err);
    mostrarMensagem(t("messages.info.los_result_error", {
      source: transmitter?.nome || "Origem",
      target: receiver?.nome || "Destino",
      distance: "N/A",
      error: err.message
    }), "erro");
  } finally {
    mostrarLoader(false);
    AppState.losSourcePivot = null;
    AppState.modoLoSPivotAPivot && setTimeout(() => {
      AppState.modoLoSPivotAPivot && mostrarMensagem(t("messages.info.los_new_source_prompt"), "info");
    }, hadError ? 700 : 1800);
  }
}
