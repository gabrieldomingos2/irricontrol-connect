// ---------------------------------------------------------------
// Suporte a touch para os modos de desenho (pivô circular, setorial
// e Pac-Man). No mouse, o preview do raio/ângulo é atualizado pelo
// evento "mousemove" do Leaflet, que só existe com o ponteiro
// pairando (hover) sem nenhum botão pressionado — não tem
// equivalente em touch (não existe "hover" sem tocar a tela).
//
// Fluxo em touch: 1º toque (tap rápido, sem arrastar) define o
// centro — isso já funciona sozinho, o Leaflet sintetiza um
// "click" normal pra um toque sem movimento. Depois, o usuário
// encosta o dedo de novo e ARRASTA pra ver o círculo/setor
// crescendo em tempo real (repassamos os touchmove pro mesmo
// handler de "mousemove" já existente). Como o dedo se moveu uma
// distância razoável, o Leaflet NÃO sintetiza um "click" ao soltar
// (só faz isso pra toques curtos, sem arrasto) — por isso, ao
// soltar o dedo depois de um arrasto de verdade, chamamos o mesmo
// handler de clique manualmente com a última posição tocada.
// Enquanto dura CADA TOQUE (de touchstart a touchend), desliga o
// arrastar do mapa (map.dragging) pra esse gesto não virar um pan
// do mapa. Importante: isso só acontece dentro dos handlers de
// touch abaixo, nunca de forma incondicional — no desktop (mouse),
// que passa pelas mesmas funções de toggle de modo, o
// map.dragging nunca é tocado por este arquivo.
// ---------------------------------------------------------------
function attachTouchDrawSupport(mouseMoveHandler, clickHandler) {
  if (!map || !map.getContainer) return () => {};

  const container = map.getContainer();

  const TAP_THRESHOLD_PX = 12; // acima disso, foi arrasto, não um toque simples
  let startPoint = null;
  let lastLatLng = null;

  function pointFromTouch(touch) {
    const rect = container.getBoundingClientRect();
    return L.point(touch.clientX - rect.left, touch.clientY - rect.top);
  }

  function onTouchStart(ev) {
    if (!ev.touches || ev.touches.length !== 1) return;
    startPoint = pointFromTouch(ev.touches[0]);
    map.dragging && map.dragging.disable();
  }

  function onTouchMove(ev) {
    if (!ev.touches || ev.touches.length !== 1) return;
    const point = pointFromTouch(ev.touches[0]);
    lastLatLng = map.containerPointToLatLng(point);
    // containerPoint é necessário porque updateDrawingTooltip (ui.js)
    // lê event.containerPoint.x/.y pra posicionar o tooltip — sem
    // isso, handleSectorialDrawMouseMove/handlePacmanDrawMouseMove
    // quebravam com "Cannot read properties of undefined (reading 'x')"
    // assim que o dedo se movia durante o desenho setorial/Pac-Man.
    mouseMoveHandler({ latlng: lastLatLng, containerPoint: point });
    ev.preventDefault();
  }

  function onTouchEnd(ev) {
    const start = startPoint;
    startPoint = null;
    map.dragging && map.dragging.enable();
    if (!start || !lastLatLng) return;

    const endTouch = ev.changedTouches && ev.changedTouches[0];
    const endPoint = endTouch && pointFromTouch(endTouch);
    const movedFar = endPoint && start.distanceTo(endPoint) > TAP_THRESHOLD_PX;

    // Toque curto (sem arrasto real): deixa o "click" sintetizado
    // do próprio Leaflet cuidar, como já acontecia — evita disparo
    // duplicado do handler de clique.
    if (movedFar && clickHandler) {
      clickHandler({ latlng: lastLatLng, containerPoint: endPoint });
      ev.preventDefault();
    }
  }

  function onTouchCancel() {
    // O sistema interrompeu o toque no meio (notificação puxando a
    // tela, ligação chegando etc.) — não finaliza o desenho, só
    // devolve o mapa pro estado normal pra não ficar travado.
    startPoint = null;
    map.dragging && map.dragging.enable();
  }

  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("touchmove", onTouchMove, { passive: false });
  container.addEventListener("touchend", onTouchEnd, { passive: false });
  container.addEventListener("touchcancel", onTouchCancel, { passive: true });

  return function detachTouchDrawSupport() {
    container.removeEventListener("touchstart", onTouchStart);
    container.removeEventListener("touchmove", onTouchMove);
    container.removeEventListener("touchend", onTouchEnd);
    container.removeEventListener("touchcancel", onTouchCancel);
    // Rede de segurança: se o modo for desligado no meio de um
    // toque (ex.: usuário aperta o botão de desenho de novo antes
    // de soltar o dedo), garante que o mapa não fique travado.
    map.dragging && map.dragging.enable();
  };
}

let detachTouchDrawPivo = null;
let detachTouchDrawSetorial = null;
let detachTouchDrawPacman = null;

// Distância padrão (m) do preview tracejado que aparece assim que o
// centro é definido, ANTES de qualquer arrasto. No mouse, mover o
// cursor logo após o clique já atualiza o preview quase que na hora
// (não precisa segurar botão nenhum); no touch não existe esse
// "hover" — sem isso, depois do 1º toque não aparece nada até o
// usuário começar a arrastar de verdade, o que parecia bugado
// ("não desenhou nada"). Um raio inicial pequeno resolve isso pros
// dois: dá feedback imediato e ainda é ajustável arrastando depois.
const DEFAULT_PREVIEW_RADIUS_M = 60;

function defaultTempEdgePoint(center, bearingDeg = 90) {
  return typeof center.destination == "function" ? center.destination(DEFAULT_PREVIEW_RADIUS_M, bearingDeg) : center;
}

// window.MOBILE_BREAKPOINT é definido por mobile.js (que carrega antes
// deste bundle) — usa o mesmo valor em vez de repetir o número aqui.
// O fallback de 768 só entra em jogo se mobile.js não tiver rodado por
// algum motivo. Ainda precisa ficar em sincronia manualmente com o
// `@media (max-width: 768px)` de assets/css/mobile.css (CSS não lê
// constantes de JS).
function isMobileDrawMode() {
  return window.innerWidth <= (window.MOBILE_BREAKPOINT || 768);
}

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
    detachTouchDrawPivo = attachTouchDrawSupport(handlePivotDrawMouseMove, handlePivotDrawClick);
  } else {
    map.getContainer().style.cursor = "";
    AppState.centroPivoTemporario = null;
    typeof removeTempCircle == "function" && removeTempCircle();
    removeDrawingTooltip(map);
    mostrarMensagem(t("messages.info.draw_pivot_off"), "sucesso");
    map.off("click", handlePivotDrawClick);
    map.off("mousemove", handlePivotDrawMouseMove);
    detachTouchDrawPivo && (detachTouchDrawPivo(), detachTouchDrawPivo = null);
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

// Cria o pivô circular de verdade (chamada da API + atualização do
// estado/mapa). Devolve o pivô criado, ou null se deu erro (já
// mostra a mensagem de erro). Chamada pelo 2º toque/clique do fluxo
// de desenho (handlePivotDrawClick), igual no desktop e no mobile.
async function finalizeCircularPivot(center, edge) {
  mostrarLoader(true);
  try {
    const requestPayload = {
      job_id: AppState.jobId,
      center: [center.lat, center.lng],
      pivos_atuais: AppState.lastPivosDataDrawn,
      language: localStorage.getItem("preferredLanguage") || "pt-br"
    };
    const radius = center.distanceTo(edge);
    const newPivot = {
      ...(await generatePivotInCircle(requestPayload)).novo_pivo,
      fora: true,
      raio: radius,
      circle_center_lat: center.lat,
      circle_center_lon: center.lng
    };
    const circleCoords = generateCircleCoords(center, radius);
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
    // No mobile pulamos o "drawPivos" (redesenho em modo círculo
    // fixo/não editável): quem chamou esta função vai deixar tudo
    // editável de novo logo em seguida (enablePivoEditingMode), e
    // chamar drawPivos aqui no meio sobrescreveria o pino/alça dos
    // OUTROS pivôs que já estavam editáveis antes deste novo.
    (typeof isMobileDrawMode == "function" && isMobileDrawMode()) || drawPivos(AppState.lastPivosDataDrawn, false);
    drawCirculos(AppState.ciclosGlobais);
    await reavaliarPivosViaAPI();
    mostrarMensagem(t("messages.success.pivot_created", { name: newPivot.nome }), "sucesso");
    return newPivot;
  } catch (err) {
    console.error("Falha ao criar o pivô:", err);
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
    typeof removeTempCircle == "function" && removeTempCircle();
    return null;
  } finally {
    mostrarLoader(false);
    removeDrawingTooltip(map);
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
    // 1º toque/clique define o centro e já mostra um tracejado padrão
    // pra dar feedback imediato — mas quem confirma o tamanho de
    // verdade é o 2º toque (ou arrastar o dedo antes de soltar, via
    // attachTouchDrawSupport). Igual no desktop e no mobile: assim dá
    // pra ajustar o raio arrastando o próprio desenho ANTES de criar
    // o pivô, em vez de só depois via alça de edição.
    AppState.centroPivoTemporario = event.latlng;
    typeof drawTempCircle == "function" && drawTempCircle(AppState.centroPivoTemporario, defaultTempEdgePoint(AppState.centroPivoTemporario));
    mostrarMensagem(t("messages.info.draw_pivot_step2"), "info");
    return;
  }

  const created = await finalizeCircularPivot(AppState.centroPivoTemporario, event.latlng);
  AppState.centroPivoTemporario = null;
  if (created) {
    finishPivotDrawConfirmation(() => AppState.modoDesenhoPivo, toggleModoDesenhoPivo, "draw_pivot_still_active");
  }
}

// Depois de confirmar um pivô (2º toque/clique, ou 3º no caso do
// Pac-Man): no mobile desliga o modo de desenho e já entra no modo de
// edição (pino/alça arrastáveis) — arrastar é mais natural em touch do
// que reabrir o menu de ferramentas pra ajustar o tamanho depois. No
// desktop mantém o modo de desenho ativo pra permitir desenhar vários
// pivôs em sequência, só reforçando com uma mensagem que ele continua
// ligado.
function finishPivotDrawConfirmation(isModeStillActive, toggleModeFn, stillActiveMessageKey) {
  if (isMobileDrawMode()) {
    isModeStillActive() && toggleModeFn();
    if (!AppState.modoEdicaoPivos) {
      typeof togglePivoEditing == "function" && togglePivoEditing();
    } else {
      typeof enablePivoEditingMode == "function" && enablePivoEditingMode();
    }
    return;
  }
  setTimeout(() => {
    isModeStillActive() && mostrarMensagem(t(`messages.info.${stillActiveMessageKey}`), "info");
  }, 2500);
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
      // No mobile, se a edição estiver ligada, redesenha tudo como
      // editável em vez do modo "plano" — senão essa chamada (que
      // roda toda vez que reavalia a cobertura, inclusive logo
      // depois de criar um pivô novo) apagava o pino/alça dos pivôs
      // que já estavam editáveis.
      if ((typeof isMobileDrawMode == "function" && isMobileDrawMode()) && AppState.modoEdicaoPivos) {
        typeof enablePivoEditingMode == "function" && enablePivoEditingMode();
      } else {
        drawPivos(AppState.lastPivosDataDrawn, false);
      }
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

function _normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360;
}

// Em que ângulo (a partir do centro) a alça de raio deve ficar. Pra
// setorial/pacman ela fica na BORDA do arco (não fixa a leste como o
// circular), porque agora arrastá-la também gira o desenho inteiro —
// ver createResizeHandle.
function _getResizeHandleBearing(pivot) {
  if (pivot.tipo === "setorial") return _normalizeAngle((pivot.angulo_central || 0) + (pivot.abertura_arco || 180) / 2);
  if (pivot.tipo === "pacman") return _normalizeAngle(pivot.angulo_fim || 0);
  return 90;
}

// Exclui um pivô editável do mapa, pedindo confirmação antes. Usada
// pelo "botão direito" do mouse (contextmenu) — em touch, o próprio
// navegador sintetiza um "contextmenu" a partir de um toque longo,
// então o mesmo handler cobre os dois sem código extra.
async function confirmAndDeletePivot(name, marker, undoBtn) {
  if (!(await showCustomConfirm(t("messages.confirm.remove_pivot", { name })))) return;

  const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
  const cicloName = `Ciclo ${name}`;
  const ciclo = AppState.ciclosGlobais.find((c) => c.nome_original_circulo === cicloName);

  if (pivot) {
    AppState.historyStack.push({
      type: "delete",
      deletedPivot: { ...pivot },
      deletedCiclo: ciclo ? { ...ciclo } : null
    });
    undoBtn && (undoBtn.disabled = false);
  }

  map.removeLayer(marker);
  AppState.lastPivosDataDrawn = AppState.lastPivosDataDrawn.filter((p) => p.nome !== name);
  AppState.ciclosGlobais = AppState.ciclosGlobais.filter((c) => c.nome_original_circulo !== cicloName);
  drawCirculos();
  delete AppState.pivotsMap[name];

  // A alça laranja de raio é um marcador À PARTE do pino do centro —
  // sem isso, ela ficava esquecida no mapa (e em AppState.resizeHandlesMap)
  // depois de excluir o pivô, mesmo com o pino já removido.
  const resizeHandle = (AppState.resizeHandlesMap || {})[name];
  if (resizeHandle) {
    map.hasLayer(resizeHandle) && map.removeLayer(resizeHandle);
    delete AppState.resizeHandlesMap[name];
  }

  mostrarMensagem(t("messages.success.pivot_removed", { name }), "sucesso");
  atualizarPainelDados();
}

// Exclui o ÚLTIMO pivô criado (fim de AppState.lastPivosDataDrawn).
// Não está ligada a nenhum botão no momento (o toque longo nativo do
// navegador em cima do pivô, que já dispara "contextmenu", cobre a
// exclusão no mobile) — fica exposta em window.deleteLastDrawnPivot
// pra uso futuro se precisar de novo.
//
// Ao contrário de confirmAndDeletePivot (que exige um marcador
// editável em tela), esta função sempre remove do estado/mapa
// diretamente e, se existir, também tira o marcador editável e a
// alça de raio — funciona tanto dentro quanto fora do modo de
// edição. Tudo dentro de um try/catch com mensagem de erro visível:
// antes, qualquer falha (ex.: reavaliarPivosViaAPI sem conexão)
// quebrava a função silenciosamente e parecia que o botão não
// fazia nada.
async function deleteLastDrawnPivot() {
  const pivots = AppState.lastPivosDataDrawn || [];
  if (pivots.length === 0) {
    mostrarMensagem(t("messages.info.nothing_to_undo"), "info");
    return;
  }

  const last = pivots[pivots.length - 1];
  const name = last.nome;
  const undoBtn = document.getElementById("desfazer-edicao");

  try {
    if (!(await showCustomConfirm(t("messages.confirm.remove_pivot", { name })))) return;

    const cicloName = `Ciclo ${name}`;
    const ciclo = AppState.ciclosGlobais.find((c) => c.nome_original_circulo === cicloName);
    AppState.historyStack.push({
      type: "delete",
      deletedPivot: { ...last },
      deletedCiclo: ciclo ? { ...ciclo } : null
    });
    undoBtn && (undoBtn.disabled = false);

    const marker = AppState.pivotsMap && AppState.pivotsMap[name];
    if (marker) {
      try {
        map.removeLayer(marker);
      } catch (err) {
        console.warn("Falha ao remover marcador do pivô:", err);
      }
      delete AppState.pivotsMap[name];
    }

    const resizeHandle = (AppState.resizeHandlesMap || {})[name];
    if (resizeHandle) {
      try {
        map.removeLayer(resizeHandle);
      } catch (err) {
        console.warn("Falha ao remover alça de raio do pivô:", err);
      }
      delete AppState.resizeHandlesMap[name];
    }

    AppState.lastPivosDataDrawn = pivots.filter((p) => p.nome !== name);
    AppState.ciclosGlobais = AppState.ciclosGlobais.filter((c) => c.nome_original_circulo !== cicloName);
    drawCirculos(AppState.ciclosGlobais);
    drawPivos(AppState.lastPivosDataDrawn, false);
    mostrarMensagem(t("messages.success.pivot_removed", { name }), "sucesso");
    atualizarPainelDados();
    await reavaliarPivosViaAPI();
  } catch (err) {
    console.error("Falha ao excluir o último pivô:", err);
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
  }
}
window.deleteLastDrawnPivot = deleteLastDrawnPivot;

// Ícone padrão (pino vermelho) do marcador editável de pivô, ou a
// versão "modo excluir" (pino mais escuro com um X branco), conforme
// AppState.modoExcluirPivo. Usado tanto ao criar o marcador quanto
// pra atualizar os já existentes na hora que o modo é alternado (ver
// refreshPivotMarkerIcons/toggleModoExcluirPivo em core.modes.js).
// Contorno do pino, compartilhado pelas duas variantes de
// getEditablePivotIcon() (normal e "modo excluir") — só muda a cor de
// preenchimento/borda entre as duas, então fica só aqui uma vez.
const PIVOT_PIN_SHAPE_PATH = "M14 0 C7.486 0 2 5.486 2 12.014 C2 20.014 14 40 14 40 C14 40 26 20.014 26 12.014 C26 5.486 20.514 0 14 0 Z M14 18 C10.686 18 8 15.314 8 12 C8 8.686 10.686 6 14 6 C17.314 6 20 8.686 20 12 C20 15.314 17.314 18 14 18 Z";

function getEditablePivotIcon() {
  const deleteMode = !!AppState.modoExcluirPivo;
  const pin = deleteMode
    ? `<path d="${PIVOT_PIN_SHAPE_PATH}" fill="#dc2626" stroke="#450a0a" stroke-width="1"/><path d="M10.5 8.5 L17.5 15.5 M17.5 8.5 L10.5 15.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`
    : `<path d="${PIVOT_PIN_SHAPE_PATH}" fill="#FF3333" stroke="#660000" stroke-width="1"/>`;
  const html = `<svg viewBox="0 0 28 40" width="18" height="26" xmlns="http://www.w3.org/2000/svg">${pin}</svg>`;
  return L.divIcon({
    className: deleteMode ? "pivo-edit-handle-custom-pin pivo-edit-handle-delete-mode" : "pivo-edit-handle-custom-pin",
    html,
    iconSize: [18, 26],
    iconAnchor: [9, 26]
  });
}

// Troca o ícone de todos os marcadores editáveis já em tela (sem
// recriar nada) — chamada quando o "modo excluir" é ligado/desligado.
function refreshPivotMarkerIcons() {
  Object.values(AppState.pivotsMap || {}).forEach((marker) => marker && marker.setIcon(getEditablePivotIcon()));
}

function createEditablePivotMarker(pivotData) {
  const name = pivotData.nome;
  const latLng = L.latLng(pivotData.lat, pivotData.lon);
  const undoBtn = document.getElementById("desfazer-edicao");
  const marker = L.marker(latLng, { draggable: true, icon: getEditablePivotIcon() }).addTo(map);
  AppState.pivotsMap[name] = marker;

  // Modo excluir ativo: um toque/clique no pino já exclui (com
  // confirmação), em vez de precisar de toque longo/clique direito.
  marker.on("click", (event) => {
    if (!AppState.modoExcluirPivo) return;
    L.DomEvent.stop(event);
    confirmAndDeletePivot(name, marker, undoBtn);
  });

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
        radius > 0 && resizeHandle.setLatLng(center.destination(radius, _getResizeHandleBearing(currentPivot)));
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
    // No mobile a exclusão só acontece pelo botão dedicado (modo
    // excluir — ver toggleModoExcluirPivo). Sem esse bloqueio, um
    // toque um pouco mais longo no pino (tentando arrastar, por
    // exemplo) faz o navegador sintetizar um "contextmenu" sozinho e
    // abrir a confirmação de exclusão por conta própria, competindo
    // com o fluxo novo e explícito do botão.
    if (typeof isMobileDrawMode == "function" && isMobileDrawMode()) return;
    await confirmAndDeletePivot(name, marker, undoBtn);
  });
}

function createResizeHandle(pivotData) {
  const name = pivotData.nome;
  const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
  if (!pivot) return;

  const radius = _getPivotRadius(pivot);
  if (radius <= 0) return;

  const center = _getCircleCenter(pivot);
  const isRotatable = pivot.tipo === "setorial" || pivot.tipo === "pacman";
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;background:#f97316;border:2px solid #fff;border-radius:50%;cursor:${isRotatable ? "grab" : "ew-resize"};box-shadow:0 1px 4px rgba(0,0,0,.7);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
  const handle = L.marker(center.destination(radius, _getResizeHandleBearing(pivot)), {
    icon,
    draggable: true,
    zIndexOffset: 1600
  }).addTo(map);
  const undoBtn = document.getElementById("desfazer-edicao");

  let dragStartRadius = null;
  let dragStartCoords = null;
  let dragStartAngles = null;

  handle.on("dragstart", () => {
    const currentPivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
    if (currentPivot) {
      dragStartRadius = typeof currentPivot.raio == "number" ? currentPivot.raio : null;
      dragStartCoords = currentPivot.coordenadas ? JSON.parse(JSON.stringify(currentPivot.coordenadas)) : null;
      dragStartAngles = currentPivot.tipo === "setorial"
        ? { angulo_central: currentPivot.angulo_central, abertura_arco: currentPivot.abertura_arco }
        : currentPivot.tipo === "pacman"
          ? { angulo_inicio: currentPivot.angulo_inicio, angulo_fim: currentPivot.angulo_fim }
          : null;
    }
  });

  handle.on("drag", (event) => {
    const currentPivot = AppState.lastPivosDataDrawn.find((p) => p.nome === name);
    if (!currentPivot) return;

    const center = _getCircleCenter(currentPivot);
    const dragLatLng = event.target.getLatLng();
    const newRadius = center.distanceTo(dragLatLng);
    if (newRadius < 10) return;

    if (currentPivot.tipo === "setorial") {
      // A alça agora representa a BORDA do arco (ângulo central +
      // metade da abertura). Arrastá-la em volta do centro recalcula
      // o ângulo central a partir de onde o usuário soltou, mantendo
      // a abertura (largura do arco) fixa — ou seja, gira o desenho
      // inteiro em vez de só mudar o raio.
      const edgeBearing = calculateBearing(center, dragLatLng);
      const abertura = currentPivot.abertura_arco || 180;
      currentPivot.raio = newRadius;
      currentPivot.angulo_central = _normalizeAngle(edgeBearing - abertura / 2);
      currentPivot.coordenadas = generateSectorCoords(center, newRadius, currentPivot.angulo_central, abertura);
    } else if (currentPivot.tipo === "pacman") {
      // Mesma ideia pro Pac-Man: a alça é o fim do arco (angulo_fim).
      // Gira o desenho inteiro em volta do centro preservando a
      // abertura entre o ângulo de início e o de fim.
      const newAnguloFim = calculateBearing(center, dragLatLng);
      const sweep = _normalizeAngle((currentPivot.angulo_fim || 0) - (currentPivot.angulo_inicio || 0));
      currentPivot.raio = newRadius;
      currentPivot.angulo_fim = newAnguloFim;
      currentPivot.angulo_inicio = _normalizeAngle(newAnguloFim - sweep);
      currentPivot.coordenadas = generatePacmanCoords(center, newRadius, currentPivot.angulo_inicio, currentPivot.angulo_fim);
    } else if (typeof currentPivot.raio == "number") {
      currentPivot.raio = newRadius;
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
    if (AppState.lastPivosDataDrawn.find((p) => p.nome === name) && (dragStartRadius !== null || dragStartCoords !== null || dragStartAngles !== null)) {
      AppState.historyStack.push({
        type: "resize",
        pivotName: name,
        previousRadius: dragStartRadius,
        previousCoordenadas: dragStartCoords,
        previousAngles: dragStartAngles
      });
      undoBtn && (undoBtn.disabled = false);
    }
    dragStartRadius = null;
    dragStartCoords = null;
    dragStartAngles = null;
  });

  AppState.resizeHandlesMap[name] = handle;
}

function enablePivoEditingMode() {
  AppState.modoEdicaoPivos = true;
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
    try {
      createEditablePivotMarker(pivot);
      createResizeHandle(pivot);
    } catch (err) {
      // Se a criação do marcador de UM pivô falhar, não pode travar
      // os outros nem passar em branco — sem isso, um erro aqui
      // fazia o pivô ficar sem pino/alça até fechar e reabrir o
      // menu (que chama esta mesma função de novo do zero).
      console.error("Falha ao criar marcador editável do pivô:", pivot && pivot.nome, err);
    }
  });

  mostrarMensagem(t("messages.info.edit_mode_activated"), "sucesso");
}

function disablePivoEditingMode() {
  AppState.modoEdicaoPivos = false;

  // Esta função só roda quando o usuário FECHA a edição de propósito
  // (toca no lápis/salvar de novo) — trocar de ferramenta de desenho
  // no mobile não passa por aqui (ver o guard em deactivateAllModes,
  // que evita chamar togglePivoEditing nesse caso pra não perder o
  // pino/alça no meio de um desenho). Então, ao chegar aqui, o
  // usuário realmente quer sair do modo de edição — troca tudo de
  // volta pro círculo "plano" (sem pino/alça arrastáveis) igual no
  // desktop, em vez de deixar os controles de edição visíveis pra
  // sempre.
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
    const { pivotName, previousRadius, previousCoordenadas, previousAngles } = action;
    const pivot = AppState.lastPivosDataDrawn.find((p) => p.nome === pivotName);

    if (pivot) {
      previousRadius !== null && (pivot.raio = previousRadius);
      previousCoordenadas && (pivot.coordenadas = previousCoordenadas);
      previousAngles && Object.assign(pivot, previousAngles);

      const handle = (AppState.resizeHandlesMap || {})[pivotName];
      if (handle) {
        const center = _getCircleCenter(pivot);
        const radius = _getPivotRadius(pivot);
        radius > 0 && handle.setLatLng(center.destination(radius, _getResizeHandleBearing(pivot)));
      }

      drawCirculos();
      mostrarMensagem(t("messages.success.action_undone_move", { pivot_name: pivotName }), "sucesso");
    }
  } else if (action.type === "delete") {
    const { deletedPivot, deletedCiclo } = action;
    AppState.lastPivosDataDrawn.push(deletedPivot);
    deletedCiclo && AppState.ciclosGlobais.push(deletedCiclo);
    createEditablePivotMarker(deletedPivot);
    createResizeHandle(deletedPivot);
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
    detachTouchDrawSetorial = attachTouchDrawSupport(handleSectorialDrawMouseMove, handleSectorialPivotDrawClick);
    mostrarMensagem(t("messages.info.draw_sector_pivot_step1"), "info");
  } else {
    map.getContainer().style.cursor = "";
    map.off("click", handleSectorialPivotDrawClick);
    map.off("mousemove", handleSectorialDrawMouseMove);
    detachTouchDrawSetorial && (detachTouchDrawSetorial(), detachTouchDrawSetorial = null);
    AppState.centroPivoTemporario = null;
    typeof removeTempSector == "function" && removeTempSector();
    mostrarMensagem(t("messages.info.draw_sector_pivot_off"), "sucesso");
  }
}

// Cria o pivô setorial de verdade (sem chamada de API, tudo local).
// Devolve o pivô criado, ou null se o raio ficou pequeno demais.
// Chamada pelo 2º toque/clique do fluxo de desenho, igual no desktop
// e no mobile.
async function finalizeSectorPivot(center, edge) {
  const distance = center.distanceTo(edge);
  typeof removeTempSector == "function" && removeTempSector();

  if (distance < 10) {
    mostrarMensagem(t("messages.errors.draw_pivot_radius_too_small"), "erro");
    return null;
  }

  mostrarLoader(true);
  try {
    const bearing = calculateBearing(center, edge);
    const nextNumber = getNextPivotNumber();
    const pivot = {
      nome: `${t("entity_names.pivot")} ${nextNumber}`,
      lat: center.lat,
      lon: center.lng,
      fora: true,
      tipo: "setorial",
      raio: distance,
      angulo_central: bearing,
      abertura_arco: 180,
      circle_center_lat: center.lat,
      circle_center_lon: center.lng
    };

    AppState.lastPivosDataDrawn.push(pivot);

    const ciclo = {
      nome_original_circulo: `Ciclo ${pivot.nome}`,
      coordenadas: []
    };
    AppState.ciclosGlobais.push(ciclo);

    atualizarPainelDados();
    // No mobile pulamos o drawPivos "plano" (ver finalizeCircularPivot
    // pra explicação completa): quem chamou vai deixar tudo editável
    // de novo logo em seguida.
    const skipPlainDraw = typeof isMobileDrawMode == "function" && isMobileDrawMode();
    skipPlainDraw || (typeof drawPivos == "function" && drawPivos(AppState.lastPivosDataDrawn, false));
    typeof drawCirculos == "function" && drawCirculos(AppState.ciclosGlobais);
    await reavaliarPivosViaAPI();
    mostrarMensagem(t("messages.success.sector_pivot_created", { name: pivot.nome }), "sucesso");
    return pivot;
  } catch (err) {
    console.error("Erro ao criar pivô setorial:", err);
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
    return null;
  } finally {
    removeDrawingTooltip(map);
    mostrarLoader(false);
  }
}

async function handleSectorialPivotDrawClick(event) {
  if (!AppState.modoDesenhoPivoSetorial) return;

  if (!AppState.centroPivoTemporario) {
    // 1º toque define o centro (com um tracejado padrão de largada);
    // o 2º toque (ou arrastar antes de soltar) é que define o raio E
    // o ângulo de verdade — importante pro setorial, já que o ângulo
    // não dá pra ajustar depois só com a alça de raio.
    AppState.centroPivoTemporario = event.latlng;
    typeof drawTempSector == "function" && drawTempSector(AppState.centroPivoTemporario, defaultTempEdgePoint(AppState.centroPivoTemporario));
    mostrarMensagem(t("messages.info.draw_sector_pivot_step2"), "info");
    return;
  }

  const created = await finalizeSectorPivot(AppState.centroPivoTemporario, event.latlng);
  AppState.centroPivoTemporario = null;
  if (created) {
    finishPivotDrawConfirmation(() => AppState.modoDesenhoPivoSetorial, toggleModoDesenhoPivoSetorial, "draw_sector_pivot_still_active");
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
    detachTouchDrawPacman = attachTouchDrawSupport(handlePacmanDrawMouseMove, handlePacmanPivotDrawClick);
    mostrarMensagem(t("messages.info.draw_pacman_step1"), "info");
  } else {
    map.getContainer().style.cursor = "";
    map.off("click", handlePacmanPivotDrawClick);
    map.off("mousemove", handlePacmanDrawMouseMove);
    detachTouchDrawPacman && (detachTouchDrawPacman(), detachTouchDrawPacman = null);
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

// Cria o pivô Pac-Man de verdade (sem chamada de API). Devolve o
// pivô criado, ou null se o raio ficou pequeno demais. Chamada pelo
// 3º toque/clique do fluxo de desenho, igual no desktop e no mobile.
async function finalizePacmanPivot(center, radiusPoint, endPoint) {
  mostrarLoader(true);
  try {
    const radius = center.distanceTo(radiusPoint);
    if (radius < 10) throw new Error(t("messages.errors.draw_pivot_radius_too_small"));

    const startAngle = calculateBearing(center, radiusPoint);
    const endAngle = calculateBearing(center, endPoint);
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

    // No mobile pulamos o drawPivos "plano" (ver finalizeCircularPivot
    // pra explicação completa).
    (typeof isMobileDrawMode == "function" && isMobileDrawMode()) || drawPivos(AppState.lastPivosDataDrawn, false);
    drawCirculos(AppState.ciclosGlobais);
    await reavaliarPivosViaAPI();
    mostrarMensagem(t("messages.success.pacman_pivot_created", { name: pivot.nome }), "sucesso");
    return pivot;
  } catch (err) {
    console.error("Erro ao criar pivô Pac-Man:", err);
    mostrarMensagem(t("messages.errors.generic_error", { error: err.message }), "erro");
    return null;
  } finally {
    typeof removeTempPacman == "function" && removeTempPacman();
    removeDrawingTooltip(map);
    mostrarLoader(false);
  }
}

async function handlePacmanPivotDrawClick(event) {
  if (!AppState.modoDesenhoPivoPacman) return;

  if (!AppState.centroPivoTemporario) {
    // 1º toque define o centro. O Pac-Man precisa de mais um ponto que
    // o setorial (ângulo inicial E final), então continua com o fluxo
    // de 3 toques — tanto no desktop quanto no mobile — pra dar
    // controle real sobre os dois ângulos, com tracejado arrastável em
    // cada etapa (via attachTouchDrawSupport).
    AppState.centroPivoTemporario = event.latlng;
    typeof drawTempPacman == "function" && drawTempPacman(AppState.centroPivoTemporario, null, defaultTempEdgePoint(AppState.centroPivoTemporario));
    mostrarMensagem(t("messages.info.draw_pacman_step2"), "info");
    return;
  }

  if (!AppState.pontoRaioTemporario) {
    AppState.pontoRaioTemporario = event.latlng;
    if (typeof drawTempPacman == "function") {
      // Ponto de varredura padrão: 90° a partir do ponto que acabou
      // de definir o raio/ângulo inicial, só pra ter um arco visível
      // desde já (o usuário ajusta arrastando ou toca de novo pra
      // confirmar esse mesmo ângulo).
      const startBearing = calculateBearing(AppState.centroPivoTemporario, AppState.pontoRaioTemporario);
      drawTempPacman(AppState.centroPivoTemporario, AppState.pontoRaioTemporario, defaultTempEdgePoint(AppState.centroPivoTemporario, startBearing + 90));
    }
    mostrarMensagem(t("messages.info.draw_pacman_step3"), "info");
    return;
  }

  const created = await finalizePacmanPivot(AppState.centroPivoTemporario, AppState.pontoRaioTemporario, event.latlng);
  AppState.centroPivoTemporario = null;
  AppState.pontoRaioTemporario = null;
  if (created) {
    finishPivotDrawConfirmation(() => AppState.modoDesenhoPivoPacman, toggleModoDesenhoPivoPacman, "draw_pacman_still_active");
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
