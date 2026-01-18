// assets/js/main.js

const AppState = {
    // --- Estado da Sessão e Dados ---
    jobId: null,
    currentProcessedKmzData: null,
    antenaGlobal: null,
    lastPivosDataDrawn: [],
    lastBombasDataDrawn: [],
    ciclosGlobais: [],
    repetidoras: [],

    // --- Estado da UI e Modos de Interação ---
    modoEdicaoPivos: false,
    modoLoSPivotAPivot: false,
    modoBuscaLocalRepetidora: false,
    modoDesenhoPivo: false,
    modoDesenhoPivoSetorial: false,
    modoDesenhoPivoPacman: false,
    modoDesenhoIrripump: false,
    modoMoverPivoSemCirculo: false,
    pontoRaioTemporario: null,
    distanciasPivosVisiveis: false,
    legendasAtivas: true,
    antenaLegendasAtivas: true,
    clickedCandidateData: null,
    ultimoCliqueFoiSobrePivo: false,
    visadaVisivel: false,

    // --- Variáveis de Apoio e Temporárias ---
    coordenadaClicada: null,
    marcadorPosicionamento: null,
    backupPosicoesPivos: {},
    historyStack: [],
    losSourcePivot: null,
    losTargetPivot: null,
    pivoAlvoParaLocalRepetidora: null,
    templateSelecionado: "",
    centroPivoTemporario: null,
    isDrawingSector: false,

    // --- Referências a Camadas do Mapa (Leaflet) ---
    selectedPivoNome: null,
    selectedSpecialMarker: null,
    marcadorAntena: null,
    marcadoresPivos: [],
    circulosPivos: [],
    pivotsMap: {},
    contadorRepetidoras: 0,
    idsDisponiveis: [],
    marcadoresLegenda: [],
    marcadoresBombas: [],
    posicoesEditadas: {},
    overlaysVisiveis: [],
    linhasDiagnostico: [],
    marcadoresBloqueio: [],

    setJobId(id) {
        this.jobId = id;
        console.log(`SESSION_INFO: Novo Job ID definido: ${this.jobId}`);
    },

    reset() {
        console.log("🔄 Resetando o estado da aplicação...");
        this.jobId = null;
        this.currentProcessedKmzData = null;
        this.antenaGlobal = null;
        this.lastPivosDataDrawn = [];
        this.lastBombasDataDrawn = [];
        this.ciclosGlobais = [];
        this.repetidoras = [];
        this.modoEdicaoPivos = false;
        this.modoLoSPivotAPivot = false;
        this.modoBuscaLocalRepetidora = false;
        this.modoDesenhoPivo = false;
        this.modoDesenhoPivoSetorial = false;
        this.distanciasPivosVisiveis = false;
        this.legendasAtivas = true;
        this.antenaLegendasAtivas = true;
        this.visadaVisivel = false;
        this.clickedCandidateData = null;
        this.ultimoCliqueFoiSobrePivo = false;
        this.coordenadaClicada = null;
        this.marcadorPosicionamento = null;
        this.backupPosicoesPivos = {};
        this.historyStack = [];
        this.losSourcePivot = null;
        this.losTargetPivot = null;
        this.pivoAlvoParaLocalRepetidora = null;
        this.templateSelecionado = "";
        this.centroPivoTemporario = null;
        this.isDrawingSector = false;
        this.marcadorAntena = null;
        this.marcadoresPivos = [];
        this.circulosPivos = [];
        this.pivotsMap = {};
        this.contadorRepetidoras = 0;
        this.idsDisponiveis = [];
        this.marcadoresLegenda = [];
        this.marcadoresBombas = [];
        this.posicoesEditadas = {};
        this.overlaysVisiveis = [];
        this.linhasDiagnostico = [];
        this.marcadoresBloqueio = [];
        this.modoDesenhoPivoPacman = false;
        this.modoDesenhoIrripump = false;
        this.pontoRaioTemporario = null;
        this.selectedPivoNome = null;
        this.selectedSpecialMarker = null;
    }
};


// --- Inicialização ---

/**
 * Desativa todos os modos de interação ativos. Essencial para garantir que apenas um modo
 * esteja ativo por vez, prevenindo comportamentos conflitantes.
 */
function deactivateAllModes() {
    if (AppState.modoDesenhoPivo) toggleModoDesenhoPivo();
    if (AppState.modoDesenhoPivoSetorial) toggleModoDesenhoPivoSetorial();
    if (AppState.modoDesenhoPivoPacman) toggleModoDesenhoPivoPacman();
    if (AppState.modoDesenhoIrripump) toggleModoDesenhoIrripump();
    if (AppState.modoEdicaoPivos) togglePivoEditing();
    if (AppState.modoLoSPivotAPivot) toggleLoSPivotAPivotMode();
    if (AppState.modoBuscaLocalRepetidora) handleBuscarLocaisRepetidoraActivation();
}

document.addEventListener("DOMContentLoaded", async () => {
  // ✅ Se não tiver token, NÃO inicia nada.
    if (!window.Auth?.getToken?.()) {
    console.log("🔒 Sem token: aguardando login para iniciar a plataforma...");
    return;
}

    await initApp();
});

// ✅ quando logar, inicializa
window.addEventListener("auth:login", async () => {
    console.log("✅ Login OK: iniciando plataforma...");
    await initApp();
}, { once: true });

async function initApp() {
    console.log("DOM Carregado. Iniciando Aplicação...");

    const savedLang = localStorage.getItem('preferredLanguage') || 'pt-br';
    await setLanguage(savedLang);

    initMap();
    setupUIEventListeners();
    setupMainActionListeners();
    await loadAndPopulateTemplates();

    lucide?.createIcons?.();

    await handleResetClick(false);

    updateActionButtonsI18n();
    document.addEventListener("i18n:applied", () => {
        updateActionButtonsI18n();
    });

    console.log("Aplicação Pronta.");
    }


/**
 * Controla o estado (habilitado/desabilitado) e o tooltip do botão de exportar PDF.
 * @param {boolean} isUnlocked - True para habilitar o botão, false para desabilitar.
 */
function updatePdfButtonState(isUnlocked) {
    const exportarPdfBtn = document.getElementById('exportar-pdf-btn');
    if (!exportarPdfBtn) return;

    exportarPdfBtn.disabled = !isUnlocked;

    if (isUnlocked) {
        const tooltipText = t('tooltips.export_pdf_report');
        exportarPdfBtn.title = tooltipText;
        exportarPdfBtn.setAttribute('aria-label', t('ui.buttons.export_pdf_report'));
    } else {
        const tooltipText = t('tooltips.export_pdf_disabled');
        exportarPdfBtn.title = tooltipText;
        exportarPdfBtn.setAttribute('aria-label', tooltipText);
    }
}

async function startNewSession() {
    mostrarLoader(true);
    try {
        const data = await startEmptyJob();
        if (!data.job_id) {
            throw new Error("A resposta do servidor não incluiu um ID de job.");
        }
        AppState.setJobId(data.job_id);
        if (AppState.jobId) {
            mostrarMensagem(t('messages.success.new_session_started'), "sucesso");
        }

        AppState.currentProcessedKmzData = { antenas: [], pivos: [], ciclos: [], bombas: [] };

    } catch (error) {
        console.error("❌ Falha crítica ao iniciar nova sessão:", error);
        mostrarMensagem(t('messages.errors.session_start_fail'), "erro");
        AppState.setJobId(null);
    } finally {
        mostrarLoader(false);
    }
}

// --- Listeners Principais ---

function setupMainActionListeners() {
    document.getElementById('arquivo')?.addEventListener('change', handleKmzFileSelect);
    document.getElementById('resetar-btn')?.addEventListener('click', () => handleResetClick(true));
    document.getElementById('exportar-btn')?.addEventListener('click', handleExportClick);
    document.getElementById('exportar-pdf-btn')?.addEventListener('click', handleExportPdfReportClick);
    document.getElementById('confirmar-repetidora')?.addEventListener('click', handleConfirmRepetidoraClick);
    document.getElementById('btn-download-active-pngs')?.addEventListener('click', handleDownloadActivePngsClick);
    document.getElementById('btn-los-pivot-a-pivot')?.addEventListener('click', toggleLoSPivotAPivotMode);
    document.getElementById('btn-buscar-locais-repetidora')?.addEventListener('click', handleBuscarLocaisRepetidoraActivation);
    document.getElementById('coord-search-btn')?.addEventListener('click', handleCoordinateSearch);
    document.getElementById('btn-draw-pivot-pacman')?.addEventListener('click', toggleModoDesenhoPivoPacman);
    document.getElementById('btn-draw-irripump')?.addEventListener('click', toggleModoDesenhoIrripump);
    document.getElementById('btn-mover-pivo-sem-circulo')?.addEventListener('click', toggleModoMoverPivoSemCirculo);

    map?.on("click", handleMapClick);
    map?.on("contextmenu", handleCancelDraw);

    document.addEventListener('keydown', handleGlobalKeys);
    document.getElementById('btn-draw-pivot')?.addEventListener('click', toggleModoDesenhoPivo);
    document.getElementById('btn-draw-pivot-setorial')?.addEventListener('click', toggleModoDesenhoPivoSetorial);

    const toggleDistanciasBtn = document.getElementById('toggle-distancias-pivos');
    if (toggleDistanciasBtn) {
        toggleDistanciasBtn.addEventListener('click', handleToggleDistanciasPivos);
    }
}

/**
 * Abre o painel para o usuário reconfigurar os parâmetros da antena principal.
 */
function handleReconfigMainStudy() {
    map.closePopup(); // Closes the popup

    // Opens the side panel and populates it with the current data
    const painelRepetidora = document.getElementById("painel-repetidora");
    const inputAltura = document.getElementById("altura-antena-rep");
    const inputAlturaRx = document.getElementById("altura-receiver-rep");

    if (AppState.antenaGlobal) {
        inputAltura.value = AppState.antenaGlobal.altura;
        inputAlturaRx.value = AppState.antenaGlobal.altura_receiver;

        // Saves the data so the "Simulate" button knows which antenna is being reconfigured
        AppState.clickedCandidateData = AppState.antenaGlobal;
        AppState.coordenadaClicada = L.latLng(AppState.antenaGlobal.lat, AppState.antenaGlobal.lon);

        painelRepetidora.classList.remove("hidden");
    }
}

/**
 * Removes the main antenna's study, reverting it to a "candidate".
 */
async function handleDeleteMainStudy() {
    map.closePopup();

    if (!AppState.antenaGlobal) return;
    const antenaOriginalData = AppState.currentProcessedKmzData?.antenas.find(
        a => a.lat === AppState.antenaGlobal.lat && a.lon === AppState.antenaGlobal.lon
    );

    if (AppState.marcadorAntena) map.removeLayer(AppState.marcadorAntena);
    if (AppState.antenaGlobal.overlay) map.removeLayer(AppState.antenaGlobal.overlay);
    if (AppState.antenaGlobal.label) map.removeLayer(AppState.antenaGlobal.label);
    document.getElementById("antena-item")?.remove();
    
    AppState.overlaysVisiveis = AppState.overlaysVisiveis.filter(o => o !== AppState.antenaGlobal.overlay);
    AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter(l => l !== AppState.antenaGlobal.label);
    AppState.antenaGlobal = null;
    AppState.marcadorAntena = null;

    if (antenaOriginalData) {
        drawAntenaCandidates([antenaOriginalData]);
    }

    await reavaliarPivosViaAPI();
    atualizarPainelDados();
    updatePdfButtonState(false);
    updateDownloadActivePngsButtonState();
    mostrarMensagem(t('messages.success.main_study_removed'), "info");
}

// --- Handlers de Ações ---
async function handleKmzFileSelect(event) {
    const fileInput = event.target;
    if (!fileInput.files || fileInput.files.length === 0) {
        return;
    }
    const file = fileInput.files[0];

    const nomeArquivoLabel = document.getElementById('nome-arquivo-label');
    if (nomeArquivoLabel) {
        const nome = file.name || t('ui.labels.choose_kmz');
        nomeArquivoLabel.textContent = nome;
        if (nomeArquivoLabel.hasAttribute('title')) {
            nomeArquivoLabel.removeAttribute('title');
        }
        const importLabel = document.querySelector('label[for="arquivo"]');
        if (importLabel) {
            importLabel.setAttribute('title', nome);
        }
    }

    mostrarLoader(true);
    const formData = new FormData();
    formData.append("file", file);

    const currentLanguage = localStorage.getItem('preferredLanguage') || 'pt-br';
    formData.append("language", currentLanguage);

    try {
        await handleResetClick(false);

        // Mantém o loader ativo durante o processamento pesado do KMZ
        mostrarLoader(true);

        const data = await processKmz(formData);
        console.log("✅ KMZ Processado:", data);

        if (!data.job_id) {
            throw new Error("A resposta do servidor não incluiu um ID de job.");
        }

        AppState.setJobId(data.job_id);
        AppState.currentProcessedKmzData = JSON.parse(JSON.stringify(data));

        if (data.pivos && data.ciclos) {
            data.pivos.forEach(pivo => {
                if (pivo.tipo === 'custom' && Array.isArray(pivo.coordenadas) && pivo.coordenadas.length > 0) {
                    return;
                }
                const nomeCicloEsperado = `Ciclo ${pivo.nome}`;
                const cicloCorrespondente = data.ciclos.find(c => c.nome_original_circulo === nomeCicloEsperado);

                if (cicloCorrespondente && Array.isArray(cicloCorrespondente.coordenadas) && cicloCorrespondente.coordenadas.length > 0) {
                    pivo.tipo = 'custom';
                    pivo.coordenadas = cicloCorrespondente.coordenadas;

                    const bounds = L.polygon(cicloCorrespondente.coordenadas).getBounds();
                    const centro = bounds.getCenter();
                    const pontoNorte = L.latLng(bounds.getNorth(), centro.lng);
                    pivo.raio = centro.distanceTo(pontoNorte);
                }
            });
        }

        AppState.antenaGlobal = null;
        const antenasCandidatas = data.antenas || [];
        const bombasParaDesenhar = data.bombas || [];
        const pivosParaDesenhar = data.pivos || [];
        const pivosComStatusInicial = pivosParaDesenhar.map(p => ({
            ...p,
            fora: true,
            circle_center_lat: p.lat,
            circle_center_lon: p.lon
        }));

        AppState.lastPivosDataDrawn = JSON.parse(JSON.stringify(pivosComStatusInicial));
        AppState.lastBombasDataDrawn = JSON.parse(JSON.stringify(bombasParaDesenhar));
        AppState.ciclosGlobais = data.ciclos || [];

        drawAntenaCandidates(antenasCandidatas);
        drawBombas(AppState.lastBombasDataDrawn);
        drawPivos(AppState.lastPivosDataDrawn);
        drawCirculos();

        if (antenasCandidatas.length > 0) {
            mostrarMensagem(t('messages.success.kmz_loaded_select_tower'), "sucesso");
        } else {
            mostrarMensagem(t('messages.info.no_towers_found'), "info");
        }

        document.getElementById("simular-btn")?.classList.add("hidden");

        if (pivosParaDesenhar.length > 0 || antenasCandidatas.length > 0) {
            const boundsToFit = [];
            pivosParaDesenhar.forEach(p => boundsToFit.push([p.lat, p.lon]));
            antenasCandidatas.forEach(a => boundsToFit.push([a.lat, a.lon]));
            if (boundsToFit.length > 0) {
                map.fitBounds(boundsToFit, { padding: [50, 50] });
            }
            updatePivotIcons();
        }

        atualizarPainelDados();
        document.getElementById("painel-dados")?.classList.remove("hidden");
        document.getElementById("painel-repetidoras")?.classList.remove("hidden");
        reposicionarPaineisLaterais();
        expandAllPanels();

    } catch (error) {
        console.error("❌ Erro no submit do formulário:", error);
        mostrarMensagem(t('messages.errors.kmz_load_fail', { error: error.message }), "erro");
        updatePdfButtonState(false);
        await startNewSession();
    } finally {
        mostrarLoader(false);
        fileInput.value = '';
    }
}

async function startMainSimulation(antenaData) {
    if (!antenaData || !AppState.jobId) {
        mostrarMensagem(t('messages.errors.invalid_data_or_session'), "erro");
        return;
    }

    mostrarLoader(true);
    map?.closePopup();

    try {
        if (AppState.antenaGlobal) {
            if (AppState.antenaGlobal.overlay) map.removeLayer(AppState.antenaGlobal.overlay);
            if (AppState.antenaGlobal.label) map.removeLayer(AppState.antenaGlobal.label);
            AppState.overlaysVisiveis = AppState.overlaysVisiveis.filter(o => o !== AppState.antenaGlobal.overlay);
            AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter(l => l !== AppState.antenaGlobal.label);
        }
        if (AppState.marcadorAntena) map.removeLayer(AppState.marcadorAntena);

        AppState.templateSelecionado = document.getElementById('template-modelo').value;
        const pivos_atuais = (AppState.lastPivosDataDrawn || []).map(p => ({ nome: p.nome, lat: p.lat, lon: p.lon, type: 'pivo' }));
        const bombas_atuais = (AppState.lastBombasDataDrawn || []).map(b => ({ nome: b.nome, lat: b.lat, lon: b.lon, type: 'bomba' }));

        const payload = { job_id: AppState.jobId, ...antenaData, pivos_atuais, bombas_atuais, template: AppState.templateSelecionado };
        const data = await simulateSignal(payload);

        if (AppState.antenaCandidatesLayerGroup) {
            const idParaRemover = `candidate-${antenaData.nome}-${antenaData.lat}`;
            const camadasParaRemover = [];
            AppState.antenaCandidatesLayerGroup.eachLayer(layer => { if (layer.options.customId === idParaRemover) camadasParaRemover.push(layer); });
            camadasParaRemover.forEach(layer => AppState.antenaCandidatesLayerGroup.removeLayer(layer));
            AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter(l => l.options.customId !== idParaRemover);
        }

        const nomeImagem = data.imagem_salva ? data.imagem_salva.split('/').pop() : null;
        
        AppState.antenaGlobal = { 
            ...antenaData, 
            overlay: drawImageOverlay(data.imagem_salva, data.bounds), 
            bounds: data.bounds, 
            imagem_filename: nomeImagem,
            type: antenaData.type || 'default', 
            original_name: antenaData.nome, 
            is_from_kmz: true, 
            had_height_in_kmz: antenaData.had_height_in_kmz || false 
        };
        
        AppState.marcadorAntena = L.marker([AppState.antenaGlobal.lat, AppState.antenaGlobal.lon], { icon: antenaIcon }).addTo(map);
        AppState.marcadorAntena.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (typeof handleSpecialMarkerSelection === 'function') handleSpecialMarkerSelection(e.target);
            if (AppState.modoLoSPivotAPivot) {
                handleLoSTargetClick({ ...AppState.antenaGlobal, fora: false, id: 'main_antenna' }, AppState.marcadorAntena);
            } else {
                handleReconfigMainStudy();
            }
        });

        AppState.marcadorAntena.on('contextmenu', (e) => {
            L.DomEvent.stop(e);
            showRenameRepeaterMenu(AppState.marcadorAntena, AppState.antenaGlobal.nome, true, null);
        });

        const alturaAntenaHtml = (AppState.antenaGlobal.altura !== null) ? `<span>${t('ui.labels.antenna_height_tooltip', { height: AppState.antenaGlobal.altura })}</span>` : '';
        const tooltipAntenaContent = `<div style="text-align: center;">${alturaAntenaHtml}<span>${t('ui.labels.receiver_height_tooltip', { height: AppState.antenaGlobal.altura_receiver })}</span></div>`;
        AppState.marcadorAntena.bindTooltip(tooltipAntenaContent, { permanent: false, direction: 'top', offset: [0, -40], className: 'tooltip-sinal' });

        const nomeAntenaPrincipalFormatado = getFormattedAntennaOrRepeaterName(AppState.antenaGlobal);
        const labelWidth = (nomeAntenaPrincipalFormatado.length * 7) + 10;
        const labelPrincipal = L.marker([AppState.antenaGlobal.lat, AppState.antenaGlobal.lon], { icon: L.divIcon({ className: 'label-pivo', html: nomeAntenaPrincipalFormatado, iconSize: [labelWidth, 20], iconAnchor: [labelWidth / 2, 45] }), labelType: 'antena' }).addTo(map);
        AppState.marcadoresLegenda.push(labelPrincipal);
        AppState.antenaGlobal.label = labelPrincipal;
        addAntenaAoPainel(AppState.antenaGlobal);

        if (data.pivos) {
            AppState.lastPivosDataDrawn = AppState.lastPivosDataDrawn.map(pivoAntigo => {
                const pivoNovoDaAPI = data.pivos.find(p => p.nome.trim() === pivoAntigo.nome.trim());
                return pivoNovoDaAPI ? { ...pivoAntigo, fora: pivoNovoDaAPI.fora } : pivoAntigo;
            });
            drawPivos(AppState.lastPivosDataDrawn, false);
        }
        if (data.bombas) {
            AppState.lastBombasDataDrawn = AppState.lastBombasDataDrawn.map(bombaAntiga => {
                const bombaNovaDaAPI = findMatchingBomba(data.bombas, bombaAntiga);
                return bombaNovaDaAPI ? { ...bombaAntiga, fora: bombaNovaDaAPI.fora } : bombaAntiga;
            });
            drawBombas(AppState.lastBombasDataDrawn);
        }

        atualizarPainelDados();
        mostrarMensagem(t('messages.success.simulation_complete'), "sucesso");
        updateDownloadActivePngsButtonState();

    } catch (error) {
        console.error("❌ Erro ao simular sinal:", error);
        mostrarMensagem(t('messages.errors.simulation_fail', { error: error.message }), "erro");
        AppState.antenaGlobal = null;
    } finally {
        mostrarLoader(false);
    }
}

/**
 * Escapa caracteres especiais de uma string para uso em uma expressão regular.
 * @param {string} string - A string para escapar.
 * @returns {string} A string com caracteres especiais escapados.
 */
function escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Conta quantas entidades (antena principal ou repetidoras) já possuem um determinado nome base.
 * @param {string} baseName - O nome base para contar (ex: "Central", "Poste").
 * @param {object} [entityToExclude=null] - A entidade que está sendo renomeada, para não contar a si mesma.
 * @returns {number} A contagem de entidades existentes com aquele nome base.
 */
function countEntitiesWithBaseName(baseName, entityToExclude = null) {
    let count = 0;
    const escapedBaseName = escapeRegExp(baseName.trim());
    const regex = new RegExp(`^${escapedBaseName}( \\d+)?$`, 'i');

    const allEntities = [AppState.antenaGlobal, ...AppState.repetidoras].filter(Boolean);

    for (const entity of allEntities) {
        if (entityToExclude) {
            const isSameRepeater = entity.id && entity.id === entityToExclude.id;
            const isSameMainAntenna = entity === AppState.antenaGlobal && entityToExclude === AppState.antenaGlobal;
            if (isSameRepeater || isSameMainAntenna) {
                continue;
            }
        }

        if (entity.nome && regex.test(entity.nome)) {
            count++;
        }
    }
    return count;
}

/**
 * Encontra o próximo número sequencial para um tipo de entidade.
 * Ex: se "Poste 1" e "Poste 3" existem, retorna 4.
 * @param {string} baseName - O nome base (ex: "Poste").
 * @param {object} [entityToExclude=null] - A entidade que está sendo renomeada, para não contar a si mesma.
 * @returns {number} O próximo número sequencial disponível.
 */
function findNextSequentialNumberForType(baseName, entityToExclude = null) {
    const existingNumbers = [];
    const escapedBaseName = escapeRegExp(baseName.trim());
    const regex = new RegExp(`^${escapedBaseName}\\s+(\\d+)$`, 'i');

    const allEntities = [AppState.antenaGlobal, ...AppState.repetidoras].filter(Boolean);

    allEntities.forEach(entity => {
        if (entityToExclude) {
            const isSameRepeater = entity.id && entity.id === entityToExclude.id;
            const isSameMainAntenna = entity === AppState.antenaGlobal && entityToExclude === AppState.antenaGlobal;
            if (isSameRepeater || isSameMainAntenna) {
                return;
            }
        }

        if (entity.nome) {
            const match = entity.nome.match(regex);
            if (match && match[1]) {
                existingNumbers.push(parseInt(match[1], 10));
            }
        }
    });

    if (existingNumbers.length === 0) {
        return 1;
    }

    return Math.max(...existingNumbers) + 1;
}

/**
 * Casa bombas retornadas pela API com as bombas locais, priorizando coordenadas
 * (tolerância de ~1m) e caindo para o nome se necessário.
 */
function findMatchingBomba(bombasDaAPI, bombaLocal) {
    if (!Array.isArray(bombasDaAPI) || !bombaLocal) return null;

    const tolerance = 1e-5; // aproximadamente 1m
    const byCoords = bombasDaAPI.find(
        (b) =>
            typeof b.lat === "number" &&
            typeof b.lon === "number" &&
            Math.abs(b.lat - bombaLocal.lat) <= tolerance &&
            Math.abs(b.lon - bombaLocal.lon) <= tolerance
    );
    if (byCoords) return byCoords;

    return (
        bombasDaAPI.find(
            (b) => b.nome && bombaLocal.nome && b.nome.trim() === bombaLocal.nome.trim()
        ) || null
    );
}

function handleRenameRepeater(id, newType) {
    const repetidora = AppState.repetidoras.find(r => r.id === id);
    if (repetidora) {
        repetidora.type = newType;

        if (newType !== 'default') {
            const baseName = t(`entity_names.${newType}`);
            const existingCount = countEntitiesWithBaseName(baseName, repetidora);

            if (existingCount === 0) {
                repetidora.nome = baseName;
            } else {
                const nextNumber = findNextSequentialNumberForType(baseName, repetidora);
                repetidora.nome = `${baseName} ${nextNumber}`;
            }
        } else {
            repetidora.nome = repetidora.original_name;
        }

        if (typeof updateAntenaOrRepeaterLabel === 'function') {
            updateAntenaOrRepeaterLabel(repetidora);
        }

        const painelItemSpan = document.querySelector(`#rep-item-${repetidora.id} span`);
        if (painelItemSpan) {
            painelItemSpan.textContent = getFormattedAntennaOrRepeaterName(repetidora, false);
        }

        atualizarPainelDados();
        mostrarMensagem(t('messages.success.repeater_renamed', { name: repetidora.nome }), "sucesso");
    }
}

function handleRenameMainAntenna(newType) {
    if (AppState.antenaGlobal) {
        AppState.antenaGlobal.type = newType;

        if (newType !== 'default') {
            const baseName = t(`entity_names.${newType}`);
            const existingCount = countEntitiesWithBaseName(baseName, AppState.antenaGlobal);

            if (existingCount === 0) {
                AppState.antenaGlobal.nome = baseName;
            } else {
                const nextNumber = findNextSequentialNumberForType(baseName, AppState.antenaGlobal);
                AppState.antenaGlobal.nome = `${baseName} ${nextNumber}`;
            }
        } else {
            AppState.antenaGlobal.nome = AppState.antenaGlobal.original_name;
        }

        if (typeof updateAntenaOrRepeaterLabel === 'function') {
            updateAntenaOrRepeaterLabel(AppState.antenaGlobal);
        }

        const painelItemSpan = document.querySelector("#antena-item span");
        if (painelItemSpan) {
            painelItemSpan.textContent = getFormattedAntennaOrRepeaterName(AppState.antenaGlobal, false);
        }

        atualizarPainelDados();
        mostrarMensagem(t('messages.success.main_antenna_renamed', {
            name: AppState.antenaGlobal.nome
        }), "sucesso");

        setTimeout(removeRenameMenu, 50);
    }
}

async function handleMapClick(e) {
    if (e.originalEvent?.target?.closest?.('.leaflet-marker-icon')) {
        return;
    }

    deselectAllMarkers();

    if (AppState.modoDesenhoPivoSetorial || AppState.modoDesenhoPivo || AppState.modoDesenhoPivoPacman) {
        return;
    }

    if (AppState.modoDesenhoIrripump) {
        handleIrripumpDrawClick(e);
        return;
    }

    if (AppState.modoEdicaoPivos || AppState.modoLoSPivotAPivot) {
        return;
    }

    AppState.clickedCandidateData = null;
    AppState.ultimoCliqueFoiSobrePivo = false;
    AppState.coordenadaClicada = e.latlng;

    if (typeof removePositioningMarker === 'function') {
        removePositioningMarker();
    }

    AppState.marcadorPosicionamento = L.marker(AppState.coordenadaClicada, {
        icon: posicionamentoIcon,
        interactive: false,
        opacity: 0.7,
        zIndexOffset: 1000
    }).addTo(map);

    document.getElementById("painel-repetidora")?.classList.remove("hidden");
    const inputAlturaTorre = document.getElementById("altura-antena-rep");
    const inputAlturaReceiver = document.getElementById("altura-receiver-rep");

    if (inputAlturaTorre) {
        inputAlturaTorre.value = 5;
    }
    if (inputAlturaReceiver) {
        inputAlturaReceiver.value = 3;
    }
}

async function handleIrripumpDrawClick(e) {
    if (!AppState.jobId) {
        mostrarMensagem(t('messages.errors.session_not_started_for_draw'), "erro");
        toggleModoDesenhoIrripump();
        return;
    }

    mostrarLoader(true);
    try {
        const novoNumero = AppState.lastBombasDataDrawn.length + 1;
        const novoNome = `${t('entity_names.irripump')} ${String(novoNumero).padStart(2, '0')}`;

        const novaBomba = {
            nome: novoNome,
            lat: e.latlng.lat,
            lon: e.latlng.lng,
            fora: true
        };

        AppState.lastBombasDataDrawn.push(novaBomba);

        drawBombas(AppState.lastBombasDataDrawn);
        atualizarPainelDados();

        await reavaliarPivosViaAPI();

        mostrarMensagem(t('messages.success.irripump_created', { name: novoNome }), "sucesso");

        setTimeout(() => {
            if (AppState.modoDesenhoIrripump) {
                mostrarMensagem(t('messages.info.draw_irripump_still_active'), "info");
            }
        }, 2500);

    } catch (error) {
        console.error("Falha ao criar o Irripump:", error);
        mostrarMensagem(t('messages.errors.generic_error', { error: error.message }), "erro");
    } finally {
        mostrarLoader(false);
    }
}

async function handleConfirmRepetidoraClick() {
    if (!AppState.coordenadaClicada || !AppState.jobId) {
        mostrarMensagem(t('messages.errors.invalid_data_or_session'), "erro");
        return;
    }

    const alturaAntena = parseFloat(document.getElementById("altura-antena-rep").value);
    const alturaReceiver = parseFloat(document.getElementById("altura-receiver-rep").value);
    AppState.templateSelecionado = document.getElementById('template-modelo').value;

    mostrarLoader(true);

    try {
        if (AppState.antenaGlobal && AppState.clickedCandidateData && AppState.clickedCandidateData.lat === AppState.antenaGlobal.lat && AppState.clickedCandidateData.lon === AppState.antenaGlobal.lon) {
            console.log("Ressimulando a antena principal...");
            const antenaDataParaSimular = { ...AppState.antenaGlobal, altura: alturaAntena, altura_receiver: alturaReceiver };
            await startMainSimulation(antenaDataParaSimular);
            AppState.clickedCandidateData = null;
            return;
        }

        if (!AppState.antenaGlobal) {
            let dataSimulacaoInicial;

            if (AppState.clickedCandidateData) {
                console.log("Iniciando simulação principal com candidato KMZ.");
                dataSimulacaoInicial = { ...AppState.clickedCandidateData };
            } else if (AppState.coordenadaClicada) {
                console.log("Iniciando simulação principal com ponto manual.");
                const id = AppState.idsDisponiveis.length > 0 ? AppState.idsDisponiveis.shift() : ++AppState.contadorRepetidoras;
                const nomeInicial = `${t('ui.labels.repeater')} ${id}`;

                dataSimulacaoInicial = {
                    nome: nomeInicial,
                    original_name: nomeInicial,
                    lat: AppState.coordenadaClicada.lat,
                    lon: AppState.coordenadaClicada.lng,
                    type: 'default',
                    is_from_kmz: false,
                    had_height_in_kmz: false
                };
            } else {
                mostrarMensagem(t('messages.errors.invalid_data_or_session'), "erro");
                mostrarLoader(false);
                return;
            }
            
            AppState.clickedCandidateData = null;
            if (typeof removePositioningMarker === 'function') removePositioningMarker();
            
            await startMainSimulation({
                ...dataSimulacaoInicial,
                altura: alturaAntena || dataSimulacaoInicial.altura,
                altura_receiver: alturaReceiver || dataSimulacaoInicial.altura_receiver,
            });
            return;
        }

        if (typeof removePositioningMarker === 'function') removePositioningMarker();
        
        const id = AppState.idsDisponiveis.length > 0 ? AppState.idsDisponiveis.shift() : ++AppState.contadorRepetidoras;

        const nomeRep = `${t('ui.labels.repeater')} ${id}`;
        
        const novaRepetidoraMarker = L.marker(AppState.coordenadaClicada, { icon: antenaIcon }).addTo(map);
        novaRepetidoraMarker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (typeof handleSpecialMarkerSelection === 'function') handleSpecialMarkerSelection(e.target);
            if (AppState.modoLoSPivotAPivot) {
                const repetidora = AppState.repetidoras.find(r => r.marker === e.target);
                if (repetidora) handleLoSTargetClick({ ...repetidora, fora: false }, e.target);
            }
        });

        const repetidoraObj = {
            id, marker: novaRepetidoraMarker, overlay: null, label: null,
            altura: alturaAntena, altura_receiver: alturaReceiver,
            lat: AppState.coordenadaClicada.lat, lon: AppState.coordenadaClicada.lng,
            imagem_filename: null, sobre_pivo: AppState.ultimoCliqueFoiSobrePivo || false,
            nome: nomeRep, original_name: nomeRep, is_from_kmz: false,
            type: 'default', had_height_in_kmz: false
        };

        const nomeRepFormatado = getFormattedAntennaOrRepeaterName(repetidoraObj);
        const labelRepetidora = L.marker(AppState.coordenadaClicada, {
            icon: L.divIcon({ className: 'label-pivo', html: nomeRepFormatado, iconSize: [(nomeRepFormatado.length * 7) + 10, 20], iconAnchor: [((nomeRepFormatado.length * 7) + 10) / 2, 45] }),
            labelType: 'repetidora'
        }).addTo(map);
        AppState.marcadoresLegenda.push(labelRepetidora);
        repetidoraObj.label = labelRepetidora;

        const alturaRepetidoraHtml = (alturaAntena !== null) ? `<span>${t('ui.labels.antenna_height_tooltip', { height: alturaAntena })}</span>` : '';
        const tooltipRepetidoraContent = `<div style="text-align: center;">${alturaRepetidoraHtml}<span>${t('ui.labels.receiver_height_tooltip', { height: alturaReceiver })}</span></div>`;
        novaRepetidoraMarker.bindTooltip(tooltipRepetidoraContent, { permanent: false, direction: 'top', offset: [0, -40], className: 'tooltip-sinal' });
        AppState.repetidoras.push(repetidoraObj);
        const pivos_para_simulacao = AppState.lastPivosDataDrawn.map(p => ({ nome: p.nome, lat: p.lat, lon: p.lon, type: 'pivo' }));
        const bombas_para_simulacao = (AppState.lastBombasDataDrawn || []).map(b => ({ nome: b.nome, lat: b.lat, lon: b.lon, type: 'bomba' }));

        const payload = {
            job_id: AppState.jobId, lat: repetidoraObj.lat, lon: repetidoraObj.lon,
            altura: repetidoraObj.altura, altura_receiver: repetidoraObj.altura_receiver,
            pivos_atuais: pivos_para_simulacao,
            bombas_atuais: bombas_para_simulacao, 
            template: AppState.templateSelecionado
        };

        const data = await simulateManual(payload);
        repetidoraObj.overlay = drawImageOverlay(data.imagem_salva, data.bounds, 1.0);
        repetidoraObj.imagem_filename = data.imagem_filename.split('/').pop();
        addRepetidoraNoPainel(repetidoraObj);
        await reavaliarPivosViaAPI();
        mostrarMensagem(t('messages.success.repeater_added', { name: getFormattedAntennaOrRepeaterName(repetidoraObj) }), "sucesso");
        updateDownloadActivePngsButtonState();

    } catch (error) {
        mostrarMensagem(t('messages.errors.simulation_fail', { error: error.message }), "erro");
        const failedRep = AppState.repetidoras.pop();
        if (failedRep) {
            if (failedRep.marker) map.removeLayer(failedRep.marker);
            if (failedRep.label) map.removeLayer(failedRep.label);
            AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter(l => l !== failedRep.label);
        }
    } finally {
        mostrarLoader(false);
        AppState.coordenadaClicada = null;
        atualizarPainelDados();
        reposicionarPaineisLaterais();
    }
}

function handleBuscarLocaisRepetidoraActivation() {
    const isActivating = !AppState.modoBuscaLocalRepetidora;

    if (isActivating) {
        deactivateAllModes();
    }

    AppState.modoBuscaLocalRepetidora = isActivating;
    const btn = document.getElementById('btn-buscar-locais-repetidora');

    if (btn) {
        btn.classList.toggle('glass-button-active', isActivating);
    }

    if (isActivating) {
        mostrarMensagem(t('messages.info.los_mode_on'), "sucesso");
        AppState.pivoAlvoParaLocalRepetidora = null;

        if (AppState.marcadorPosicionamento && typeof removePositioningMarker === 'function') {
            removePositioningMarker();
        }

        document.getElementById("painel-repetidora")?.classList.add("hidden");
        if (map) map.getContainer().style.cursor = 'crosshair';

    } else {
        if (AppState.xSelecionadoMarker) {
            map.removeLayer(AppState.xSelecionadoMarker);
            AppState.xSelecionadoMarker = null;
        }

        mostrarMensagem(t('messages.info.los_mode_off_find_repeater'), "sucesso");
        mostrarMensagem(t('messages.info.find_repeater_long_process_warning'), "info");
        AppState.pivoAlvoParaLocalRepetidora = null;
        if (map) map.getContainer().style.cursor = '';
        if (window.candidateRepeaterSitesLayerGroup) {
            window.candidateRepeaterSitesLayerGroup.clearLayers();
        }
    }
}

async function handlePivotSelectionForRepeaterSite(pivoData, pivoMarker) {
    if (!AppState.modoBuscaLocalRepetidora) return;

    if (!AppState.jobId) {
        mostrarMensagem(t('messages.errors.run_study_first'), "erro");
        return;
    }

    const pivoInfo = AppState.lastPivosDataDrawn.find(p => p.nome === pivoData.nome);
    if (pivoInfo && !pivoInfo.fora) {
        mostrarMensagem(t('messages.errors.select_uncovered_pivot'), "erro");
        return;
    }

    if (AppState.xSelecionadoMarker) {
        map.removeLayer(AppState.xSelecionadoMarker);
        AppState.xSelecionadoMarker = null;
    }

    AppState.pivoAlvoParaLocalRepetidora = {
        nome: pivoData.nome,
        lat: pivoMarker.getLatLng().lat,
        lon: pivoMarker.getLatLng().lng,
        altura_receiver: (AppState.antenaGlobal && typeof AppState.antenaGlobal.altura_receiver === 'number') ? AppState.antenaGlobal.altura_receiver : 3
    };

    mostrarMensagem(t('messages.info.target_pivot_selected', { name: AppState.pivoAlvoParaLocalRepetidora.nome }), "info");
    const dicasLoader = [
        t('messages.info.find_repeater_long_process_warning'),
        t('loader_tips.inaccurate_search'),
        t('loader_tips.try_manual_repeater'),
        t('loader_tips.consider_nearby_locations'),
        t('loader_tips.blocked_los_compensation')
    ];
    mostrarLoader(true, dicasLoader);
    if (map) map.getContainer().style.cursor = 'wait';

    const activeOverlaysForSearch = [];

    const antenaVisBtn = document.querySelector("#antena-item button[data-visible]");
    const isAntenaVisible = !antenaVisBtn || antenaVisBtn.getAttribute('data-visible') === 'true';

    if (AppState.antenaGlobal?.overlay && map.hasLayer(AppState.antenaGlobal.overlay) && isAntenaVisible && AppState.antenaGlobal.imagem_filename) {
        const b = AppState.antenaGlobal.overlay.getBounds();
        activeOverlaysForSearch.push({
            id: 'antena_principal',
            imagem: AppState.antenaGlobal.imagem_filename,
            bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
        });
    }

    AppState.repetidoras.forEach(rep => {
        const repVisBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
        const isRepVisible = !repVisBtn || repVisBtn.getAttribute('data-visible') === 'true';
        if (rep.overlay && map.hasLayer(rep.overlay) && isRepVisible && rep.imagem_filename) {
            const b = rep.overlay.getBounds();
            activeOverlaysForSearch.push({
                id: `repetidora_${rep.id}`,
                imagem: rep.imagem_filename,
                bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
            });
        }
    });

    if (activeOverlaysForSearch.length === 0) {
        mostrarMensagem(t('messages.errors.no_coverage_to_search'), "erro");
        mostrarLoader(false);
        if (map) map.getContainer().style.cursor = AppState.modoBuscaLocalRepetidora ? 'crosshair' : '';
        return;
    }

    try {
        const payload = {
            job_id: AppState.jobId,
            target_pivot_lat: AppState.pivoAlvoParaLocalRepetidora.lat,
            target_pivot_lon: AppState.pivoAlvoParaLocalRepetidora.lon,
            target_pivot_nome: AppState.pivoAlvoParaLocalRepetidora.nome,
            altura_antena_repetidora_proposta: parseFloat(document.getElementById("altura-antena-rep").value) || 5,
            altura_receiver_pivo: AppState.pivoAlvoParaLocalRepetidora.altura_receiver,
            active_overlays: activeOverlaysForSearch,
            pivot_polygons_coords: AppState.ciclosGlobais ? AppState.ciclosGlobais.map(c => c.coordenadas) : []
        };

        const resultados = await findHighPointsForRepeater(payload);

        if (window.candidateRepeaterSitesLayerGroup) {
            window.candidateRepeaterSitesLayerGroup.clearLayers();
        }

        if (resultados?.candidate_sites?.length > 0) {
            drawCandidateRepeaterSites(resultados.candidate_sites, AppState.pivoAlvoParaLocalRepetidora);
            mostrarMensagem(t('messages.success.found_candidate_sites', { count: resultados.candidate_sites.length }), "sucesso");
        } else {
            mostrarMensagem(t('messages.info.no_promising_sites_found'), "info");
        }

    } catch (error) {
        console.error("Erro ao buscar locais para repetidora:", error);
        mostrarMensagem(t('messages.errors.find_repeater_fail', { error: error.message || 'Erro desconhecido' }), "erro");
    } finally {
        mostrarLoader(false);
        if (map) map.getContainer().style.cursor = AppState.modoBuscaLocalRepetidora ? 'crosshair' : '';
    }
}

function toggleModoDesenhoPivo() {
    const isActivating = !AppState.modoDesenhoPivo;

    if (isActivating) {
        deactivateAllModes();
    }

    AppState.modoDesenhoPivo = isActivating;
    document.getElementById('btn-draw-pivot')?.classList.toggle('glass-button-active', AppState.modoDesenhoPivo);

    if (AppState.modoDesenhoPivo) {
        map.getContainer().style.cursor = 'crosshair';
        mostrarMensagem(t('messages.info.draw_pivot_step1'), "info");
        map.on('click', handlePivotDrawClick);
        map.on('mousemove', handlePivotDrawMouseMove);
    } else {
        map.getContainer().style.cursor = '';
        AppState.centroPivoTemporario = null;
        if (typeof removeTempCircle === 'function') removeTempCircle();
        removeDrawingTooltip(map);
        mostrarMensagem(t('messages.info.draw_pivot_off'), "sucesso");
        map.off('click', handlePivotDrawClick);
        map.off('mousemove', handlePivotDrawMouseMove);
    }
}

function handlePivotDrawMouseMove(e) {
    if (AppState.modoDesenhoPivo && AppState.centroPivoTemporario) {
        if (typeof drawTempCircle === 'function') {
            drawTempCircle(AppState.centroPivoTemporario, e.latlng);
        }
        const distancia = AppState.centroPivoTemporario.distanceTo(e.latlng);
        const textoTooltip = `${t('ui.labels.radius')}: ${distancia.toFixed(1)} m`;
        updateDrawingTooltip(map, e, textoTooltip);
    }
}

async function handlePivotDrawClick(e) {
    if (!AppState.modoDesenhoPivo) return;

    if (!AppState.jobId) {
        mostrarMensagem(t('messages.errors.session_not_started_for_draw'), "erro");
        toggleModoDesenhoPivo();
        return;
    }

    if (!AppState.centroPivoTemporario) {
        AppState.centroPivoTemporario = e.latlng;
        mostrarMensagem(t('messages.info.draw_pivot_step2'), "info");
        return;
    }

    const radiusPoint = e.latlng;
    mostrarLoader(true);

    try {
        const payload = {
            job_id: AppState.jobId,
            center: [AppState.centroPivoTemporario.lat, AppState.centroPivoTemporario.lng],
            pivos_atuais: AppState.lastPivosDataDrawn,
            language: localStorage.getItem('preferredLanguage') || 'pt-br'
        };

        const radiusInMeters = AppState.centroPivoTemporario.distanceTo(radiusPoint);
        const result = await generatePivotInCircle(payload);
        const novoPivo = { ...result.novo_pivo, fora: true, raio: radiusInMeters, circle_center_lat: AppState.centroPivoTemporario.lat, circle_center_lon: AppState.centroPivoTemporario.lng };
        const circleCoords = generateCircleCoords(AppState.centroPivoTemporario, radiusInMeters);

        const novoCiclo = {
            nome_original_circulo: `Ciclo ${novoPivo.nome}`,
            coordenadas: circleCoords
        };

        AppState.lastPivosDataDrawn.push(novoPivo);
        AppState.ciclosGlobais.push(novoCiclo);
        if (AppState.currentProcessedKmzData?.pivos) AppState.currentProcessedKmzData.pivos.push(novoPivo);
        if (AppState.currentProcessedKmzData?.ciclos) AppState.currentProcessedKmzData.ciclos.push(novoCiclo);

        if (typeof removeTempCircle === 'function') removeTempCircle();

        atualizarPainelDados();
        drawPivos(AppState.lastPivosDataDrawn, false);
        drawCirculos(AppState.ciclosGlobais);

        await reavaliarPivosViaAPI();
        mostrarMensagem(t('messages.success.pivot_created', { name: novoPivo.nome }), "sucesso");

        setTimeout(() => {
            if (AppState.modoDesenhoPivo) {
                mostrarMensagem(t('messages.info.draw_pivot_still_active'), "info");
            }
        }, 2500);

    } catch (error) {
        console.error("Falha ao criar o pivô:", error);
        mostrarMensagem(t('messages.errors.generic_error', { error: error.message }), "erro");
        if (typeof removeTempCircle === 'function') removeTempCircle();
    } finally {
        AppState.centroPivoTemporario = null;
        mostrarLoader(false);
        removeDrawingTooltip(map);
    }
}

async function handleExportPdfReportClick() {
    if (!AppState.jobId || !AppState.currentProcessedKmzData) {
        mostrarMensagem(t('messages.errors.load_kmz_first'), "erro");
        return;
    }
    if (!AppState.antenaGlobal && AppState.repetidoras.length === 0 && AppState.lastPivosDataDrawn.length === 0 && AppState.lastBombasDataDrawn.length === 0) {
        mostrarMensagem(t('messages.errors.nothing_to_export'), "erro");
        return;
    }

    mostrarLoader(true);
    mostrarMensagem(t('messages.success.pdf_export_preparing'), "info");

    try {
        const repetidorasParaRelatorio = [];
        AppState.repetidoras.forEach(rep => {
            const visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
            const isVisible = !visibilityBtn || visibilityBtn.getAttribute('data-visible') === 'true';

            if (isVisible) {
                repetidorasParaRelatorio.push({
                    nome: rep.nome,
                    lat: rep.lat,
                    lon: rep.lon,
                    altura: rep.altura,
                    altura_receiver: rep.altura_receiver,
                    is_from_kmz: rep.is_from_kmz || false,
                    sobre_pivo: rep.sobre_pivo || false,
                    type: rep.type || 'default'
                });
            }
        });

        let antenaDataParaRelatorio = null;
        if (AppState.antenaGlobal) {
            antenaDataParaRelatorio = {
                nome: AppState.antenaGlobal.nome,
                lat: AppState.antenaGlobal.lat,
                lon: AppState.antenaGlobal.lon,
                altura: AppState.antenaGlobal.altura,
                altura_receiver: AppState.antenaGlobal.altura_receiver,
                type: AppState.antenaGlobal.type || 'default'
            };
        }

        const pivosComStatus = AppState.lastPivosDataDrawn.map(p => ({
            nome: p.nome,
            lat: p.lat,
            lon: p.lon,
            fora: p.fora
        }));

        const bombasComStatus = AppState.lastBombasDataDrawn.map(b => ({
            nome: b.nome,
            lat: b.lat,
            lon: b.lon,
            fora: b.fora
        }));

        const payload = {
            job_id: AppState.jobId,
            language: localStorage.getItem('preferredLanguage') || 'pt-br',
            antena_principal_data: antenaDataParaRelatorio,
            pivos_data: pivosComStatus,
            bombas_data: bombasComStatus,
            repetidoras_data: repetidorasParaRelatorio,
            template_id: AppState.templateSelecionado || document.getElementById('template-modelo').value,
        };

        await exportPdfReport(payload);

        mostrarMensagem(t('messages.success.pdf_export_complete'), "sucesso");

    } catch (error) {
        console.error("Erro no processo de exportação PDF:", error);
        mostrarMensagem(t('messages.errors.pdf_export_fail', { error: error.message }), "erro");
    } finally {
        mostrarLoader(false);
    }
}

async function handleResetClick(showMessage = true) {
    if (showMessage) {
        console.log("🔄 Resetando aplicação...");
    }

    clearMapLayers();
    AppState.reset();

    await startNewSession();

    const toggleableButtonsIds = [
        'btn-los-pivot-a-pivot',
        'btn-buscar-locais-repetidora',
        'btn-visada',
        'toggle-legenda',
        'toggle-antenas-legendas',
        'toggle-distancias-pivos',
        'btn-draw-pivot',
        'btn-draw-pivot-setorial',
        'btn-draw-pivot-pacman',
        'btn-draw-irripump',
        'editar-pivos',
        'btn-mover-pivo-sem-circulo',
        'desfazer-edicao'
    ];

    toggleableButtonsIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.remove('glass-button-active');
    });

    const editButton = document.getElementById("editar-pivos");
    if (editButton) {
        editButton.innerHTML = `<i data-lucide="pencil" class="w-5 h-5"></i>`;
    }

    const undoButton = document.getElementById("desfazer-edicao");
    if (undoButton) {
        undoButton.classList.add('hidden');
    }

    const moveButton = document.getElementById("btn-mover-pivo-sem-circulo");
    if (moveButton) {
        moveButton.classList.add('hidden');
    }

    const toggleLegendaBtn = document.getElementById('toggle-legenda');
    if (toggleLegendaBtn) {
        const icon = toggleLegendaBtn.querySelector('.sidebar-icon');
        const iconPath = 'assets/images/captions.svg';
        if (icon) {
            icon.style.webkitMaskImage = `url(${iconPath})`;
            icon.style.maskImage = `url(${iconPath})`;
        }
    }

    const toggleAntenasLegendasBtn = document.getElementById('toggle-antenas-legendas');
    if (toggleAntenasLegendasBtn) {
        const icon = toggleAntenasLegendasBtn.querySelector('.sidebar-icon');
        if (icon) {
            icon.style.webkitMaskImage = `url('assets/images/radio.svg')`;
            icon.style.maskImage = `url('assets/images/radio.svg')`;
        }
    }

    updatePdfButtonState(false);

    if (map) {
        map.getContainer().style.cursor = '';
        if (window.candidateRepeaterSitesLayerGroup) {
            window.candidateRepeaterSitesLayerGroup.clearLayers();
        }
        map.off('click', handlePivotDrawClick);
        map.off('mousemove', handlePivotDrawMouseMove);
        map.off('click', handleSectorialPivotDrawClick);
        map.off('mousemove', handleSectorialDrawMouseMove);
        map.setView([-15, -55], 5);
    }

    document.getElementById("simular-btn")?.classList.add("hidden");
    const listaRep = document.getElementById("lista-repetidoras");
    if (listaRep) listaRep.innerHTML = "";

    const paineisParaEsconder = ["painel-repetidora", "desfazer-edicao"];
    paineisParaEsconder.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });

    updateDownloadActivePngsButtonState();

    const nomeArquivoLabelElement = document.getElementById('nome-arquivo-label');
    if (nomeArquivoLabelElement) {
        nomeArquivoLabelElement.textContent = t('ui.labels.choose_kmz');
        // Evita tooltip duplicado: o título fica apenas no <label for="arquivo">
        if (nomeArquivoLabelElement.hasAttribute('title')) {
            nomeArquivoLabelElement.removeAttribute('title');
        }
    }
    const arquivoInput = document.getElementById('arquivo');
    if (arquivoInput) arquivoInput.value = '';

    const rangeOp = document.getElementById("range-opacidade");
    if (rangeOp) rangeOp.value = 1;

    atualizarPainelDados();
    reposicionarPaineisLaterais();
    updateLegendsVisibility();

    if (showMessage) {
        mostrarMensagem(t('messages.success.app_reset'), "sucesso");
    }

    lucide?.createIcons?.();
}

async function runTargetedDiagnostic(diagnosticoSource) {
    if (!diagnosticoSource) {
        mostrarMensagem(t('messages.errors.run_study_first'), "erro");
        return;
    }

    AppState.visadaVisivel = true;
    document.getElementById("btn-visada")?.classList.remove("opacity-50");

    const sourceName = getFormattedAntennaOrRepeaterName(diagnosticoSource.isMainAntenna ? AppState.antenaGlobal : diagnosticoSource);
    const sourceLatLng = diagnosticoSource.marker ? diagnosticoSource.marker.getLatLng() : L.latLng(diagnosticoSource.lat, diagnosticoSource.lon);

    mostrarLoader(true);

    if (AppState.visadaLayerGroup) {
        AppState.visadaLayerGroup.clearLayers();
    }
    AppState.linhasDiagnostico = [];
    AppState.marcadoresBloqueio = [];

    const alvosParaAnalisar = [];
    const defaultReceiverHeight = (AppState.antenaGlobal?.altura_receiver) ?? 3;

    AppState.lastPivosDataDrawn.filter(p => p.fora).forEach(pivoInfo => {
        const marcador = AppState.pivotsMap[pivoInfo.nome];
        if (marcador) {
            alvosParaAnalisar.push({
                nome: pivoInfo.nome,
                latlng: marcador.getLatLng(),
                altura_receiver: defaultReceiverHeight
            });
        }
    });

    AppState.lastBombasDataDrawn.forEach((bomba, index) => {
        if (bomba.fora) {
            const marcadorBomba = AppState.marcadoresBombas[index];
            if (marcadorBomba) {
                alvosParaAnalisar.push({
                    nome: `Irripump ${String(index + 1).padStart(2, '0')}`,
                    latlng: marcadorBomba.getLatLng(),
                    altura_receiver: defaultReceiverHeight
                });
            }
        }
    });

    const LIMITE_DISTANCIA_KM = 4.5;
    const LIMITE_DISTANCIA_MTS = LIMITE_DISTANCIA_KM * 1000;
    const totalAlvosSemCobertura = alvosParaAnalisar.length;

    const alvosFiltrados = alvosParaAnalisar.filter(alvo => {
        const pivoLatLng = alvo.latlng;
        const distancia = sourceLatLng.distanceTo(pivoLatLng);
        return distancia <= LIMITE_DISTANCIA_MTS;
    });

    if (alvosFiltrados.length === 0) {
        if (totalAlvosSemCobertura > 0) {
            mostrarMensagem(t('messages.info.no_uncovered_targets_in_radius', { limit: `${LIMITE_DISTANCIA_KM}km` }), "info");
        } else {
            mostrarMensagem(t('messages.info.no_uncovered_targets'), "sucesso");
        }
        mostrarLoader(false);
        return;
    }

    const alvosIgnorados = totalAlvosSemCobertura - alvosFiltrados.length;
    let mensagemInicial = t('messages.info.analyzing_targets_from_source', { count: alvosFiltrados.length, source: sourceName });
    if (alvosIgnorados > 0) {
        mensagemInicial += ` ${t('messages.info.targets_ignored_by_distance', { count: alvosIgnorados, limit: `${LIMITE_DISTANCIA_KM}km` })}`;
    }
    mostrarMensagem(mensagemInicial, "sucesso");

    for (const alvo of alvosFiltrados) {
        const alvoLatLng = alvo.latlng;
        const distanciaEntreAlvos = sourceLatLng.distanceTo(alvoLatLng);
        const distanciaFormatada = distanciaEntreAlvos > 999 ? (distanciaEntreAlvos / 1000).toFixed(1) + ' km' : Math.round(distanciaEntreAlvos) + ' m';

        const payload = {
            pontos: [
                [sourceLatLng.lat, sourceLatLng.lng],
                [alvoLatLng.lat, alvoLatLng.lng]
            ],
            altura_antena: diagnosticoSource.altura || 15,
            altura_receiver: alvo.altura_receiver,
            return_highest_point: true
        };

        try {
            const data = await getElevationProfile(payload);
            const nomeDiagnostico = `${sourceName} → ${alvo.nome}`;
            const featuresToDraw = {
                pivos: AppState.lastPivosDataDrawn,
                ciclos: AppState.ciclosGlobais,
                antena: AppState.antenaGlobal,
                repetidoras: AppState.repetidoras
            };
            drawDiagnostico(
                payload.pontos[0], payload.pontos[1],
                data.bloqueio, data.ponto_mais_alto, nomeDiagnostico, distanciaFormatada,
                data, payload, featuresToDraw // Adiciona o novo parâmetro aqui
            );

        } catch (error) {
            console.error(`Erro no diagnóstico do alvo ${alvo.nome}:`, error);
            mostrarMensagem(t('messages.errors.los_diagnostic_fail', { name: alvo.nome }), "erro");
        }
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    mostrarLoader(false);
    mostrarMensagem(t('messages.success.los_diagnostic_complete'), "sucesso");
}

async function handleDownloadActivePngsClick() {
    if (!AppState.jobId) {
        mostrarMensagem(t('messages.errors.session_not_started'), "erro");
        return;
    }

    const repetidorasSelecionadasParaExport = [];

    // Antena principal: só inclui se estiver visível no painel
    const antenaVisBtn = document.querySelector("#antena-item button[data-visible]");
    const isAntenaVisivel = !antenaVisBtn || antenaVisBtn.getAttribute('data-visible') === 'true';

    let antenaDataParaExport = null;
    let imagemPrincipal = null;
    let boundsFilePrincipal = null;

    if (AppState.antenaGlobal && AppState.antenaGlobal.imagem_filename && isAntenaVisivel) {
        antenaDataParaExport = {
            nome: AppState.antenaGlobal.nome,
            lat: AppState.antenaGlobal.lat,
            lon: AppState.antenaGlobal.lon,
            altura: AppState.antenaGlobal.altura,
            altura_receiver: AppState.antenaGlobal.altura_receiver,
            type: AppState.antenaGlobal.type || 'default'
        };
        imagemPrincipal = AppState.antenaGlobal.imagem_filename;
        boundsFilePrincipal = imagemPrincipal.replace(/\.png$/, '.json');
    }

    // Repetidoras: só inclui as visíveis no painel
    AppState.repetidoras.forEach(rep => {
        const repVisBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
        const isRepVisivel = !repVisBtn || repVisBtn.getAttribute('data-visible') === 'true';

        if (isRepVisivel && rep.imagem_filename) {
            repetidorasSelecionadasParaExport.push({
                imagem: rep.imagem_filename,
                altura: rep.altura,
                sobre_pivo: rep.sobre_pivo,
                nome: rep.is_from_kmz ? rep.nome : null,
                type: rep.type || 'default'
            });
        }
    });

    if (!antenaDataParaExport && repetidorasSelecionadasParaExport.length === 0) {
        mostrarMensagem(t('messages.info.no_active_png_overlays'), "info");
        return;
    }

    try {
        mostrarLoader(true);

        const payload = {
            job_id: AppState.jobId,
            template_id: AppState.templateSelecionado || document.getElementById('template-modelo').value,
            language: localStorage.getItem('preferredLanguage') || 'pt-br',
            antena_principal_data: antenaDataParaExport,
            imagem: imagemPrincipal,
            bounds_file: boundsFilePrincipal,
            // Exporta apenas as coberturas (overlays) e legendas, sem desenhos do projeto
            pivos_data: [],
            ciclos_data: [],
            bombas_data: [],
            repetidoras_data: repetidorasSelecionadasParaExport
        };

        await exportKmz(payload);

    } catch (error) {
        mostrarMensagem(t('messages.errors.generic_error', { error: error.message }), "erro");
    } finally {
        mostrarLoader(false);
    }
}

function hasActiveCoverageOverlays() {
    if (!AppState.jobId) return false;

    if (AppState.antenaGlobal && AppState.antenaGlobal.imagem_filename) {
        return true;
    }

    for (const rep of AppState.repetidoras) {
        if (rep.imagem_filename) {
            return true;
        }
    }

    return false;
}

function updateDownloadActivePngsButtonState() {
    const btn = document.getElementById('btn-download-active-pngs');
    if (!btn) return;

    const hasActive = hasActiveCoverageOverlays();

    if (hasActive) {
        btn.disabled = false;
    } else {
        btn.disabled = true;
    }
}

async function handleExportClick() {
    if (!AppState.jobId) {
        mostrarMensagem(t('messages.errors.session_not_started'), "erro");
        return;
    }
    if (!AppState.antenaGlobal && AppState.repetidoras.length === 0) {
        mostrarMensagem(t('messages.errors.nothing_to_export'), "erro");
        return;
    }

    mostrarLoader(true);
    mostrarMensagem(t('messages.success.kmz_export_preparing'), "info");

    try {
        const repetidorasSelecionadasParaExport = [];
        AppState.repetidoras.forEach(rep => {
            const visibilityBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
            const isVisible = !visibilityBtn || visibilityBtn.getAttribute('data-visible') === 'true';

            if (isVisible && rep.imagem_filename) {
                repetidorasSelecionadasParaExport.push({
                    imagem: rep.imagem_filename,
                    altura: rep.altura,
                    sobre_pivo: rep.sobre_pivo,
                    nome: rep.is_from_kmz ? rep.nome : null,
                    type: rep.type || 'default'
                });
            }
        });

        let antenaDataParaExport = null;
        let imagemPrincipal = null;
        let boundsFilePrincipal = null;

        if (AppState.antenaGlobal) {
            antenaDataParaExport = {
                nome: AppState.antenaGlobal.nome,
                lat: AppState.antenaGlobal.lat,
                lon: AppState.antenaGlobal.lon,
                altura: AppState.antenaGlobal.altura,
                altura_receiver: AppState.antenaGlobal.altura_receiver,
                type: AppState.antenaGlobal.type || 'default'
            };
            imagemPrincipal = AppState.antenaGlobal.imagem_filename;
            if (imagemPrincipal) {
                boundsFilePrincipal = imagemPrincipal.replace(/\.png$/, '.json');
            }
        }

        const payload = {
            job_id: AppState.jobId,
            template_id: AppState.templateSelecionado || document.getElementById('template-modelo').value,
            language: localStorage.getItem('preferredLanguage') || 'pt-br',
            antena_principal_data: antenaDataParaExport,
            imagem: imagemPrincipal,
            bounds_file: boundsFilePrincipal,
            pivos_data: AppState.lastPivosDataDrawn,
            ciclos_data: AppState.ciclosGlobais,
            bombas_data: AppState.lastBombasDataDrawn,
            repetidoras_data: repetidorasSelecionadasParaExport
        };

        await exportKmz(payload);

        updatePdfButtonState(true);
        mostrarMensagem(t('messages.info.pdf_report_unlocked'), "sucesso");

    } catch (error) {
        console.error("Erro no processo de exportação KMZ:", error);
        mostrarMensagem(t('messages.errors.generic_error', { error: error.message }), "erro");
    } finally {
        mostrarLoader(false);
    }
}

async function reavaliarPivosViaAPI() {
    if (!AppState.jobId || (AppState.lastPivosDataDrawn.length === 0 && AppState.lastBombasDataDrawn.length === 0)) {
        return;
    }

    let pivosParaReavaliar = AppState.lastPivosDataDrawn.map(p => ({ nome: p.nome, lat: p.lat, lon: p.lon, type: 'pivo' }));
    const bombasParaReavaliar = (AppState.lastBombasDataDrawn || []).map(b => ({ nome: b.nome, lat: b.lat, lon: b.lon, type: 'bomba' }));

    if (pivosParaReavaliar.length === 0 && bombasParaReavaliar.length > 0) {
        console.warn("Workaround: Enviando a primeira bomba como 'pivô' para forçar o processamento do backend.");
        const bombaDisfarcada = { ...bombasParaReavaliar[0], type: 'pivo' };
        pivosParaReavaliar.push(bombaDisfarcada);
    }

    const overlays = [];
    const signal_sources = [];
    const antenaVisBtn = document.querySelector("#antena-item button[data-visible]");
    const isAntenaActiveAndVisible = !antenaVisBtn || antenaVisBtn.getAttribute('data-visible') === 'true';

    if (AppState.antenaGlobal && isAntenaActiveAndVisible) {
        signal_sources.push({ lat: AppState.antenaGlobal.lat, lon: AppState.antenaGlobal.lon });

        if (AppState.antenaGlobal.overlay && map.hasLayer(AppState.antenaGlobal.overlay) && AppState.antenaGlobal.imagem_filename) {
            const b = AppState.antenaGlobal.overlay.getBounds();
            overlays.push({ id: 'antena_principal', imagem: AppState.antenaGlobal.imagem_filename, bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()] });
        }
    }

    AppState.repetidoras.forEach(rep => {
        const repVisBtn = document.querySelector(`#rep-item-${rep.id} button[data-visible]`);
        const isRepActiveAndVisible = !repVisBtn || repVisBtn.getAttribute('data-visible') === 'true';

        if (isRepActiveAndVisible) {
            signal_sources.push({ lat: rep.lat, lon: rep.lon });

            if (rep.overlay && map.hasLayer(rep.overlay) && rep.imagem_filename) {
                const b = rep.overlay.getBounds();
                overlays.push({ id: `repetidora_${rep.id}`, imagem: rep.imagem_filename, bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()] });
            }
        }
    });

    try {
        const payload = {
            job_id: AppState.jobId,
            pivos: pivosParaReavaliar,
            bombas: bombasParaReavaliar,
            overlays,
            signal_sources
        };
        const data = await reevaluatePivots(payload);

        if (data.pivos) {
            AppState.lastPivosDataDrawn = AppState.lastPivosDataDrawn.map(pivoAntigo => {
                const pivoNovoDaAPI = data.pivos.find(p => p.nome.trim() === pivoAntigo.nome.trim());
                return pivoNovoDaAPI ? { ...pivoAntigo, fora: pivoNovoDaAPI.fora } : pivoAntigo;
            });
            drawPivos(AppState.lastPivosDataDrawn, false);
        }

        if (data.bombas) {
            AppState.lastBombasDataDrawn = AppState.lastBombasDataDrawn.map(bombaAntiga => {
                const bombaNovaDaAPI = findMatchingBomba(data.bombas, bombaAntiga);
                return bombaNovaDaAPI ? { ...bombaAntiga, fora: bombaNovaDaAPI.fora } : bombaAntiga;
            });
            
            drawBombas(AppState.lastBombasDataDrawn);
        }

        atualizarPainelDados();

    } catch (error) {
        console.error("❌ Erro ao reavaliar cobertura via API:", error);
        mostrarMensagem(t('messages.errors.reevaluate_fail', { error: error.message }), "erro");
    }
}

function removePositioningMarker() {
    if (AppState.marcadorPosicionamento && map.hasLayer(AppState.marcadorPosicionamento)) {
        map.removeLayer(AppState.marcadorPosicionamento);
        AppState.marcadorPosicionamento = null;
    }
}

function createEditablePivotMarker(pivoInfo) {
    const nome = pivoInfo.nome;
    const currentLatLng = L.latLng(pivoInfo.lat, pivoInfo.lon);
    const undoButton = document.getElementById("desfazer-edicao");

    const editMarkerIcon = L.divIcon({
        className: 'pivo-edit-handle-custom-pin',
        html: `<svg viewBox="0 0 28 40" width="18" height="26" xmlns="http://www.w3.org/2000/svg"><path d="M14 0 C7.486 0 2 5.486 2 12.014 C2 20.014 14 40 14 40 C14 40 26 20.014 26 12.014 C26 5.486 20.514 0 14 0 Z M14 18 C10.686 18 8 15.314 8 12 C8 8.686 10.686 6 14 6 C17.314 6 20 8.686 20 12 C20 15.314 17.314 18 14 18 Z" fill="#FF3333" stroke="#660000" stroke-width="1"/></svg>`,
        iconSize: [18, 26],
        iconAnchor: [9, 26]
    });
    const editMarker = L.marker(currentLatLng, { draggable: true, icon: editMarkerIcon }).addTo(map);
    AppState.pivotsMap[nome] = editMarker;

    let lastDragPosition = null;
    let originalPivotDataForHistory = null;

    editMarker.on("dragstart", (e) => {
        lastDragPosition = e.target.getLatLng().clone();
        const pivoEmLastData = AppState.lastPivosDataDrawn.find(p => p.nome === nome);
        if (pivoEmLastData) {
            originalPivotDataForHistory = JSON.parse(JSON.stringify(pivoEmLastData));
        }
    });

    editMarker.on("drag", (e) => {
        const pivoEmLastData = AppState.lastPivosDataDrawn.find(p => p.nome === nome);
        if (!pivoEmLastData || !lastDragPosition) return;

        const currentPos = e.target.getLatLng();

        if (!AppState.modoMoverPivoSemCirculo) {
            if (pivoEmLastData.tipo === 'custom' && pivoEmLastData.coordenadas) {
                const latOffset = currentPos.lat - lastDragPosition.lat;
                const lonOffset = currentPos.lng - lastDragPosition.lng;
                pivoEmLastData.coordenadas = pivoEmLastData.coordenadas.map(coord => [coord[0] + latOffset, coord[1] + lonOffset]);
            }

            if (pivoEmLastData.circle_center_lat !== undefined) {
                pivoEmLastData.circle_center_lat = currentPos.lat;
                pivoEmLastData.circle_center_lon = currentPos.lng;
            }
        }

        drawCirculos();

        lastDragPosition = currentPos.clone();
    });

    editMarker.on("dragend", async (e) => {
        const novaPos = e.target.getLatLng();
        const pivoEmLastData = AppState.lastPivosDataDrawn.find(p => p.nome === nome);

        if (pivoEmLastData && originalPivotDataForHistory) {
            const historyEntry = {
                type: 'move',
                pivotName: nome,
                from: { lat: originalPivotDataForHistory.lat, lon: originalPivotDataForHistory.lon },
                previousCoordenadas: originalPivotDataForHistory.coordenadas || null,
                previousCircleCenter: (originalPivotDataForHistory.circle_center_lat !== undefined)
                    ? { lat: originalPivotDataForHistory.circle_center_lat, lon: originalPivotDataForHistory.circle_center_lon }
                    : null
            };
            AppState.historyStack.push(historyEntry);
            if (undoButton) undoButton.disabled = false;
        }

        pivoEmLastData.lat = novaPos.lat;
        pivoEmLastData.lon = novaPos.lng;

        lastDragPosition = null;
        originalPivotDataForHistory = null;

        drawCirculos();
    });

    editMarker.on("contextmenu", async (e) => {
        L.DomEvent.stop(e);
        if (!AppState.modoEdicaoPivos) return;

        const confirmed = await showCustomConfirm(t('messages.confirm.remove_pivot', { name: nome }));
        if (confirmed) {
            const pivoParaDeletar = AppState.lastPivosDataDrawn.find(p => p.nome === nome);
            const nomeCicloParaDeletar = `Ciclo ${nome}`;
            const cicloParaDeletar = AppState.ciclosGlobais.find(c => c.nome_original_circulo === nomeCicloParaDeletar);

            if (pivoParaDeletar) {
                const historyEntry = {
                    type: 'delete',
                    deletedPivot: { ...pivoParaDeletar },
                    deletedCiclo: cicloParaDeletar ? { ...cicloParaDeletar } : null
                };
                AppState.historyStack.push(historyEntry);
                if (undoButton) undoButton.disabled = false;
            }

            map.removeLayer(editMarker);
            AppState.lastPivosDataDrawn = AppState.lastPivosDataDrawn.filter(p => p.nome !== nome);
            AppState.ciclosGlobais = AppState.ciclosGlobais.filter(c => c.nome_original_circulo !== nomeCicloParaDeletar);
            drawCirculos();
            delete AppState.pivotsMap[nome];

            mostrarMensagem(t('messages.success.pivot_removed', { name: nome }), "sucesso");
            atualizarPainelDados();
        }
    });
}

function enablePivoEditingMode() {
    AppState.modoEdicaoPivos = true;
    console.log("✏️ Ativando modo de edição.");

    AppState.historyStack = [];
    const undoButton = document.getElementById("desfazer-edicao");
    if (undoButton) undoButton.disabled = true;

    AppState.marcadoresPivos.forEach(m => map.removeLayer(m));
    AppState.marcadoresPivos = [];
    AppState.marcadoresLegenda.filter(l => l.options.labelType === 'pivot').forEach(l => map.hasLayer(l) && map.removeLayer(l));
    AppState.marcadoresLegenda = AppState.marcadoresLegenda.filter(l => l.options.labelType !== 'pivot');
    Object.values(AppState.pivotsMap).forEach(marker => marker && map.hasLayer(marker) && map.removeLayer(marker));
    AppState.pivotsMap = {};

    AppState.lastPivosDataDrawn.forEach(pivoInfo => {
        createEditablePivotMarker(pivoInfo);
    });

    mostrarMensagem(t('messages.info.edit_mode_activated'), "sucesso");
}

function disablePivoEditingMode() {
    console.log("💾 Salvando e desativando modo de edição.");

    AppState.modoEdicaoPivos = false;

    Object.values(AppState.pivotsMap).forEach(editMarker => {
        if (editMarker && map.hasLayer(editMarker)) {
            map.removeLayer(editMarker);
        }
    });

    AppState.pivotsMap = {};
    drawPivos(AppState.lastPivosDataDrawn, false);
    mostrarMensagem(t('messages.info.positions_updated_resimulate'), "sucesso");
    AppState.historyStack = [];
    const undoButton = document.getElementById("desfazer-edicao");
    if (undoButton) {
        undoButton.disabled = true;
        undoButton.classList.add("hidden");
    }

    const editButton = document.getElementById("editar-pivos");
    if (editButton) {
        editButton.classList.remove('glass-button-active');
        editButton.innerHTML = `<i data-lucide="pencil" class="w-5 h-5"></i>`;
        lucide?.createIcons?.();
    }
}

function desfazerUltimaAcao() {
    if (AppState.historyStack.length === 0) {
        mostrarMensagem(t('messages.info.nothing_to_undo'), "info");
        return;
    }

    const lastAction = AppState.historyStack.pop();
    const undoButton = document.getElementById("desfazer-edicao");

    if (lastAction.type === 'move') {
        const { pivotName, from, previousCircleCenter, previousCoordenadas } = lastAction;
        const pivoEmLastData = AppState.lastPivosDataDrawn.find(p => p.nome === pivotName);
        const editMarker = AppState.pivotsMap[pivotName];

        if (pivoEmLastData && editMarker) {
            const posicaoOriginalLatLng = L.latLng(from.lat, from.lon);

            pivoEmLastData.lat = from.lat;
            pivoEmLastData.lon = from.lon;

            if (previousCircleCenter) {
                pivoEmLastData.circle_center_lat = previousCircleCenter.lat;
                pivoEmLastData.circle_center_lon = previousCircleCenter.lon;
            }

            if (previousCoordenadas) {
                pivoEmLastData.coordenadas = previousCoordenadas;
            }

            editMarker.setLatLng(posicaoOriginalLatLng);
            drawCirculos();

            mostrarMensagem(t('messages.success.action_undone_move', { pivot_name: pivotName }), "sucesso");
        }
    } else if (lastAction.type === 'delete') {
        const { deletedPivot, deletedCiclo } = lastAction;
        AppState.lastPivosDataDrawn.push(deletedPivot);
        if (deletedCiclo) {
            AppState.ciclosGlobais.push(deletedCiclo);
        }
        createEditablePivotMarker(deletedPivot);
        drawCirculos();
        atualizarPainelDados();
        mostrarMensagem(t('messages.success.action_undone_delete', { pivot_name: deletedPivot.nome }), "sucesso");
    }

    if (undoButton && AppState.historyStack.length === 0) {
        undoButton.disabled = true;
    }
}

function toggleLoSPivotAPivotMode() {
    const isActivating = !AppState.modoLoSPivotAPivot;

    if (isActivating) {
        deactivateAllModes();
    }

    AppState.modoLoSPivotAPivot = isActivating;
    document.getElementById('btn-los-pivot-a-pivot')?.classList.toggle('glass-button-active', AppState.modoLoSPivotAPivot);

    if (isActivating) {
        mostrarMensagem(t('messages.info.los_mode_step1_source'), "sucesso");
        if (AppState.marcadorPosicionamento) removePositioningMarker();
        document.getElementById("painel-repetidora")?.classList.add("hidden");
        AppState.losSourcePivot = null;
        AppState.losTargetPivot = null;
        map.getContainer().style.cursor = 'help';
    } else {
        mostrarMensagem(t('messages.info.los_mode_deactivated'), "sucesso");
        AppState.losSourcePivot = null;
        AppState.losTargetPivot = null;
        map.getContainer().style.cursor = '';
        if (AppState.visadaLayerGroup) {
            AppState.visadaLayerGroup.clearLayers();
            AppState.linhasDiagnostico = [];
            AppState.marcadoresBloqueio = [];
        }
    }
}

async function handleLoSTargetClick(itemData, itemMarker) {
    if (!AppState.modoLoSPivotAPivot) return;

    const PIVOT_DEFAULT_SOURCE_HEIGHT = 5;
    const defaultReceiverHeight = (AppState.antenaGlobal?.altura_receiver) ?? 3;

    if (!AppState.losSourcePivot) {
        let sourceHeight;
        let sourceIsMainAntenna = false;
        let sourceType = 'pivot';

        if (itemData.id) {
            if (itemData.id === 'main_antenna' || (AppState.antenaGlobal && itemData.id === AppState.antenaGlobal.id)) {
                sourceHeight = AppState.antenaGlobal.altura;
                sourceIsMainAntenna = true;
                sourceType = AppState.antenaGlobal.type;
            } else {
                const rep = AppState.repetidoras.find(r => r.id === itemData.id);
                if (rep) {
                    sourceHeight = rep.altura;
                    sourceType = rep.type;
                } else {
                    sourceHeight = PIVOT_DEFAULT_SOURCE_HEIGHT;
                }
            }
        } else {
            sourceHeight = PIVOT_DEFAULT_SOURCE_HEIGHT;
        }

        AppState.losSourcePivot = {
            ...itemData,
            latlng: itemMarker.getLatLng(),
            altura: sourceHeight,
            isMainAntenna: sourceIsMainAntenna,
            type: sourceType
        };
        
        mostrarMensagem(t('messages.info.los_source_selected', { name: itemData.nome }), "sucesso");
        return; 
    }

    const sourceData = AppState.losSourcePivot;
    const targetData = {
        ...itemData,
        latlng: itemMarker.getLatLng()
    };

    if (sourceData.nome === targetData.nome) {
        mostrarMensagem(t('messages.info.los_source_already_selected', { name: itemData.nome }), "info");
        return;
    }

    let transmitter, receiver;
    const sourceHasSignal = sourceData.fora === false || sourceData.id;
    const targetHasSignal = targetData.fora === false || itemData.id;

    if (!sourceHasSignal && !targetHasSignal) {
        mostrarMensagem(t('messages.errors.los_need_one_signal_source'), "erro");
        AppState.losSourcePivot = null; 
        return;
    }

    if (sourceHasSignal) {
        transmitter = sourceData;
        receiver = targetData;
    } else {
        transmitter = targetData;
        receiver = sourceData;
    }

    transmitter.altura = transmitter.altura || (transmitter.id ? AppState.antenaGlobal?.altura : PIVOT_DEFAULT_SOURCE_HEIGHT);
    receiver.altura = defaultReceiverHeight;

    mostrarLoader(true);
    let ocorreuErroNaAnalise = false;
    try {
        if (typeof setVisadaVisible === 'function') setVisadaVisible(true);

        const distanciaEntreAlvos = transmitter.latlng.distanceTo(receiver.latlng);
        const distanciaFormatada = distanciaEntreAlvos > 999 ? (distanciaEntreAlvos / 1000).toFixed(1) + ' km' : Math.round(distanciaEntreAlvos) + ' m';

        const payload = {
            pontos: [
                [transmitter.latlng.lat, transmitter.latlng.lng],
                [receiver.latlng.lat, receiver.latlng.lng]
            ],
            altura_antena: transmitter.altura,
            altura_receiver: receiver.altura,
            return_highest_point: true
        };
        const resultadoApi = await getElevationProfile(payload);
        const estaBloqueado = resultadoApi.bloqueio?.diff > 0.1;

        if (window.Analysis3D && typeof window.Analysis3D.show === 'function') {
            const featuresToDraw = {
                pivos: AppState.lastPivosDataDrawn,
                ciclos: AppState.ciclosGlobais,
                antena: AppState.antenaGlobal,
                repetidoras: AppState.repetidoras
            };
            window.Analysis3D.show(resultadoApi, payload.altura_antena, payload.altura_receiver, featuresToDraw);
        }

        const sourceDisplayName = getFormattedAntennaOrRepeaterName(transmitter);
        const featuresToDraw = {
            pivos: AppState.lastPivosDataDrawn,
            ciclos: AppState.ciclosGlobais,
            antena: AppState.antenaGlobal,
            repetidoras: AppState.repetidoras
        };
        drawDiagnostico(payload.pontos[0], payload.pontos[1], resultadoApi.bloqueio, resultadoApi.ponto_mais_alto, `${sourceDisplayName} → ${receiver.nome}`, distanciaFormatada, resultadoApi, payload, featuresToDraw);

        let statusKey = 'los_result_clear';
        if (estaBloqueado) statusKey = 'los_result_blocked';
        else if (resultadoApi.bloqueio) statusKey = 'los_result_clear_critical';

        mostrarMensagem(t(`messages.info.${statusKey}`, { source: sourceDisplayName, target: receiver.nome, distance: distanciaFormatada }), estaBloqueado ? "erro" : "sucesso");

    } catch (error) {
        ocorreuErroNaAnalise = true;
        console.error(`Erro no diagnóstico LoS Alvo a Alvo:`, error);
        mostrarMensagem(t('messages.info.los_result_error', { source: transmitter?.nome || 'Origem', target: receiver?.nome || 'Destino', distance: "N/A", error: error.message }), "erro");
    } finally {
        mostrarLoader(false);
        AppState.losSourcePivot = null; 
        if (AppState.modoLoSPivotAPivot) setTimeout(() => { if (AppState.modoLoSPivotAPivot) mostrarMensagem(t('messages.info.los_new_source_prompt'), "info"); }, ocorreuErroNaAnalise ? 700 : 1800);
    }
}

function handleToggleDistanciasPivos() {
    AppState.distanciasPivosVisiveis = !AppState.distanciasPivosVisiveis;
    const btn = document.getElementById('toggle-distancias-pivos');
    if (btn) {
        btn.classList.toggle('glass-button-active', AppState.distanciasPivosVisiveis);
        btn.title = AppState.distanciasPivosVisiveis ? t('ui.titles.hide_pivot_distances') : t('ui.titles.show_pivot_distances');
    }
    togglePivoDistances(AppState.distanciasPivosVisiveis);
}

function handleCancelDraw(e) {
    let drawCancelled = false;
    let messageKey = '';

    if (AppState.modoDesenhoPivo && AppState.centroPivoTemporario) {
        if (typeof removeTempCircle === 'function') removeTempCircle();
        removeDrawingTooltip(map);
        messageKey = 'messages.info.draw_pivot_cancelled';
        drawCancelled = true;
    } else if (AppState.modoDesenhoPivoSetorial && AppState.centroPivoTemporario) {
        if (typeof removeTempSector === 'function') removeTempSector();
        removeDrawingTooltip(map);
        messageKey = 'messages.info.draw_sector_cancelled';
        drawCancelled = true;
    } else if (AppState.modoDesenhoPivoPacman && AppState.centroPivoTemporario) {
        if (typeof removeTempPacman === 'function') removeTempPacman();
        removeDrawingTooltip(map);
        messageKey = 'messages.info.draw_pacman_cancelled';
        drawCancelled = true;
    }

    if (drawCancelled) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);

        console.log("✏️ Ação de desenho cancelada pelo usuário.");
        AppState.centroPivoTemporario = null;
        AppState.pontoRaioTemporario = null;

        if (messageKey) {
            mostrarMensagem(t(messageKey), "info");
        }
    }
}

function parseCoordinates(coordString) {
    coordString = coordString.trim();
    const dmsToDd = (degrees, minutes, seconds, direction) => {
        let dd = parseFloat(degrees) + parseFloat(minutes) / 60 + parseFloat(seconds) / 3600;
        if (direction === 'S' || direction === 'W') dd = dd * -1;
        return dd;
    };
    const dmsRegex = /^(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([NS])\s*,?\s*(\d{1,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([WE])$/i;
    const dmsMatch = coordString.match(dmsRegex);
    if (dmsMatch) {
        try {
            const lat = dmsToDd(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4].toUpperCase());
            const lon = dmsToDd(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8].toUpperCase());
            if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
        } catch (e) {
            console.error("Erro ao converter DMS:", e);
            return null;
        }
    }
    const cleanedString = coordString.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = cleanedString.split(' ');
    if (parts.length === 2) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            return { lat, lon };
        }
    }
    return null;
}

function handleCoordinateSearch() {
    const inputField = document.getElementById('lat-long-input-field');
    const coordString = inputField.value;

    if (!coordString) {
        mostrarMensagem(t('messages.errors.coordinate_input_empty'), "erro");
        return;
    }
    const coords = parseCoordinates(coordString);

    if (coords) {
        const latlng = L.latLng(coords.lat, coords.lon);
        removePositioningMarker();
        AppState.marcadorPosicionamento = L.marker(latlng, { icon: antenaIcon, interactive: true }).addTo(map);
        map.setView(latlng, 15);
        mostrarMensagem(t('messages.success.location_found'), "sucesso");
        AppState.coordenadaClicada = latlng;
        document.getElementById("painel-repetidora")?.classList.remove("hidden");
        inputField.value = '';
    } else {
        mostrarMensagem(t('messages.errors.invalid_coordinate_format'), "erro");
    }
}

function getNextPivotNumber() {
    let maxNumber = 0;
    const pivotLocalized = escapeRegExp(t('entity_names.pivot') || 'Pivô');
    const regex = new RegExp(`(?:${pivotLocalized}|Pivô|Pivot|Pivote)\\s+(\\d+)$`, 'i');

    AppState.lastPivosDataDrawn.forEach(pivo => {
        const match = pivo.nome.match(regex);
        if (match && match[1]) {
            const currentNumber = parseInt(match[1], 10);
            if (currentNumber > maxNumber) {
                maxNumber = currentNumber;
            }
        }
    });
    return maxNumber + 1;
}

function toggleModoDesenhoPivoSetorial() {
    const isActivating = !AppState.modoDesenhoPivoSetorial;

    if (isActivating) {
        deactivateAllModes();
    }

    AppState.modoDesenhoPivoSetorial = isActivating;
    document.getElementById('btn-draw-pivot-setorial')?.classList.toggle('glass-button-active', AppState.modoDesenhoPivoSetorial);

    if (isActivating) {
        map.getContainer().style.cursor = 'crosshair';
        map.on('click', handleSectorialPivotDrawClick);
        map.on('mousemove', handleSectorialDrawMouseMove);
        mostrarMensagem(t('messages.info.draw_sector_pivot_step1'), "info");
    } else {
        map.getContainer().style.cursor = '';
        map.off('click', handleSectorialPivotDrawClick);
        map.off('mousemove', handleSectorialDrawMouseMove);
        AppState.centroPivoTemporario = null;
        if (typeof removeTempSector === 'function') removeTempSector();
        mostrarMensagem(t('messages.info.draw_sector_pivot_off'), "sucesso");
    }
}

async function handleSectorialPivotDrawClick(e) {
    if (!AppState.modoDesenhoPivoSetorial) return;

    if (!AppState.centroPivoTemporario) {
        AppState.centroPivoTemporario = e.latlng;
        mostrarMensagem(t('messages.info.draw_sector_pivot_step2'), "info");
        return;
    }

    const finalPoint = e.latlng;
    const radius = AppState.centroPivoTemporario.distanceTo(finalPoint);

    if (typeof removeTempSector === 'function') {
        removeTempSector();
    }

    if (radius < 10) {
        AppState.centroPivoTemporario = null;
        mostrarMensagem(t('messages.errors.draw_pivot_radius_too_small'), "erro");
        return;
    }

    mostrarLoader(true);
    try {
        const bearing = calculateBearing(AppState.centroPivoTemporario, e.latlng);
        const novoNumero = getNextPivotNumber();
        const novoNome = `${t('entity_names.pivot')} ${novoNumero}`;

        const novoPivo = {
            nome: novoNome,
            lat: AppState.centroPivoTemporario.lat,
            lon: AppState.centroPivoTemporario.lng,
            fora: true,
            tipo: 'setorial',
            raio: AppState.centroPivoTemporario.distanceTo(e.latlng),
            angulo_central: bearing,
            abertura_arco: 180,
            circle_center_lat: AppState.centroPivoTemporario.lat,
            circle_center_lon: AppState.centroPivoTemporario.lng
        };

        AppState.lastPivosDataDrawn.push(novoPivo);

        const novoCiclo = {
            nome_original_circulo: `Ciclo ${novoPivo.nome}`,
            coordenadas: []
        };
        AppState.ciclosGlobais.push(novoCiclo);

        atualizarPainelDados();
        if (typeof drawPivos === 'function') drawPivos(AppState.lastPivosDataDrawn, false);
        if (typeof drawCirculos === 'function') drawCirculos(AppState.ciclosGlobais);

        await reavaliarPivosViaAPI();

        mostrarMensagem(t('messages.success.sector_pivot_created', { name: novoPivo.nome }), "sucesso");

    } catch (error) {
        console.error("Erro ao criar pivô setorial:", error);
        mostrarMensagem(t('messages.errors.generic_error', { error: error.message }), "erro");
    } finally {
        AppState.centroPivoTemporario = null;
        removeDrawingTooltip(map);
        mostrarLoader(false);

        setTimeout(() => {
            if (AppState.modoDesenhoPivoSetorial) {
                mostrarMensagem(t('messages.info.draw_sector_pivot_still_active'), "info");
            }
        }, 2000);
    }
}

function handleSectorialDrawMouseMove(e) {
    if (AppState.modoDesenhoPivoSetorial && AppState.centroPivoTemporario) {
        if (typeof drawTempSector === 'function') {
            drawTempSector(AppState.centroPivoTemporario, e.latlng);
        }

        const distancia = AppState.centroPivoTemporario.distanceTo(e.latlng);
        const textoTooltip = `${t('ui.labels.radius')}: ${distancia.toFixed(1)} m`;
        updateDrawingTooltip(map, e, textoTooltip);
    }
}

function toggleModoDesenhoPivoPacman() {
    const isActivating = !AppState.modoDesenhoPivoPacman;

    if (isActivating) {
        deactivateAllModes();
    }

    AppState.modoDesenhoPivoPacman = isActivating;
    document.getElementById('btn-draw-pivot-pacman')?.classList.toggle('glass-button-active', AppState.modoDesenhoPivoPacman);

    if (isActivating) {
        map.getContainer().style.cursor = 'crosshair';
        map.on('click', handlePacmanPivotDrawClick);
        map.on('mousemove', handlePacmanDrawMouseMove);
        mostrarMensagem(t('messages.info.draw_pacman_step1'), "info");
    } else {
        map.getContainer().style.cursor = '';
        map.off('click', handlePacmanPivotDrawClick);
        map.off('mousemove', handlePacmanDrawMouseMove);
        AppState.centroPivoTemporario = null;
        AppState.pontoRaioTemporario = null;
        if (typeof removeTempPacman === 'function') removeTempPacman();
        mostrarMensagem(t('messages.info.draw_pacman_off'), "sucesso");
    }
}

function handlePacmanDrawMouseMove(e) {
    if (AppState.modoDesenhoPivoPacman && AppState.centroPivoTemporario) {
        if (typeof drawTempPacman === 'function') {
            drawTempPacman(AppState.centroPivoTemporario, AppState.pontoRaioTemporario, e.latlng);
        }

        let textoTooltip = '';
        if (!AppState.pontoRaioTemporario) {
            const distancia = AppState.centroPivoTemporario.distanceTo(e.latlng);
            textoTooltip = `${t('ui.labels.radius')}: ${distancia.toFixed(1)} m`;
        } else {
            const centro = AppState.centroPivoTemporario;
            const raio = centro.distanceTo(AppState.pontoRaioTemporario);
            const anguloInicio = calculateBearing(centro, AppState.pontoRaioTemporario);
            const anguloFim = calculateBearing(centro, e.latlng);
            let abertura = anguloFim - anguloInicio;
            if (abertura < 0) abertura += 360;
            textoTooltip = `${t('ui.labels.dry_angle')}: ${abertura.toFixed(1)}°`;
        }
        updateDrawingTooltip(map, e, textoTooltip);
    }
}

async function handlePacmanPivotDrawClick(e) {
    if (!AppState.modoDesenhoPivoPacman) return;

    if (!AppState.centroPivoTemporario) {
        AppState.centroPivoTemporario = e.latlng;
        mostrarMensagem(t('messages.info.draw_pacman_step2'), "info");
        return;
    }

    if (!AppState.pontoRaioTemporario) {
        AppState.pontoRaioTemporario = e.latlng;
        mostrarMensagem(t('messages.info.draw_pacman_step3'), "info");
        return;
    }

    const finalPoint = e.latlng;
    mostrarLoader(true);

    try {
        const centro = AppState.centroPivoTemporario;
        const raio = centro.distanceTo(AppState.pontoRaioTemporario);

        if (raio < 10) {
            throw new Error(t('messages.errors.draw_pivot_radius_too_small'));
        }

        const anguloInicio = calculateBearing(centro, AppState.pontoRaioTemporario);
        const anguloFim = calculateBearing(centro, finalPoint);

        const novoNumero = getNextPivotNumber();
        const novoNome = `${t('entity_names.pivot')} ${novoNumero}`;

        const novoPivo = {
            nome: novoNome,
            lat: centro.lat,
            lon: centro.lng,
            fora: true,
            tipo: 'pacman',
            raio: raio,
            angulo_inicio: anguloInicio,
            angulo_fim: anguloFim,
            circle_center_lat: centro.lat,
            circle_center_lon: centro.lng
        };

        AppState.lastPivosDataDrawn.push(novoPivo);

        const novoCiclo = {
            nome_original_circulo: `Ciclo ${novoPivo.nome}`,
            coordenadas: []
        };
        AppState.ciclosGlobais.push(novoCiclo);

        drawPivos(AppState.lastPivosDataDrawn, false);
        drawCirculos(AppState.ciclosGlobais);

        await reavaliarPivosViaAPI();
        mostrarMensagem(t('messages.success.pacman_pivot_created', { name: novoPivo.nome }), "sucesso");

    } catch (error) {
        console.error("Erro ao criar pivô Pac-Man:", error);
        mostrarMensagem(error.message, "erro");
    } finally {
        AppState.centroPivoTemporario = null;
        AppState.pontoRaioTemporario = null;
        if (typeof removeTempPacman === 'function') removeTempPacman();

        removeDrawingTooltip(map);
        mostrarLoader(false);

        setTimeout(() => {
            if (AppState.modoDesenhoPivoPacman) {
                mostrarMensagem(t('messages.info.draw_pacman_still_active'), "info");
            }
        }, 2500);
    }
}

function toggleModoDesenhoIrripump() {
    const isActivating = !AppState.modoDesenhoIrripump;

    if (isActivating) {
        deactivateAllModes();
    }

    AppState.modoDesenhoIrripump = isActivating;
    document.getElementById('btn-draw-irripump')?.classList.toggle('glass-button-active', AppState.modoDesenhoIrripump);

    if (isActivating) {
        map.getContainer().style.cursor = 'crosshair';
        mostrarMensagem(t('messages.info.draw_irripump_step1'), "info");
    } else {
        map.getContainer().style.cursor = '';
        mostrarMensagem(t('messages.info.draw_irripump_off'), "sucesso");
    }
}

function handleSpecialMarkerSelection(marker) {
    if (AppState.selectedPivoNome) {
        const pivoMarker = AppState.pivotsMap[AppState.selectedPivoNome];
        pivoMarker?.getElement()?.classList.remove('pivo-marker-container-selected');
        AppState.selectedPivoNome = null;
    }

    const currentSelected = AppState.selectedSpecialMarker;
    const markerElement = marker.getElement();

    if (currentSelected && currentSelected !== marker) {
        currentSelected.getElement()?.classList.remove('marker-selected');
    }

    if (markerElement) {
        if (markerElement.classList.contains('marker-selected')) {
            markerElement.classList.remove('marker-selected');
            AppState.selectedSpecialMarker = null;
        } else {
            markerElement.classList.add('marker-selected');
            AppState.selectedSpecialMarker = marker;
        }
    }
}

function deselectAllMarkers() {
    if (AppState.selectedPivoNome) {
        const pivoMarker = AppState.pivotsMap[AppState.selectedPivoNome];
        pivoMarker?.getElement()?.classList.remove('pivo-marker-container-selected');
        AppState.selectedPivoNome = null;
    }
    if (AppState.selectedSpecialMarker) {
        AppState.selectedSpecialMarker.getElement()?.classList.remove('marker-selected');
        AppState.selectedSpecialMarker = null;
    }
}

function handleGlobalKeys(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }

    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        focusOnFarm();
        return;
    }

    if (e.key === 'Escape') {
        let cancelledSomething = false;

        if (AppState.modoDesenhoPivo || AppState.modoDesenhoPivoSetorial || AppState.modoDesenhoPivoPacman || AppState.modoDesenhoIrripump) {
            deactivateAllModes();
            cancelledSomething = true;
        }

        if (cancelledSomething) {
            e.preventDefault();
            e.stopPropagation();
            mostrarMensagem(t('messages.info.drawing_modes_cancelled_by_esc'), "info");
        }

        if (AppState.modoLoSPivotAPivot) {
            toggleLoSPivotAPivotMode();
        }
        if (AppState.modoBuscaLocalRepetidora) {
            handleBuscarLocaisRepetidoraActivation();
        }
        if (AppState.marcadorPosicionamento) {
            removePositioningMarker();
            document.getElementById("painel-repetidora")?.classList.add("hidden");
        }

        deselectAllMarkers();
        if (map) map.getContainer().style.cursor = '';
    }
}

function focusOnFarm() {
    const boundsToFit = [];

    if (AppState.lastPivosDataDrawn) {
        AppState.lastPivosDataDrawn.forEach(p => boundsToFit.push([p.lat, p.lon]));
    }
    if (AppState.lastBombasDataDrawn) {
        AppState.lastBombasDataDrawn.forEach(b => boundsToFit.push([b.lat, b.lon]));
    }
    if (AppState.repetidoras) {
        AppState.repetidoras.forEach(r => boundsToFit.push([r.lat, r.lon]));
    }
    if (AppState.antenaGlobal) {
        boundsToFit.push([AppState.antenaGlobal.lat, AppState.antenaGlobal.lon]);
    }

    if (boundsToFit.length > 0) {
        const bounds = L.latLngBounds(boundsToFit);
        map.fitBounds(bounds, { padding: [70, 70] });
    }
}

function toggleModoMoverPivoSemCirculo() {
    const isActivating = !AppState.modoMoverPivoSemCirculo;
    AppState.modoMoverPivoSemCirculo = isActivating;

    const btn = document.getElementById('btn-mover-pivo-sem-circulo');
    if (btn) {
        btn.classList.toggle('glass-button-active', isActivating);
    }

    if (isActivating) {
        mostrarMensagem(t('messages.info.move_pivot_center_on'), "sucesso");
    } else {
        mostrarMensagem(t('messages.info.move_pivot_center_off'), "sucesso");
    }
}

function updateActionButtonsI18n() {
    try {
        const importLabel = document.querySelector('label[for="arquivo"]');
        if (importLabel) {
            const arquivoInput = document.getElementById('arquivo');
            let titleText = t('tooltips.load_kmz');
            if (arquivoInput && arquivoInput.files && arquivoInput.files.length > 0) {
                titleText = arquivoInput.files[0].name || titleText;
            }

            importLabel.setAttribute('title', titleText);
            importLabel.setAttribute('aria-label', t('ui.labels.choose_kmz'));
        }

        const exportBtn = document.getElementById('exportar-btn');
        if (exportBtn) {
            const tooltipText = t('tooltips.export_kmz');
            exportBtn.setAttribute('title', tooltipText);
            exportBtn.setAttribute('aria-label', t('ui.buttons.export_kmz'));
        }

        const resetBtn = document.getElementById('resetar-btn');
        if (resetBtn) {
            const tooltipText = t('tooltips.reset');
            resetBtn.setAttribute('title', tooltipText);
            resetBtn.setAttribute('aria-label', t('ui.buttons.reset'));
        }
    } catch (_) {
    }
}
