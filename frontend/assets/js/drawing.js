// assets/js/drawing.js
/* global L, map, AppState, t, updateLegendsVisibility, drawCirculos, reavaliarPivosViaAPI, runTargetedDiagnostic,
        handleLoSTargetClick, handlePivotSelectionForRepeaterSite, removePositioningMarker, handleSpecialMarkerSelection, lucide */

// -- Ícones (use paths relativos para funcionar em qualquer host/subpath) --
const TORRE_ICON_PATH = "assets/images/cloudrf.png";
const BOMBA_ICON_AZUL_PATH = "assets/images/homegardenbusiness.png";
const BOMBA_ICON_VERMELHO_PATH = "assets/images/homegardenbusiness-red.png";
const ATTENTION_ICON_PATH = "assets/images/attention-icon-original.svg";
const CHECK_ICON_PATH = "assets/images/circle-check-big.svg";
const MOUNTAIN_ICON_PATH = "assets/images/attention-icon-original.svg";
const CAPTIONS_ON_ICON_PATH = "assets/images/captions.svg";
const CAPTIONS_OFF_ICON_PATH = "assets/images/captions-off.svg";

// -- Defaults seguros do AppState --
(function ensureAppStateLocals() {
    if (!window.AppState) window.AppState = {};
    AppState.marcadoresLegenda ??= [];
    AppState.marcadoresPivos ??= [];
    AppState.marcadoresBombas ??= [];
    AppState.circulosPivos ??= [];
    AppState.overlaysVisiveis ??= [];
    AppState.pivotsMap ??= {};
    AppState.idsDisponiveis ??= [];
    AppState.repetidoras ??= [];
    AppState.lastPivosDataDrawn ??= [];
    AppState.lastBombasDataDrawn ??= [];
    AppState.visadaLayerGroup ??= null;
    AppState.antenaCandidatesLayerGroup ??= null;
})();

// -- Ícones Leaflet --
const antenaIcon = L.divIcon({
    className: "leaflet-div-icon-transparent",
    html: `<div class="selection-effect-wrapper"><img src="${TORRE_ICON_PATH}" style="width:28px;height:28px;"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28]
});

const bombaIconAzul = L.divIcon({
    className: "leaflet-div-icon-transparent",
    html: `<div class="selection-effect-wrapper"><img src="${BOMBA_ICON_AZUL_PATH}" style="width:28px;height:28px;"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28]
});

const bombaIconVermelho = L.divIcon({
    className: "leaflet-div-icon-transparent",
    html: `<div class="selection-effect-wrapper"><img src="${BOMBA_ICON_VERMELHO_PATH}" style="width:28px;height:28px;"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28]
});

const posicionamentoIcon = L.icon({
    iconUrl: TORRE_ICON_PATH,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -30]
});

// temporários de desenho
let tempSectorShape = null;
let tempPacmanShape = null;
let tempCircle = null;

// ------------------------------------
// Tamanho dinâmico dos ícones de pivô
// ------------------------------------
function getDynamicIconSize(zoom) {
    const minZoom = 10;
    const maxZoom = 17;
    const minSize = 10;
    const maxSize = 20;

    if (zoom <= minZoom) return minSize;
    if (zoom >= maxZoom) return maxSize;

    const zoomRange = maxZoom - minZoom;
    const sizeRange = maxSize - minSize;
    const size = ((zoom - minZoom) / zoomRange) * sizeRange + minSize;
    return Math.round(size);
}

function updatePivotIcons() {
    if (!map || !Array.isArray(AppState.lastPivosDataDrawn) || !Array.isArray(AppState.marcadoresPivos)) return;

    const newSize = getDynamicIconSize(map.getZoom());

    AppState.lastPivosDataDrawn.forEach((pivo, idx) => {
        const marker = AppState.marcadoresPivos[idx];
        if (!marker) return;

        const cor = pivo.fora ? "red" : "green";
        let iconClasses = "pivo-marker-container";
        if (AppState.selectedPivoNome === pivo.nome) {
            iconClasses += " pivo-marker-container-selected";
        }

        const newIcon = L.divIcon({
            className: iconClasses,
            iconSize: [newSize, newSize],
            html: `<div class="pivo-marker-dot" style="background-color:${cor};"></div>`
        });

        marker.setIcon(newIcon);
    });
}

// ----------------------------------------------------
// Melhor fonte de sinal (central vs repetidora mais perto)
// ----------------------------------------------------
function findClosestSignalSource(targetLatLng) {
    let closestSource = null;
    let minDistance = Infinity;

    const antenaVisBtn = document.querySelector("#antena-item button[data-visible]");
    const isAntenaVisible = !antenaVisBtn || antenaVisBtn.getAttribute("data-visible") === "true";

    if (AppState.antenaGlobal && isAntenaVisible) {
    const antenaLatLng = L.latLng(AppState.antenaGlobal.lat, AppState.antenaGlobal.lon);
    const distance = targetLatLng.distanceTo(antenaLatLng);
    if (distance < minDistance) {
        minDistance = distance;
        closestSource = {
        id: "main_antenna",
        name: AppState.antenaGlobal.nome || t("ui.labels.main_antenna_default"),
        distance,
        isMainAntenna: true,
        type: AppState.antenaGlobal.type
        };
    }
}

    AppState.repetidoras.forEach((rep) => {
    const repVisBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
    const isRepVisible = !repVisBtn || repVisBtn.getAttribute("data-visible") === "true";
    if (!rep.marker || !isRepVisible) return;

    const repLatLng = rep.marker.getLatLng();
    const distance = targetLatLng.distanceTo(repLatLng);
    if (distance < minDistance) {
        minDistance = distance;
        closestSource = {
        id: rep.id,
        name: rep.nome,
        distance,
        isMainAntenna: false,
        type: rep.type
        };
    }
    });

    return closestSource;
}

// ---------------------------------------
// Nome formatado (central/repetidora/KMZ)
// ---------------------------------------
function getFormattedAntennaOrRepeaterName(entity) {
    if (!entity) return "";
    const baseName = entity.nome || "";
    const hasKmzHeight = entity.is_from_kmz && entity.had_height_in_kmz;
    // remove alturas finais já presentes, com ou sem hífen (ex: "Central 5m", "Central - 5m", "Central 5m - 5m")
    const regexLimpezaAltura = /(?:\s*-?\s*\d+(?:\.\d+)?\s*m)+$/i;
    const cleanBaseName = hasKmzHeight
        ? baseName.replace(regexLimpezaAltura, "").trim()
        : baseName.trim();

    if (hasKmzHeight) {
        const alturaValida = entity.altura !== null && entity.altura !== undefined;
        const alturaStr = alturaValida ? ` - ${entity.altura}m` : "";
        return `${cleanBaseName}${alturaStr}`;
    }
    return cleanBaseName;
}

// -----------------------------
// Menu de renomear repetidora
// -----------------------------
function showRenameRepeaterMenu(marker, currentName, isMainAntenna, entityId) {
    removeRenameMenu();

const menu = document.createElement("div");
menu.className = "rename-menu";

let options = [];
if (isMainAntenna) {
    options = [
        { text: t("entity_names.central"), value: "central" },
        { text: t("entity_names.central_repeater_combined"), value: "central_repeater_combined" }
    ];
} else {
    options = [
        { text: t("entity_names.tower"), value: "tower" },
        { text: t("entity_names.pole"), value: "pole" },
        { text: t("entity_names.water_tank"), value: "water_tank" },
        { text: t("entity_names.central"), value: "central" },
        { text: t("entity_names.central_repeater_combined"), value: "central_repeater_combined" }
    ];
}

options.forEach((option) => {
    const button = document.createElement("button");
    button.textContent = option.text;
    button.className = "block w-full text-left px-3 py-1 text-white hover:bg-gray-700 rounded-sm text-sm";
    button.onclick = (e) => {
        e.stopPropagation();
        if (isMainAntenna) {
        if (typeof handleRenameMainAntenna === "function") handleRenameMainAntenna(option.value);
    } else if (typeof handleRenameRepeater === "function") {
        handleRenameRepeater(entityId, option.value);
    }
        removeRenameMenu();
    };
    menu.appendChild(button);
});

    const restoreOriginalButton = document.createElement("button");
    restoreOriginalButton.textContent = t("ui.titles.restore_original_name");
    restoreOriginalButton.className =
    "block w-full text-left px-3 py-1 text-white hover:bg-gray-700 rounded-sm text-sm mt-2 border-t border-gray-600 pt-2";
    restoreOriginalButton.onclick = (e) => {
    e.stopPropagation();
    if (isMainAntenna) {
        if (AppState.antenaGlobal?.original_name && typeof handleRenameMainAntenna === "function") {
        handleRenameMainAntenna("default");
    }
    } else {
        const repetidora = AppState.repetidoras.find((r) => r.id === entityId);
        if (repetidora?.original_name && typeof handleRenameRepeater === "function") {
        handleRenameRepeater(entityId, "default");
        }
    }
    removeRenameMenu();
};
    menu.appendChild(restoreOriginalButton);

    const mapContainer = map.getContainer();
    menu.style.visibility = "hidden";
    mapContainer.appendChild(menu);

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const mapWidth = mapContainer.clientWidth;
    const mapHeight = mapContainer.clientHeight;
    const markerPos = map.latLngToContainerPoint(marker.getLatLng());

    let finalTop = markerPos.y;
    let finalLeft = markerPos.x + 20;

    if (markerPos.y + menuHeight + 10 > mapHeight) finalTop = markerPos.y - menuHeight - 10;
    if (finalLeft + menuWidth > mapWidth) finalLeft = markerPos.x - menuWidth - 20;

    menu.style.left = `${finalLeft}px`;
    menu.style.top = `${finalTop}px`;
    menu.style.visibility = "visible";

    setTimeout(() => {
    document.addEventListener("click", removeRenameMenu, { once: true });
    }, 100);
}

function removeRenameMenu() {
    document.querySelector(".rename-menu")?.remove();
}

// -----------------------
// Desenho: Antenas (KMZ)
// -----------------------
function drawAntenaCandidates(antenasList) {
    if (!map || !AppState.antenaCandidatesLayerGroup) return;
    AppState.antenaCandidatesLayerGroup.clearLayers();

    (antenasList || []).forEach((antenaData) => {
        const uniqueId = `candidate-${antenaData.nome}-${antenaData.lat}`;

        const marker = L.marker([antenaData.lat, antenaData.lon], {
            icon: antenaIcon,
            customData: antenaData,
            customId: uniqueId
        }).addTo(AppState.antenaCandidatesLayerGroup);

        const formattedName = getFormattedAntennaOrRepeaterName({ ...antenaData, is_from_kmz: true });
        const labelWidth = formattedName.length * 7 + 10;

        const label = L.marker([antenaData.lat, antenaData.lon], {
            icon: L.divIcon({
                className: "label-pivo",
                html: formattedName,
                iconSize: [labelWidth, 20],
                iconAnchor: [labelWidth / 2, 45]
            }),
            interactive: false,
            customId: uniqueId,
            labelType: "antena_candidate"
        }).addTo(AppState.antenaCandidatesLayerGroup);

        AppState.marcadoresLegenda.push(label);

        marker.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            if (typeof handleSpecialMarkerSelection === "function") handleSpecialMarkerSelection(marker);

            const data = e.target.options.customData;
            AppState.coordenadaClicada = e.latlng;

            const painelRepetidora = document.getElementById("painel-repetidora");
            const inputAltura = document.getElementById("altura-antena-rep");
            const inputAlturaRx = document.getElementById("altura-receiver-rep");
            const nomeDaTorre = data.nome || "";
            const match = nomeDaTorre.match(/\d+/);

            let alturaParaDefinir;

            if (match && match[0]) {
                alturaParaDefinir = parseInt(match[0], 10);
            } else {
                alturaParaDefinir = data.altura == null ? 5 : data.altura;
            }

            inputAltura.value = alturaParaDefinir;
            if (inputAlturaRx) {
                inputAlturaRx.value = 3;
            }

            AppState.clickedCandidateData = data;

            if (painelRepetidora) {
                painelRepetidora.classList.remove("hidden");
                if (typeof mostrarMensagem === "function") {
                    mostrarMensagem(t("messages.success.tower_selected_for_simulation", { name: data.nome }), "sucesso");
                }
            }
        });
    });

    updateLegendsVisibility();
}

// -----------------------
// Desenho: Pivôs
// -----------------------
function drawPivos(pivosData, useEdited = false) {
    if (!map || !Array.isArray(pivosData)) return;

    AppState.marcadoresPivos.forEach((m) => map.removeLayer(m));
    AppState.marcadoresPivos = [];

// limpa labels de pivô
    const restantes = AppState.marcadoresLegenda.filter((l) => l.options.labelType !== "pivot");
    AppState.marcadoresLegenda
    .filter((l) => l.options.labelType === "pivot")
    .forEach((l) => map.removeLayer(l));
    AppState.marcadoresLegenda = restantes;

    AppState.pivotsMap = {};

    pivosData.forEach((pivo) => {
    const cor = pivo.fora ? "red" : "green";
    const pos =
        useEdited && AppState.posicoesEditadas?.[pivo.nome]
        ? L.latLng(AppState.posicoesEditadas[pivo.nome].lat, AppState.posicoesEditadas[pivo.nome].lng)
        : L.latLng(pivo.lat, pivo.lon);

    const initialSize = getDynamicIconSize(map.getZoom());
    let iconClasses = "pivo-marker-container";
    if (AppState.selectedPivoNome === pivo.nome) iconClasses += " pivo-marker-container-selected";

    const pivoIcon = L.divIcon({
        className: iconClasses,
        iconSize: [initialSize, initialSize],
        html: `<div class="pivo-marker-dot" style="background-color:${cor};"></div>`
    });

    const marker = L.marker(pos, { icon: pivoIcon }).addTo(map);

    // label com distância e fonte de sinal (opcional)
    let finalHtml = pivo.nome;
    let hasDistancia = false;
    let labelWidth = pivo.nome.length * 6.5 + 15;

    if (AppState.distanciasPivosVisiveis) {
    const closest = findClosestSignalSource(pos);
    if (closest) {
        const distanciaFormatada =
        closest.distance > 999 ? (closest.distance / 1000).toFixed(1) + " km" : Math.round(closest.distance) + " m";

        let sourceFormattedName = "";
        if (closest.isMainAntenna) {
            sourceFormattedName = getFormattedAntennaOrRepeaterName({
            isMainAntenna: true,
            type: AppState.antenaGlobal?.type,
            nome: AppState.antenaGlobal?.nome,
            altura: AppState.antenaGlobal?.altura
        });
    } else {
        const rep = AppState.repetidoras.find((r) => r.id === closest.id);
        if (rep) {
            sourceFormattedName = getFormattedAntennaOrRepeaterName({
                isMainAntenna: false,
                type: rep.type,
                nome: rep.nome,
                altura: rep.altura
            });
        }
    }

        finalHtml = `${pivo.nome}<br><span class="source-name-pivo">${sourceFormattedName}</span><br><span class="distancia-pivo">${distanciaFormatada}</span>`;
        hasDistancia = true;
        labelWidth = Math.max(
        labelWidth,
        sourceFormattedName.length * 6.5 + 15,
        distanciaFormatada.length * 6.5 + 15
            );
        }
    }

    const labelHeight = hasDistancia ? 55 : 20;
    const label = L.marker(pos, {
        icon: L.divIcon({
        className: "label-pivo",
        html: finalHtml,
        iconSize: [labelWidth, labelHeight],
        iconAnchor: [labelWidth / 2, -15]
        }),
        labelType: "pivot",
        interactive: false
    }).addTo(map);
    AppState.marcadoresLegenda.push(label);

    const statusTexto = pivo.fora
        ? `<span style="color:#ff4d4d;font-weight:bold;">${t("tooltips.out_of_signal")}</span>`
        : `<span style="color:#22c55e;font-weight:bold;">${t("tooltips.in_signal")}</span>`;
    marker.bindTooltip(`<div style="text-align:center;">${statusTexto}</div>`, {
        permanent: false,
        direction: "top",
        offset: [0, -10],
        className: "tooltip-sinal"
    });

    marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);

      // desmarca marcador especial
    if (AppState.selectedSpecialMarker) {
        AppState.selectedSpecialMarker.getElement()?.classList.remove("marker-selected");
        AppState.selectedSpecialMarker = null;
    }

        const el = marker.getElement();
        if (!el) return;

        if (AppState.selectedPivoNome === pivo.nome) {
        el.classList.remove("pivo-marker-container-selected");
        AppState.selectedPivoNome = null;
        } else {
        if (AppState.selectedPivoNome) {
            const oldMarker = AppState.pivotsMap[AppState.selectedPivoNome];
            oldMarker?.getElement()?.classList.remove("pivo-marker-container-selected");
        }
        el.classList.add("pivo-marker-container-selected");
        AppState.selectedPivoNome = pivo.nome;
        }

        if (AppState.modoEdicaoPivos) {
        marker.bindPopup(
            `<div class="popup-glass">✏️ ${pivo.fora ? t("tooltips.out_of_signal") : t("tooltips.in_signal")}</div>`
        ).openPopup();
        } else if (AppState.modoLoSPivotAPivot && typeof handleLoSTargetClick === "function") {
        handleLoSTargetClick(pivo, marker);
        } else if (AppState.modoBuscaLocalRepetidora && typeof handlePivotSelectionForRepeaterSite === "function") {
        handlePivotSelectionForRepeaterSite(pivo, marker);
        } else {
        AppState.ultimoCliqueFoiSobrePivo = true;
        AppState.coordenadaClicada = e.latlng;
        if (typeof removePositioningMarker === "function") removePositioningMarker();
        document.getElementById("painel-repetidora")?.classList.remove("hidden");
        }
    });

    marker.on("contextmenu", async (e) => {
        L.DomEvent.stop(e);
        if (AppState.modoEdicaoPivos) return;

        const confirmed = await showCustomConfirm(t("messages.confirm.remove_pivot", { name: pivo.nome }));
        if (!confirmed) return;

        const nomeCicloParaRemover = `Ciclo ${pivo.nome}`;
        AppState.lastPivosDataDrawn = AppState.lastPivosDataDrawn.filter((p) => p.nome !== pivo.nome);
        AppState.ciclosGlobais = (AppState.ciclosGlobais || []).filter(
        (c) => c.nome_original_circulo !== nomeCicloParaRemover
        );
        if (AppState.currentProcessedKmzData?.pivos) {
        AppState.currentProcessedKmzData.pivos = AppState.currentProcessedKmzData.pivos.filter(
            (p) => p.nome !== pivo.nome
        );
        }
        if (AppState.currentProcessedKmzData?.ciclos) {
        AppState.currentProcessedKmzData.ciclos = AppState.currentProcessedKmzData.ciclos.filter(
            (c) => c.nome_original_circulo !== nomeCicloParaRemover
        );
        }

        if (AppState.selectedPivoNome === pivo.nome) AppState.selectedPivoNome = null;

        drawPivos(AppState.lastPivosDataDrawn, false);
        if (typeof drawCirculos === "function") drawCirculos(AppState.ciclosGlobais);
        if (typeof atualizarPainelDados === "function") atualizarPainelDados();
        if (typeof mostrarMensagem === "function")
        mostrarMensagem(t("messages.success.pivot_removed", { name: pivo.nome }), "sucesso");
    });

    AppState.marcadoresPivos.push(marker);
    AppState.pivotsMap[pivo.nome] = marker;
    });

    // Garante que o tamanho do ícone seja recalculado com o zoom atual
    updatePivotIcons();

updateLegendsVisibility();
}

// -----------------------
// Atualiza label (central/rep)
// -----------------------
function updateAntenaOrRepeaterLabel(entity) {
    if (!entity.label || !map.hasLayer(entity.label)) return;
    const newHtml = getFormattedAntennaOrRepeaterName(entity);
    const labelWidth = newHtml.length * 7 + 10;
    entity.label.setIcon(
    L.divIcon({
        className: "label-pivo",
        html: newHtml,
        iconSize: [labelWidth, 20],
        iconAnchor: [labelWidth / 2, 45]
        })
    );
}

// -----------------------
// Bombas (Irripump)
// -----------------------
function drawBombas(bombasData) {
    if (!map || !Array.isArray(bombasData)) return;

    AppState.marcadoresBombas.forEach((b) => map.removeLayer(b));
    AppState.marcadoresBombas = [];

    const restantes = AppState.marcadoresLegenda.filter((m) => m.options.labelType !== "bomba");
    AppState.marcadoresLegenda
    .filter((l) => l.options.labelType === "bomba")
    .forEach((l) => map.removeLayer(l));
    AppState.marcadoresLegenda = restantes;

    bombasData.forEach((bomba, i) => {
    const icone = bomba.fora === false ? bombaIconAzul : bombaIconVermelho;
    const marcadorBomba = L.marker([bomba.lat, bomba.lon], { icon: icone }).addTo(map);
    AppState.marcadoresBombas.push(marcadorBomba);

    const statusTexto =
        bomba.fora === false
        ? `<span style="color:#22c55e;">${t("tooltips.in_signal")}</span>`
        : `<span style="color:#ff4d4d;">${t("tooltips.out_of_signal")}</span>`;
    marcadorBomba.bindTooltip(`<div style="text-align:center;">${statusTexto}</div>`, {
        permanent: false,
        direction: "top",
        offset: [0, -28],
        className: "tooltip-sinal"
    });

    const nomeBomba = bomba.nome || `Irripump ${String(i + 1).padStart(2, "0")}`;

    marcadorBomba.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (AppState.modoLoSPivotAPivot && typeof handleLoSTargetClick === "function") {
            handleLoSTargetClick({ nome: nomeBomba, fora: bomba.fora }, marcadorBomba);
        }
    });

    marcadorBomba.on("contextmenu", async (e) => {
        L.DomEvent.stop(e);
        const confirmed = await showCustomConfirm(t("messages.confirm.remove_irripump", { name: nomeBomba }));
        if (!confirmed) return;

        map.removeLayer(marcadorBomba);

        const labelParaRemover = AppState.marcadoresLegenda.find(
        (l) =>
            l.getLatLng().equals(marcadorBomba.getLatLng()) &&
            l.options.labelType === "bomba" &&
            l.options.icon.options.html.includes(nomeBomba)
    );
    if (labelParaRemover) {
        map.removeLayer(labelParaRemover);
        AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((l) => l !== labelParaRemover);
    }

    AppState.lastBombasDataDrawn = AppState.lastBombasDataDrawn.filter(
        (b) => !(b.lat === bomba.lat && b.lon === bomba.lon)
    );
        drawBombas(AppState.lastBombasDataDrawn);
        if (typeof atualizarPainelDados === "function") atualizarPainelDados();
        if (typeof reavaliarPivosViaAPI === "function") reavaliarPivosViaAPI();
        if (typeof mostrarMensagem === "function")
        mostrarMensagem(t("messages.success.irripump_removed", { name: nomeBomba }), "sucesso");
    });

    // label da bomba com distância/fonte (opcional)
    let finalHtml = nomeBomba;
    let hasDistancia = false;
    let labelWidth = nomeBomba.length * 6.5 + 15;

    if (AppState.distanciasPivosVisiveis) {
        const closest = findClosestSignalSource(L.latLng(bomba.lat, bomba.lon));
        if (closest) {
        const distanciaFormatada =
            closest.distance > 999 ? (closest.distance / 1000).toFixed(1) + " km" : Math.round(closest.distance) + " m";

        let sourceFormattedName = "";
        if (closest.isMainAntenna) {
            sourceFormattedName = getFormattedAntennaOrRepeaterName({
            isMainAntenna: true,
            type: AppState.antenaGlobal?.type,
            nome: AppState.antenaGlobal?.nome,
            altura: AppState.antenaGlobal?.altura
        });
        } else {
            const rep = AppState.repetidoras.find((r) => r.id === closest.id);
            if (rep) {
            sourceFormattedName = getFormattedAntennaOrRepeaterName({
                isMainAntenna: false,
                type: rep.type,
                nome: rep.nome,
                altura: rep.altura
                });
            }
        }

        finalHtml = `${nomeBomba}<br><span class="source-name-pivo">${sourceFormattedName}</span><br><span class="distancia-pivo">${distanciaFormatada}</span>`;
        hasDistancia = true;
        labelWidth = Math.max(
            labelWidth,
            sourceFormattedName.length * 6.5 + 15,
            distanciaFormatada.length * 6.5 + 15
            );
        }
    }

    const labelHeight = hasDistancia ? 55 : 20;
    const labelBomba = L.marker([bomba.lat, bomba.lon], {
        icon: L.divIcon({
        className: "label-pivo",
        html: finalHtml,
        iconSize: [labelWidth, labelHeight],
        iconAnchor: [labelWidth / 2, -5]
        }),
        labelType: "bomba",
        interactive: false
    }).addTo(map);
    AppState.marcadoresLegenda.push(labelBomba);
    });

    updateLegendsVisibility();
}

// -----------------------
// Círculos/Setores/Pac-Man
// -----------------------
function drawCirculos(/* ciclosData */) {
    if (!map) return;

AppState.circulosPivos.forEach((c) => map.removeLayer(c));
AppState.circulosPivos = [];

AppState.lastPivosDataDrawn.forEach((pivo) => {
    const pivoCenterLatLng =
        pivo.circle_center_lat && pivo.circle_center_lon
            ? L.latLng(pivo.circle_center_lat, pivo.circle_center_lon)
            : L.latLng(pivo.lat, pivo.lon);

    if (pivo.tipo === "custom" && Array.isArray(pivo.coordenadas) && pivo.coordenadas.length > 0) {
        const polygon = L.polygon(pivo.coordenadas, {
        color: "#cc0000",
        weight: 3,
        opacity: 0.9,
        fillOpacity: 0,
        className: "circulo-custom-kmz"
        }).addTo(map);
        AppState.circulosPivos.push(polygon);
    } else if (pivo.tipo === "setorial") {
        const sectorCoords = generateSectorCoords(pivoCenterLatLng, pivo.raio, pivo.angulo_central, pivo.abertura_arco);
        const sectorPolygon = L.polygon(sectorCoords, {
        color: "#cc0000",
        weight: 3,
        opacity: 0.9,
        fillOpacity: 0,
        className: "circulo-pivo-setorial"
        }).addTo(map);
        AppState.circulosPivos.push(sectorPolygon);
    } else if (pivo.tipo === "pacman") {
        const pacmanCoords = generatePacmanCoords(pivoCenterLatLng, pivo.raio, pivo.angulo_inicio, pivo.angulo_fim);
        const pacmanPolygon = L.polygon(pacmanCoords, {
        color: "#cc0000",
        weight: 3,
        opacity: 0.9,
        fillOpacity: 0,
        className: "circulo-pivo-pacman"
        }).addTo(map);
        AppState.circulosPivos.push(pacmanPolygon);
    } else {
        const circle = L.circle(pivoCenterLatLng, {
        radius: pivo.raio || 100,
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

// -----------------------
// Overlays de imagem
// -----------------------
function drawImageOverlay(url, bounds, opacity = 1.0) {
    if (!map || !url || !bounds) return null;

    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const base = window.BACKEND_URL ?? (isLocal ? "http://localhost:8000" : "https://irricontrol-connect.onrender.com");
    const fullUrl = /^https?:/.test(url) ? url : `${base}${url}`;
    const south = Math.min(bounds[0], bounds[2]);
    const north = Math.max(bounds[0], bounds[2]);
    const west = Math.min(bounds[1], bounds[3]);
    const east = Math.max(bounds[1], bounds[3]);
    const imageBounds = [
        [south, west],
        [north, east]
    ];

    const overlay = L.imageOverlay(fullUrl, imageBounds, { opacity, interactive: false }).addTo(map);
    AppState.overlaysVisiveis.push(overlay);
    return overlay;
}

// -----------------------
// Painel de repetidoras
// -----------------------
function addRepetidoraNoPainel(repetidora) {
    const container = document.getElementById("lista-repetidoras");
    if (!container) return;

    const item = document.createElement("div");
    item.className = "flex justify-between items-center bg-gray-800/60 px-3 py-2 rounded-lg border border-white/10";
    item.id = `rep-item-${repetidora.id}`;

    const diagBtnHtml = `<button class="text-white/60 hover:text-sky-300 transition relative top-px" title="${t(
    "tooltips.run_diagnostic_from_source"
)}" data-id="${repetidora.id}" data-action="diagnostico">
    <span class="sidebar-icon w-4 h-4" style="-webkit-mask-image:url(assets/images/mountain.svg);mask-image:url(assets/images/mountain.svg);"></span>
    </button>`;

    item.innerHTML = `
    <span class="text-white/80 text-sm">${getFormattedAntennaOrRepeaterName(repetidora)}</span>
    <div class="flex gap-3 items-center">
        ${diagBtnHtml}
        <button class="text-white/60 hover:text-sky-300 transition" title="${t(
        "tooltips.show_hide_coverage"
        )}" data-id="${repetidora.id}" data-action="toggle-visibility" data-visible="true">
        <i data-lucide="eye" class="w-4 h-4 text-green-500"></i>
        </button>
        <button class="text-red-500 hover:text-red-400 text-xs font-bold transition" title="${t('ui.titles.remove_repeater')}" data-id="${repetidora.id}" data-action="remover">❌</button>
    </div>`;

    container.appendChild(item);
    lucide?.createIcons?.();

    repetidora.marker?.on("contextmenu", (e) => {
    L.DomEvent.stop(e);
    showRenameRepeaterMenu(repetidora.marker, repetidora.nome, false, repetidora.id);
});

    item.querySelector('[data-action="diagnostico"]')?.addEventListener("click", () => runTargetedDiagnostic?.(repetidora));

    item.querySelector('[data-action="remover"]')?.addEventListener("click", () => {
    if (repetidora.marker) map.removeLayer(repetidora.marker);
    if (repetidora.overlay) map.removeLayer(repetidora.overlay);
    if (repetidora.label) map.removeLayer(repetidora.label);
    container.removeChild(item);

    AppState.idsDisponiveis.push(repetidora.id);
    AppState.idsDisponiveis.sort((a, b) => a - b);
    AppState.repetidoras = AppState.repetidoras.filter((r) => r.id !== repetidora.id);
    AppState.overlaysVisiveis = AppState.overlaysVisiveis.filter((o) => o !== repetidora.overlay);
    AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter((l) => l !== repetidora.label);

    if (typeof atualizarPainelDados === "function") atualizarPainelDados();
    setTimeout(() => {
        reavaliarPivosViaAPI?.();
        updateDownloadActivePngsButtonState?.();
    }, 100);
});

    const visibilityBtn = item.querySelector('[data-action="toggle-visibility"]');
    visibilityBtn?.addEventListener("click", () => {
    const isVisible = visibilityBtn.getAttribute("data-visible") === "true";
    const newState = !isVisible;
    visibilityBtn.setAttribute("data-visible", String(newState));

    const opacityValue = parseFloat(document.getElementById("range-opacidade").value);
    if (repetidora.overlay) repetidora.overlay.setOpacity(newState ? opacityValue : 0);

    visibilityBtn.innerHTML = newState
        ? `<i data-lucide="eye" class="w-4 h-4 text-green-500"></i>`
        : `<i data-lucide="eye-off" class="w-4 h-4 text-gray-500"></i>`;
    lucide?.createIcons?.();

    setTimeout(() => {
        reavaliarPivosViaAPI?.();
        updateDownloadActivePngsButtonState?.();
    }, 100);
    });
}

function addAntenaAoPainel(antena) {
    // Garante que o item antigo seja removido antes de adicionar um novo
    document.getElementById("antena-item")?.remove();

    const container = document.getElementById("lista-repetidoras");
    if (!container) return;

    const item = document.createElement("div");
    item.className = "flex justify-between items-center bg-gray-800/60 px-3 py-2 rounded-lg border border-white/10";
    item.id = "antena-item";

    const diagBtnHtml = `<button class="text-white/60 hover:text-sky-300 transition relative top-px" title="${t(
    "tooltips.run_diagnostic_from_source"
)}" data-action="diagnostico">
    <span class="sidebar-icon w-4 h-4" style="-webkit-mask-image:url(assets/images/mountain.svg);mask-image:url(assets/images/mountain.svg);"></span>
</button>`;

    // <<< ALTERAÇÃO AQUI: Adicionado o botão de remover (X) >>>
    item.innerHTML = `
    <span class="text-white/80 text-sm">${getFormattedAntennaOrRepeaterName(antena)}</span>
    <div class="flex gap-3 items-center">
        ${diagBtnHtml}
        <button class="text-white/60 hover:text-sky-300 transition" title="${t("tooltips.show_hide_coverage")}" data-action="toggle-visibility" data-visible="true">
            <i data-lucide="eye" class="w-4 h-4 text-green-500"></i>
        </button>
        <button class="text-red-500 hover:text-red-400 text-xs font-bold transition" title="${t('ui.titles.remove_repeater')}" data-action="remover">❌</button>
    </div>`;

    container.firstChild ? container.insertBefore(item, container.firstChild) : container.appendChild(item);
    lucide?.createIcons?.();

    // Adiciona os listeners para os botões de ação
    item.querySelector('[data-action="diagnostico"]')?.addEventListener("click", () => runTargetedDiagnostic?.(antena));
    item.querySelector('[data-action="remover"]')?.addEventListener('click', () => handleDeleteMainStudy()); // Chama a função para apagar

    const visibilityBtn = item.querySelector('[data-action="toggle-visibility"]');
    visibilityBtn?.addEventListener("click", () => {
        const isVisible = visibilityBtn.getAttribute("data-visible") === "true";
        const newState = !isVisible;
        visibilityBtn.setAttribute("data-visible", String(newState));
        const opacityValue = parseFloat(document.getElementById("range-opacidade").value);
        if (antena?.overlay) antena.overlay.setOpacity(newState ? opacityValue : 0);
        visibilityBtn.innerHTML = newState ? `<i data-lucide="eye" class="w-4 h-4 text-green-500"></i>` : `<i data-lucide="eye-off" class="w-4 h-4 text-gray-500"></i>`;
        lucide?.createIcons?.();
        setTimeout(() => reavaliarPivosViaAPI?.(), 100);
    });
}

// -----------------------
// Diagnóstico de visada
// -----------------------
function criarGradienteVisada(id = "gradient-visada") {
    const svgPane = map.getPane("overlayPane");
    let svg = svgPane.querySelector("svg");
    if (!svg) {
    const temp = L.polyline([[0, 0], [0, 0]]).addTo(map);
    svg = svgPane.querySelector("svg");
    map.removeLayer(temp);
    if (!svg) return;
}
    if (svg.querySelector(`#${id}`)) return;

let defs = svg.querySelector("defs");
    if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
}
    const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradient.setAttribute("id", id);
    gradient.setAttribute("gradientUnits", "userSpaceOnUse");
    gradient.innerHTML =
    `<stop offset="0%" stop-color="green"/><stop offset="50%" stop-color="yellow"/><stop offset="100%" stop-color="red"/>`;
    defs.appendChild(gradient);
}

function drawVisadaComGradiente(pontoA, pontoB) {

    const linha = L.polyline([pontoA, pontoB], {
        color: 'yellow',
        weight: 2,
        opacity: AppState.visadaVisivel ? 1 : 0,
        dashArray: "8 8"
    }).addTo(AppState.visadaLayerGroup);

    return linha;
}

function drawDiagnostico(latlonOrigem, latlonDestino, dadosBloqueioAPI, dadosPontoMaisAlto, nomeDiagnostico, distanciaFormatada = null, fullProfileData = null, analysisPayload = null, featuresToDraw = null) {
    if (!map || !AppState.visadaLayerGroup) return;

    const linha = drawVisadaComGradiente(latlonOrigem, latlonDestino);
    const estaBloqueado = dadosBloqueioAPI?.diff > 0.1;

    let iconUrl, iconSize, mensagemTooltip, markerLatLng, tooltipColor;

    if (estaBloqueado) {
        iconUrl = ATTENTION_ICON_PATH;
        iconSize = [24, 24];
        markerLatLng = [dadosBloqueioAPI.lat, dadosBloqueioAPI.lon];
        mensagemTooltip = `<strong>${nomeDiagnostico}</strong>`;
        if (distanciaFormatada) mensagemTooltip += `<br>${t("ui.labels.pivo_distance_label")} ${distanciaFormatada}`;
        mensagemTooltip += `<br>${t("tooltips.blockage_point", { elevation: dadosBloqueioAPI.elev.toFixed(1) })}`;
        tooltipColor = "#FF9800";
        mensagemTooltip += `<br><span style="color:${tooltipColor};">${t("tooltips.blockage_present", { diff: dadosBloqueioAPI.diff.toFixed(1) })}</span>`;
    } else {
        iconUrl = MOUNTAIN_ICON_PATH;
        iconSize = [22, 22];
        markerLatLng = [dadosPontoMaisAlto.lat, dadosPontoMaisAlto.lon];
        mensagemTooltip = `<strong>${nomeDiagnostico}</strong>`;
        if (distanciaFormatada) mensagemTooltip += `<br>${t("ui.labels.pivo_distance_label")} ${distanciaFormatada}`;
        tooltipColor = "#FF9800";
        mensagemTooltip += `<br><span style="color:${tooltipColor};">${t("tooltips.highest_point_short", { elevation: dadosPontoMaisAlto.elev.toFixed(1) })}</span>`;
    }

    if (markerLatLng?.[0] && markerLatLng?.[1]) {
        const markerIcon = L.divIcon({
            className: "label-bloqueio-dinamico blockage-icon-button",
            html: `<img src="${iconUrl}" style="width:${iconSize[0]}px;height:${iconSize[1]}px;">`,
            iconSize,
            iconAnchor: [iconSize[0] / 2, iconSize[1] / 2]
        });

        const marker = L.marker(markerLatLng, { icon: markerIcon })
            .addTo(AppState.visadaLayerGroup)
            .bindTooltip(mensagemTooltip, {
                permanent: false,
                direction: "top",
                className: "tooltip-sinal tooltip-visada-diagnostico",
                offset: [0, -(iconSize[1] / 2 + 5)]
            });
        
        // CORREÇÃO: O evento de clique agora também passa os 'featuresToDraw'
        marker.on('click', () => {
            if (fullProfileData && analysisPayload && window.Analysis3D) {
                window.Analysis3D.show(fullProfileData, analysisPayload.altura_antena, analysisPayload.altura_receiver, featuresToDraw);
            } else {
                console.warn("Dados do perfil de elevação não disponíveis para este ícone.");
            }
        });

        AppState.marcadoresBloqueio?.push?.(marker);
    }

    AppState.linhasDiagnostico?.push?.(linha);
}

// -----------------------
// Limpar camadas
// -----------------------
function clearMapLayers() {
    if (!map) return;

    const layersAndGroups = [
    AppState.marcadorAntena,
    AppState.antenaCandidatesLayerGroup,
    AppState.marcadorPosicionamento,
    AppState.visadaLayerGroup,
    window.candidateRepeaterSitesLayerGroup,
    ...(AppState.marcadoresPivos || []),
    ...(AppState.circulosPivos || []),
    ...(AppState.marcadoresBombas || []),
    ...(AppState.marcadoresLegenda || []),
    ...Object.values(AppState.pivotsMap || {})
];

layersAndGroups.forEach((layer) => {
    if (!layer) return;
    if (typeof layer.clearLayers === "function") {
        layer.clearLayers();
    } else if (map.hasLayer(layer)) {
        map.removeLayer(layer);
    }
});

AppState.repetidoras.forEach((r) => {
    if (r.marker) map.removeLayer(r.marker);
    if (r.overlay) map.removeLayer(r.overlay);
    if (r.label) map.removeLayer(r.label);
    });
    if (AppState.antenaGlobal?.overlay) map.removeLayer(AppState.antenaGlobal.overlay);
}

// -----------------------
// Legendas & opacidade
// -----------------------
function updateLegendsVisibility() {
    if (!Array.isArray(AppState.marcadoresLegenda)) return;

    AppState.marcadoresLegenda.forEach((marker) => {
        const el = marker.getElement?.();
        if (!el) return;

        const type = marker.options.labelType;
        let show = false;

        // Determina se a legenda específica deve ser mostrada com base no estado global
        if (type === "pivot" || type === "bomba") {
            show = AppState.legendasAtivas;
        } else if (type === "antena" || type === "repetidora" || type === "antena_candidate") {
            show = AppState.antenaLegendasAtivas;
        }

        // Lógica unificada e corrigida: usa apenas a propriedade 'display'.
        // Isso garante que as legendas fiquem totalmente visíveis ou totalmente ocultas.
        el.style.display = show ? "" : "none";
    });
}

function updateOverlaysOpacity(opacityValue) {
    const isPanelItemVisible = (overlay) => {
    let visibilityBtn = null;
    if (AppState.antenaGlobal?.overlay === overlay) {
        visibilityBtn = document.querySelector("#antena-item button[data-visible]");
    } else {
        const rep = AppState.repetidoras.find((r) => r.overlay === overlay);
        if (rep) visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
    }
    return !visibilityBtn || visibilityBtn.getAttribute("data-visible") === "true";
};

AppState.overlaysVisiveis.forEach((overlay) => {
    if (map.hasLayer(overlay)) {
        overlay.setOpacity(isPanelItemVisible(overlay) ? opacityValue : 0);
    }
});
}

// -----------------------
// Candidatos de repetidora (AI)
// -----------------------
function drawCandidateRepeaterSites(sites, targetPivotData) {
    if (!window.candidateRepeaterSitesLayerGroup) {
        window.candidateRepeaterSitesLayerGroup = L.layerGroup().addTo(map);
    }
    window.candidateRepeaterSitesLayerGroup.clearLayers();

    if (!Array.isArray(sites) || sites.length === 0) return;

    sites.forEach((site) => {
        if (typeof site.lat === "undefined") return;

        const siteLatLng = [site.lat, site.lon];

        const circleIcon = L.divIcon({
            className: 'suggestion-marker-dot',
            iconSize: [12, 12]
        });

        const marker = L.marker(siteLatLng, {
            icon: circleIcon
        });

        const statusText = t(site.has_los ? 'tooltips.los_ok' : 'tooltips.los_no');
        const statusColor = site.has_los ? '#22c55e' : '#FF9800';
        const distanceLabel = t('ui.labels.pivo_distance_label');
        const tooltipContent = `
        <div class="suggestion-tooltip-content">
            <div class="tooltip-elevation">${site.elevation?.toFixed(1) || 'N/A'}m</div>
            <div class="tooltip-status" style="color: ${statusColor};">${statusText}</div>
            <div class="tooltip-distance">
                ${distanceLabel} ${site.distance_to_target ? site.distance_to_target.toFixed(0) + 'm' : 'N/A'}
            </div>
        </div>
        `;

        marker.bindTooltip(tooltipContent, {
            direction: 'top',
            offset: [0, -10],
            permanent: false,
            className: 'suggestion-tooltip'
        });
        
        marker.addTo(window.candidateRepeaterSitesLayerGroup);
    });
}

function togglePivoDistances(show) {
    if (AppState.lastPivosDataDrawn?.length > 0) drawPivos(AppState.lastPivosDataDrawn, false);
    if (AppState.lastBombasDataDrawn?.length > 0) drawBombas(AppState.lastBombasDataDrawn);
    const key = show ? "messages.success.pivot_distances_shown" : "messages.success.pivot_distances_hidden";
    if (typeof mostrarMensagem === "function") mostrarMensagem(t(key), "sucesso");
}

// -----------------------
// Desenhos temporários
// -----------------------
function drawTempCircle(center, radiusPoint) {
    const radius = center.distanceTo(radiusPoint);
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
    if (tempCircle) {
    map.removeLayer(tempCircle);
    tempCircle = null;
}
}

function generateCircleCoords(center, radius, points = 128) {
    const coords = [];
    const earthRadius = 6378137;
    const lat = center.lat * (Math.PI / 180);
    const lon = center.lng * (Math.PI / 180);

    for (let i = 0; i < points; i++) {
    const bearing = (i / points) * 360 * (Math.PI / 180);
    const newLat =
        Math.asin(
        Math.sin(lat) * Math.cos(radius / earthRadius) +
        Math.cos(lat) * Math.sin(radius / earthRadius) * Math.cos(bearing)
    );
    const newLon =
        lon +
        Math.atan2(
        Math.sin(bearing) * Math.sin(radius / earthRadius) * Math.cos(lat),
        Math.cos(radius / earthRadius) - Math.sin(lat) * Math.sin(newLat)
    );
    coords.push([newLat * (180 / Math.PI), newLon * (180 / Math.PI)]);
    }
    coords.push(coords[0]);
    return coords;
}

function drawTempSector(center, currentPoint) {
    const radius = center.distanceTo(currentPoint);
    if (radius < 5) return;

    const bearing = calculateBearing(center, currentPoint);
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
    if (tempSectorShape) {
    map.removeLayer(tempSectorShape);
    tempSectorShape = null;
}
}

function calculateBearing(p1, p2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
    const lat1 = toRad(p1.lat);
    const lon1 = toRad(p1.lng);
    const lat2 = toRad(p2.lat);
    const lon2 = toRad(p2.lng);
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function generateSectorCoords(center, radius, mainAngle, arcAngle = 180) {
    const vertices = [[center.lat, center.lng]];
    const startAngle = mainAngle - arcAngle / 2;
    const points = 40;
    for (let i = 0; i <= points; i++) {
    const angle = startAngle + (i * arcAngle) / points;
    const point = L.latLng(center).destination(radius, angle);
    vertices.push([point.lat, point.lng]);
}
    return vertices;
}

// extensão de destino geodésico
    if (!L.LatLng.prototype.destination) {
L.LatLng.prototype.destination = function (distance, bearing) {
    const R = 6378137;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const brng = toRad(bearing);
    const lat1 = toRad(this.lat);
    const lon1 = toRad(this.lng);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance / R) + Math.cos(lat1) * Math.sin(distance / R) * Math.cos(brng)
    );
    const lon2 =
        lon1 +
        Math.atan2(
        Math.sin(brng) * Math.sin(distance / R) * Math.cos(lat1),
        Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
    );
    return L.latLng(toDeg(lat2), toDeg(lon2));
};
}

function generatePacmanCoords(center, radius, startAngle, endAngle, points = 80) {
    let aStart = startAngle;
    let aEnd = endAngle;
    if (aEnd <= aStart) aEnd += 360;

    const vertices = [[center.lat, center.lng]];
    const arcAngle = aEnd - aStart;
    const irrigatedAngle = 360 - arcAngle;

for (let i = 0; i <= points; i++) {
    const angle = aEnd + (i * irrigatedAngle) / points;
    const point = center.destination(radius, angle);
    vertices.push([point.lat, point.lng]);
}
vertices.push([center.lat, center.lng]);
return vertices;
}

function drawTempPacman(center, radiusPoint, currentMousePoint) {
if (tempPacmanShape) {
    map.removeLayer(tempPacmanShape);
    tempPacmanShape = null;
}

if (!radiusPoint) {
    const radius = center.distanceTo(currentMousePoint);
    if (radius > 5) {
    tempPacmanShape = L.circle(center, {
        radius,
        color: "#D97706",
        weight: 3,
        dashArray: "5, 5",
        fillColor: "#D97706",
        fillOpacity: 0.1,
        interactive: false
    }).addTo(map);
    }
} else {
    const radius = center.distanceTo(radiusPoint);
    const startAngle = calculateBearing(center, radiusPoint);
    const endAngle = calculateBearing(center, currentMousePoint);
    const coords = generatePacmanCoords(center, radius, startAngle, endAngle);

    tempPacmanShape = L.polygon(coords, {
        color: "#D97706",
        weight: 3,
        dashArray: "8, 8",
        fillColor: "#D97706",
        fillOpacity: 0.2,
        interactive: false
    }).addTo(map);
}
}

function removeTempPacman() {
    if (tempPacmanShape) {
    map.removeLayer(tempPacmanShape);
    tempPacmanShape = null;
}
}

// ------------------------------------
// Exporta funções no escopo global
// ------------------------------------
window.updatePivotIcons = updatePivotIcons;
window.findClosestSignalSource = findClosestSignalSource;
window.getFormattedAntennaOrRepeaterName = getFormattedAntennaOrRepeaterName;
window.showRenameRepeaterMenu = showRenameRepeaterMenu;
window.removeRenameMenu = removeRenameMenu;
window.drawAntenaCandidates = drawAntenaCandidates;
window.drawPivos = drawPivos;
window.updateAntenaOrRepeaterLabel = updateAntenaOrRepeaterLabel;
window.drawBombas = drawBombas;
window.drawCirculos = drawCirculos;
window.drawImageOverlay = drawImageOverlay;
window.addRepetidoraNoPainel = addRepetidoraNoPainel;
window.addAntenaAoPainel = addAntenaAoPainel;
window.drawDiagnostico = drawDiagnostico;
window.clearMapLayers = clearMapLayers;
window.updateLegendsVisibility = updateLegendsVisibility;
window.updateOverlaysOpacity = updateOverlaysOpacity;
window.drawCandidateRepeaterSites = drawCandidateRepeaterSites;
window.togglePivoDistances = togglePivoDistances;
window.drawTempCircle = drawTempCircle;
window.removeTempCircle = removeTempCircle;
window.drawTempSector = drawTempSector;
window.removeTempSector = removeTempSector;
window.drawTempPacman = drawTempPacman;
window.removeTempPacman = removeTempPacman;
window.criarGradienteVisada = criarGradienteVisada;
