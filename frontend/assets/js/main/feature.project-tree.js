// =====================================================================
// Painel "Estrutura do projeto" (desktop) — árvore estilo "Lugares" do
// Google Earth, ao lado direito da sidebar esquerda.
//
// - Recolhido: só uma faixa fina com ícone + contadores (pivôs / sem sinal).
// - Expandido: arquivo KMZ > Pivôs / Irripumps / Central / Repetidoras /
//   Torres do KMZ, com busca, checkbox em todos os grupos (pivôs/torres:
//   mostrar no mapa; central/repetidoras: ativar o estudo de sinal), renomear
//   (duplo clique, F2 ou botão direito > Renomear), ir para no mapa,
//   copiar coordenadas e excluir.
//
// Não guarda estado próprio do estudo: lê tudo de AppState e se redesenha
// quando o app redesenha pivôs/bombas/repetidoras (ver wrapGlobal no fim).
// Ocultar pivô é só visual (KMZ/PDF continuam com todos os pivôs).
// =====================================================================

const ProjectTree = {
  open: false,
  query: "",
  collapsedGroups: new Set(["towers"]),
  hiddenPivots: new Set(),
  hiddenTowers: new Set(), // customId dos candidatos (torres do KMZ) ocultos
  hiddenBombas: new Set(), // "lat|lon" dos irripumps ocultos (índice muda ao excluir)
  editing: null, // { kind, key }
  renderQueued: false,
  menuEl: null
};

const PT_STORAGE_KEY = "projectTreeOpen";
const PT_RENAMABLE_KINDS = ["pivot", "bomba", "central", "repeater"];

function ptT(key, params) {
  return t(`project_tree.${key}`, params);
}

function ptIcon(path, size = 16) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"></path></svg>`;
}

const PT_ICONS = {
  tree: "M3 5h6M3 5v14M3 12h6M3 19h6M13 5h8M13 12h8M13 19h8",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  collapse: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",
  file: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5"
};

// ---------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------

function ptIsSimulated() {
  return !!AppState.antenaGlobal || (AppState.repetidoras || []).length > 0;
}

function ptBombaName(bomba, index) {
  return bomba?.nome || `Irripump ${String(index + 1).padStart(2, "0")}`;
}

function ptGetGroups() {
  const pivots = (AppState.lastPivosDataDrawn || []).map((p) => ({
    kind: "pivot",
    key: p.nome,
    name: p.nome,
    lat: p.lat,
    lon: p.lon,
    fora: !!p.fora,
    hidden: ProjectTree.hiddenPivots.has(p.nome)
  }));

  const bombas = (AppState.lastBombasDataDrawn || []).map((b, i) => ({
    kind: "bomba",
    key: String(i),
    name: ptBombaName(b, i),
    lat: b.lat,
    lon: b.lon,
    fora: b.fora !== false,
    hidden: ProjectTree.hiddenBombas.has(ptBombaKey(b))
  }));

  const central = AppState.antenaGlobal
    ? [{
        kind: "central",
        key: "central",
        name: getFormattedAntennaOrRepeaterName({ ...AppState.antenaGlobal, isMainAntenna: true }) || t("ui.labels.main_antenna_default"),
        lat: AppState.antenaGlobal.lat,
        lon: AppState.antenaGlobal.lon,
        hidden: !ptIsCoverageOn(AppState.antenaGlobal)
      }]
    : [];

  const repeaters = (AppState.repetidoras || []).map((r) => {
    const pos = r.marker?.getLatLng?.();
    return {
      kind: "repeater",
      key: String(r.id),
      name: getFormattedAntennaOrRepeaterName(r) || `#${r.id}`,
      lat: pos ? pos.lat : r.lat,
      lon: pos ? pos.lng : r.lon,
      hidden: !ptIsCoverageOn(r)
    };
  });

  const towers = AppState.antenaGlobal ? [] : (AppState.currentProcessedKmzData?.antenas || []).map((a, i) => {
    const key = ptTowerKey(a);
    return {
      kind: "tower",
      key,
      name: getFormattedAntennaOrRepeaterName({ ...a, is_from_kmz: true }) || a.nome || `#${i + 1}`,
      lat: a.lat,
      lon: a.lon,
      hidden: ProjectTree.hiddenTowers.has(key)
    };
  });

  // visibility: "map" = mostrar/ocultar no mapa; "coverage" = ativar/
  // desativar o estudo de sinal (overlay + reavaliação dos pivôs).
  return [
    { id: "pivots", label: ptT("group_pivots"), items: pivots, visibility: "map" },
    { id: "bombas", label: ptT("group_irripumps"), items: bombas, visibility: "map" },
    { id: "central", label: ptT("group_central"), items: central, visibility: "coverage" },
    { id: "repeaters", label: ptT("group_repeaters"), items: repeaters, visibility: "coverage" },
    { id: "towers", label: ptT("group_towers"), items: towers, visibility: "map" }
  ];
}

function ptBombaKey(bomba) {
  return `${bomba.lat}|${bomba.lon}`;
}

// Mesmo id que drawAntenaCandidates() põe nos marcadores do candidato.
function ptTowerKey(antena) {
  return `candidate-${antena.nome}-${antena.lat}`;
}

function ptIsCoverageOn(entity) {
  return typeof isCoverageVisible == "function" ? isCoverageVisible(entity) : true;
}

function ptGetEntity(kind, key) {
  if (kind === "central") return AppState.antenaGlobal || null;
  if (kind === "repeater") return (AppState.repetidoras || []).find((r) => String(r.id) === String(key)) || null;
  return null;
}

function ptFindItem(kind, key) {
  for (const group of ptGetGroups()) {
    const item = group.items.find((i) => i.kind === kind && i.key === key);
    if (item) return item;
  }
  return null;
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------

function ptStatusHtml(item, simulated) {
  if (item.kind !== "pivot" && item.kind !== "bomba") return "";
  if (!simulated) {
    return `<span class="pt-dot pt-dot--idle" aria-hidden="true"></span><span class="pt-sr">${escapeHtml(ptT("not_simulated"))}</span>`;
  }
  return item.fora
    ? `<span class="pt-dot pt-dot--out" aria-hidden="true"></span><span class="pt-sr">${escapeHtml(ptT("out_of_signal"))}</span>`
    : `<span class="pt-dot pt-dot--ok" aria-hidden="true"></span><span class="pt-sr">${escapeHtml(ptT("in_signal"))}</span>`;
}

function ptItemHtml(item, group, simulated) {
  const isEditing = ProjectTree.editing && ProjectTree.editing.kind === item.kind && ProjectTree.editing.key === item.key;
  const canRename = PT_RENAMABLE_KINDS.includes(item.kind);
  const attrs = `data-kind="${item.kind}" data-key="${escapeHtml(item.key)}"`;

  const checkLabel = group.visibility === "coverage"
    ? ptT("toggle_coverage", { name: item.name })
    : ptT("toggle_visibility", { name: item.name });
  const visibility = group.visibility
    ? `<input type="checkbox" class="pt-check" ${item.hidden ? "" : "checked"} data-action="toggle-visibility" ${attrs} aria-label="${escapeHtml(checkLabel)}" title="${escapeHtml(checkLabel)}">`
    : `<span class="pt-check-spacer" aria-hidden="true"></span>`;

  const nameHtml = isEditing
    ? `<input type="text" class="pt-rename-input" maxlength="60" value="${escapeHtml(item.name)}" aria-label="${escapeHtml(ptT("rename_label", { name: item.name }))}" ${attrs}>`
    : `<span class="pt-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>`;

  // Pivôs/irripumps: só a bolinha colorida (verde = com sinal, vermelha =
  // sem sinal). O texto continua pra leitor de tela dentro da bolinha.
  let statusText = "";
  if ((item.kind === "central" || item.kind === "repeater") && item.hidden) {
    statusText = `<span class="pt-meta">${escapeHtml(ptT("coverage_off_short"))}</span>`;
  }

  return `
    <div class="pt-row pt-row--item ${item.hidden ? "is-hidden" : ""} ${isEditing ? "is-editing" : ""} ${AppState.selectedPivoNome === item.key && item.kind === "pivot" ? "is-selected" : ""}"
         role="treeitem" tabindex="0" ${attrs} data-renamable="${canRename ? "1" : "0"}">
      ${visibility}
      ${ptStatusHtml(item, simulated)}
      ${nameHtml}
      ${statusText}
    </div>
    ${isEditing ? `<div class="pt-edit-hint">${escapeHtml(ptT("rename_hint"))}</div>` : ""}`;
}

function ptMatches(item) {
  if (!ProjectTree.query) return true;
  return item.name.toLowerCase().includes(ProjectTree.query.toLowerCase());
}

function renderProjectTree() {
  ProjectTree.renderQueued = false;
  const root = document.getElementById("project-tree");
  if (!root) return;

  // Não redesenha no meio de uma edição de nome (perderia o que foi digitado).
  if (ProjectTree.editing && root.querySelector(".pt-rename-input") === document.activeElement) return;

  const groups = ptGetGroups();
  const simulated = ptIsSimulated();
  const pivots = groups[0].items;
  const outCount = simulated ? pivots.filter((p) => p.fora).length : 0;

  // Faixa recolhida (contadores)
  const stripPivots = root.querySelector("#pt-strip-pivots");
  const stripOut = root.querySelector("#pt-strip-out");
  stripPivots && (stripPivots.textContent = pivots.length, stripPivots.title = ptT("pivots_count", { count: pivots.length }));
  if (stripOut) {
    stripOut.textContent = outCount;
    stripOut.title = ptT("out_count", { count: outCount });
    stripOut.hidden = !simulated;
  }

  const fileLabel = document.getElementById("nome-arquivo-label");
  const fileName = fileLabel?.dataset?.fileName || "";
  const fileEl = root.querySelector("#pt-file-name");
  fileEl && (fileEl.textContent = fileName || ptT("no_file"));

  const listEl = root.querySelector("#pt-list");
  if (!listEl) return;

  const hasAnything = groups.some((g) => g.items.length > 0);
  if (!hasAnything) {
    listEl.innerHTML = `<p class="pt-empty">${escapeHtml(ptT("empty"))}</p>`;
    return;
  }

  let html = "";
  groups.forEach((group) => {
    const items = group.items.filter(ptMatches);
    if (group.items.length === 0) return;
    if (ProjectTree.query && items.length === 0) return;

    const isCollapsed = ProjectTree.collapsedGroups.has(group.id) && !ProjectTree.query;
    const allVisible = group.visibility ? group.items.every((i) => !i.hidden) : true;
    const groupCheckLabel = group.visibility === "coverage"
      ? ptT("toggle_coverage", { name: group.label })
      : ptT("toggle_visibility", { name: group.label });

    html += `
      <div class="pt-group" role="group">
        <div class="pt-row pt-row--group">
          <button type="button" class="pt-twisty" data-action="toggle-group" data-group="${group.id}" aria-expanded="${!isCollapsed}" aria-label="${escapeHtml(isCollapsed ? ptT("expand_group", { name: group.label }) : ptT("collapse_group", { name: group.label }))}">
            ${ptIcon(isCollapsed ? PT_ICONS.chevronRight : PT_ICONS.chevronDown, 14)}
          </button>
          ${group.visibility
            ? `<input type="checkbox" class="pt-check" ${allVisible ? "checked" : ""} data-action="toggle-group-visibility" data-group="${group.id}" aria-label="${escapeHtml(groupCheckLabel)}" title="${escapeHtml(groupCheckLabel)}">`
            : `<span class="pt-check-spacer" aria-hidden="true"></span>`}
          <span class="pt-group-name">${escapeHtml(group.label)}</span>
          <span class="pt-count">${group.items.length}</span>
        </div>
        ${isCollapsed ? "" : `<div class="pt-children">${items.map((i) => ptItemHtml(i, group, simulated)).join("")}</div>`}
      </div>`;
  });

  listEl.innerHTML = html || `<p class="pt-empty">${escapeHtml(ptT("no_results"))}</p>`;

  // Checkbox do grupo "meio marcado" quando só parte dos itens está ligada.
  groups.forEach((group) => {
    if (!group.visibility) return;
    const check = listEl.querySelector(`[data-action="toggle-group-visibility"][data-group="${group.id}"]`);
    if (!check) return;
    const hiddenCount = group.items.filter((i) => i.hidden).length;
    check.indeterminate = hiddenCount > 0 && hiddenCount < group.items.length;
  });

  const input = listEl.querySelector(".pt-rename-input");
  if (input) {
    input.focus();
    input.select();
  }
}

function scheduleProjectTreeRender() {
  if (ProjectTree.renderQueued) return;
  ProjectTree.renderQueued = true;
  requestAnimationFrame(renderProjectTree);
}

// ---------------------------------------------------------------------
// Abrir / fechar
// ---------------------------------------------------------------------

function setProjectTreeOpen(open) {
  ProjectTree.open = !!open;
  document.body.classList.toggle("project-tree-open", ProjectTree.open);
  document.getElementById("pt-open-btn")?.setAttribute("aria-expanded", String(ProjectTree.open));
  document.getElementById("pt-close-btn")?.setAttribute("aria-expanded", String(ProjectTree.open));
  try { localStorage.setItem(PT_STORAGE_KEY, ProjectTree.open ? "1" : "0"); } catch (e) { /* storage indisponível */ }

  // O mapa mudou de largura: o Leaflet precisa recalcular.
  requestAnimationFrame(() => map?.invalidateSize?.({ animate: false, pan: false }));
  ProjectTree.open && renderProjectTree();
}

// ---------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------

function ptBlockedInEditMode() {
  if (AppState.modoEdicaoPivos) {
    mostrarMensagem(ptT("blocked_edit_mode"), "info");
    return true;
  }
  return false;
}

function ptGoTo(item) {
  if (!item || item.lat == null || item.lon == null || !map) return;
  map.flyTo([item.lat, item.lon], Math.max(map.getZoom(), 15), { duration: 0.6 });

  if (item.kind === "pivot") {
    const prev = AppState.selectedPivoNome;
    prev && AppState.pivotsMap[prev]?.getElement()?.classList.remove("pivo-marker-container-selected");
    AppState.selectedPivoNome = item.key;
    AppState.pivotsMap[item.key]?.getElement()?.classList.add("pivo-marker-container-selected");
    scheduleProjectTreeRender();
  }
}

function ptStartRename(kind, key) {
  if (!PT_RENAMABLE_KINDS.includes(kind)) return;
  if (kind === "pivot" && ptBlockedInEditMode()) return;
  ProjectTree.editing = { kind, key };
  renderProjectTree();
}

function ptCancelRename() {
  ProjectTree.editing = null;
  renderProjectTree();
}

function ptValidateName(newName, existingNames) {
  if (!newName) return ptT("name_empty");
  if (existingNames.some((n) => n.trim().toLowerCase() === newName.toLowerCase())) return ptT("name_duplicate", { name: newName });
  return null;
}

function renamePivot(oldName, rawNewName) {
  const newName = String(rawNewName || "").trim();
  if (newName === oldName) return true;

  const others = (AppState.lastPivosDataDrawn || []).map((p) => p.nome).filter((n) => n !== oldName);
  const error = ptValidateName(newName, others);
  if (error) {
    mostrarMensagem(error, "erro");
    return false;
  }

  const oldCiclo = `Ciclo ${oldName}`;
  const newCiclo = `Ciclo ${newName}`;

  // Mesmo objeto é usado em vários lugares (LoS, etc.): muda no lugar.
  (AppState.lastPivosDataDrawn || []).forEach((p) => { p.nome === oldName && (p.nome = newName); });
  (AppState.currentProcessedKmzData?.pivos || []).forEach((p) => { p.nome === oldName && (p.nome = newName); });
  (AppState.ciclosGlobais || []).forEach((c) => { c.nome_original_circulo === oldCiclo && (c.nome_original_circulo = newCiclo); });
  (AppState.currentProcessedKmzData?.ciclos || []).forEach((c) => { c.nome_original_circulo === oldCiclo && (c.nome_original_circulo = newCiclo); });

  ["posicoesEditadas", "backupPosicoesPivos"].forEach((prop) => {
    const obj = AppState[prop];
    if (obj && Object.prototype.hasOwnProperty.call(obj, oldName)) {
      obj[newName] = obj[oldName];
      delete obj[oldName];
    }
  });

  AppState.selectedPivoNome === oldName && (AppState.selectedPivoNome = newName);
  if (ProjectTree.hiddenPivots.has(oldName)) {
    ProjectTree.hiddenPivots.delete(oldName);
    ProjectTree.hiddenPivots.add(newName);
  }

  drawPivos(AppState.lastPivosDataDrawn, false);
  typeof drawCirculos == "function" && drawCirculos();
  mostrarMensagem(ptT("renamed", { old: oldName, name: newName }), "sucesso");
  return true;
}

function renameBomba(index, rawNewName) {
  const bombas = AppState.lastBombasDataDrawn || [];
  const bomba = bombas[index];
  if (!bomba) return false;

  const oldName = ptBombaName(bomba, index);
  const newName = String(rawNewName || "").trim();
  if (newName === oldName) return true;

  const others = bombas.map((b, i) => ptBombaName(b, i)).filter((_, i) => i !== index);
  const error = ptValidateName(newName, others);
  if (error) {
    mostrarMensagem(error, "erro");
    return false;
  }

  const original = (AppState.currentProcessedKmzData?.bombas || []).find((b) => b.lat === bomba.lat && b.lon === bomba.lon);
  original && (original.nome = newName);
  bomba.nome = newName;

  drawBombas(bombas);
  mostrarMensagem(ptT("renamed", { old: oldName, name: newName }), "sucesso");
  return true;
}

// ---------------------------------------------------------------------
// Central / repetidoras: nome manual. Marca `nome_manual` pra o nome
// automático ("Repetidora Solar Pivô - 5m") não sobrescrever, e o
// KMZ/PDF usarem o mesmo nome (kmz_exporter respeita nome_manual).
// ---------------------------------------------------------------------
function ptSignalSourceNames(exclude) {
  return [AppState.antenaGlobal ? { ...AppState.antenaGlobal, isMainAntenna: true, __ref: AppState.antenaGlobal } : null,
    ...(AppState.repetidoras || []).map((r) => ({ ...r, __ref: r }))]
    .filter((e) => e && e.__ref !== exclude)
    .map((e) => getFormattedAntennaOrRepeaterName(e));
}

function ptRefreshSignalSourceName(entity) {
  typeof updateAntenaOrRepeaterLabel == "function" && updateAntenaOrRepeaterLabel(entity);
  const isMain = entity === AppState.antenaGlobal;
  const span = document.querySelector(isMain ? "#antena-item .rep-item-name" : `#rep-item-${entity.id} .rep-item-name`);
  span && (span.textContent = getFormattedAntennaOrRepeaterName(isMain ? { ...entity, isMainAntenna: true } : entity));
  typeof atualizarPainelDados == "function" && atualizarPainelDados();
}

function renameSignalSource(entity, rawNewName) {
  if (!entity) return false;
  const isMain = entity === AppState.antenaGlobal;
  const oldName = getFormattedAntennaOrRepeaterName(isMain ? { ...entity, isMainAntenna: true } : entity);
  const newName = String(rawNewName || "").trim();
  if (newName === oldName) return true;

  const error = ptValidateName(newName, ptSignalSourceNames(entity));
  if (error) {
    mostrarMensagem(error, "erro");
    return false;
  }

  entity.nome = newName;
  entity.nome_manual = true;
  ptRefreshSignalSourceName(entity);
  mostrarMensagem(ptT("renamed", { old: oldName, name: newName }), "sucesso");
  return true;
}

// Volta pro nome automático (tira o nome digitado).
function ptUseAutoName(entity) {
  if (!entity) return;
  entity.nome_manual = false;
  // Central vem do KMZ: o "automático" dela é o nome original da torre.
  entity === AppState.antenaGlobal && entity.original_name && (entity.nome = entity.original_name);
  ptRefreshSignalSourceName(entity);
  renderProjectTree();
}

function ptCommitRename(input) {
  if (!ProjectTree.editing) return;
  const { kind, key } = ProjectTree.editing;
  const value = input.value;
  const ok = kind === "pivot"
    ? renamePivot(key, value)
    : kind === "bomba"
      ? renameBomba(Number(key), value)
      : renameSignalSource(ptGetEntity(kind, key), value);
  if (!ok) {
    // Mantém o campo aberto pra corrigir.
    input.focus();
    input.select();
    return;
  }
  ProjectTree.editing = null;
  renderProjectTree();
  // Devolve o foco pra linha renomeada (acessibilidade / teclado).
  const newKey = kind === "pivot" ? String(value).trim() : key;
  document.querySelector(`#pt-list .pt-row--item[data-kind="${kind}"][data-key="${CSS.escape(newKey)}"]`)?.focus();
}

function applyPivotVisibility() {
  if (AppState.modoEdicaoPivos) return;
  const pivots = AppState.lastPivosDataDrawn || [];
  const pivotLabels = (AppState.marcadoresLegenda || []).filter((l) => l.options?.labelType === "pivot");

  pivots.forEach((pivot, index) => {
    if (!ProjectTree.hiddenPivots.has(pivot.nome)) return;
    const marker = AppState.pivotsMap?.[pivot.nome];
    marker && map.hasLayer(marker) && map.removeLayer(marker);
    const circle = (AppState.circulosPivos || [])[index];
    circle && map.hasLayer(circle) && map.removeLayer(circle);
    const label = pivotLabels[index];
    label && map.hasLayer(label) && map.removeLayer(label);
  });
}

function ptRedrawPivots() {
  drawPivos(AppState.lastPivosDataDrawn, false);
  typeof drawCirculos == "function" && drawCirculos();
}

function ptTogglePivotVisibility(name, visible) {
  if (ptBlockedInEditMode()) return renderProjectTree();
  visible ? ProjectTree.hiddenPivots.delete(name) : ProjectTree.hiddenPivots.add(name);
  ptRedrawPivots();
}

// Torres do KMZ: só some/aparece no mapa (classe CSS; não remove a camada,
// porque startMainSimulation procura o candidato dentro do layerGroup).
function applyTowerVisibility() {
  const group = AppState.antenaCandidatesLayerGroup;
  if (!group) return;
  group.eachLayer((layer) => {
    const el = layer.getElement?.();
    el && el.classList.toggle("pt-layer-hidden", ProjectTree.hiddenTowers.has(layer.options?.customId));
  });
}

// Irripumps: só visual (KMZ/PDF continuam com todos), igual aos pivôs.
// drawBombas() cria marcador e rótulo na mesma ordem de lastBombasDataDrawn.
function applyBombaVisibility() {
  const bombas = AppState.lastBombasDataDrawn || [];
  const labels = (AppState.marcadoresLegenda || []).filter((l) => l.options?.labelType === "bomba");
  bombas.forEach((bomba, index) => {
    const hidden = ProjectTree.hiddenBombas.has(ptBombaKey(bomba));
    [AppState.marcadoresBombas?.[index], labels[index]].forEach((layer) => {
      layer?.getElement?.()?.classList.toggle("pt-layer-hidden", hidden);
    });
  });
}

function ptToggleBombaVisibility(index, visible) {
  const bomba = (AppState.lastBombasDataDrawn || [])[Number(index)];
  if (!bomba) return renderProjectTree();
  const key = ptBombaKey(bomba);
  visible ? ProjectTree.hiddenBombas.delete(key) : ProjectTree.hiddenBombas.add(key);
  applyBombaVisibility();
  renderProjectTree();
}

function ptToggleTowerVisibility(key, visible) {
  visible ? ProjectTree.hiddenTowers.delete(key) : ProjectTree.hiddenTowers.add(key);
  applyTowerVisibility();
  renderProjectTree();
}

// Central / repetidora: liga/desliga o estudo de sinal (mesmo efeito do
// olho no painel de repetidoras, que continua sincronizado).
function ptToggleCoverage(kind, key, visible) {
  const entity = ptGetEntity(kind, key);
  if (!entity || typeof setCoverageVisibility != "function") return renderProjectTree();
  setCoverageVisibility(entity, visible);
  renderProjectTree();
}

function ptToggleItem(kind, key, visible) {
  if (kind === "pivot") ptTogglePivotVisibility(key, visible);
  else if (kind === "bomba") ptToggleBombaVisibility(key, visible);
  else if (kind === "tower") ptToggleTowerVisibility(key, visible);
  else if (kind === "central" || kind === "repeater") ptToggleCoverage(kind, key, visible);
}

function ptToggleGroupVisibility(groupId, visible) {
  if (groupId === "pivots") {
    if (ptBlockedInEditMode()) return renderProjectTree();
    visible
      ? ProjectTree.hiddenPivots.clear()
      : (AppState.lastPivosDataDrawn || []).forEach((p) => ProjectTree.hiddenPivots.add(p.nome));
    ptRedrawPivots();
    return;
  }

  if (groupId === "bombas") {
    visible
      ? ProjectTree.hiddenBombas.clear()
      : (AppState.lastBombasDataDrawn || []).forEach((b) => ProjectTree.hiddenBombas.add(ptBombaKey(b)));
    applyBombaVisibility();
    renderProjectTree();
    return;
  }

  if (groupId === "towers") {
    visible
      ? ProjectTree.hiddenTowers.clear()
      : (AppState.currentProcessedKmzData?.antenas || []).forEach((a) => ProjectTree.hiddenTowers.add(ptTowerKey(a)));
    applyTowerVisibility();
    renderProjectTree();
    return;
  }

  if (groupId === "central" || groupId === "repeaters") {
    if (typeof setCoverageVisibility != "function") return renderProjectTree();
    const entities = groupId === "central"
      ? (AppState.antenaGlobal ? [AppState.antenaGlobal] : [])
      : (AppState.repetidoras || []);
    // Liga/desliga todas e reavalia os pivôs UMA vez só no fim.
    let changed = false;
    entities.forEach((e) => { changed = setCoverageVisibility(e, visible, { reevaluate: false }) || changed; });
    changed && typeof scheduleCoverageReevaluation == "function" && scheduleCoverageReevaluation(0);
    renderProjectTree();
  }
}

async function ptDeletePivot(name) {
  if (ptBlockedInEditMode()) return;
  if (!await showCustomConfirm(t("messages.confirm.remove_pivot", { name }))) return;

  const cicloName = `Ciclo ${name}`;
  AppState.lastPivosDataDrawn = (AppState.lastPivosDataDrawn || []).filter((p) => p.nome !== name);
  AppState.ciclosGlobais = (AppState.ciclosGlobais || []).filter((c) => c.nome_original_circulo !== cicloName);
  AppState.currentProcessedKmzData?.pivos && (AppState.currentProcessedKmzData.pivos = AppState.currentProcessedKmzData.pivos.filter((p) => p.nome !== name));
  AppState.currentProcessedKmzData?.ciclos && (AppState.currentProcessedKmzData.ciclos = AppState.currentProcessedKmzData.ciclos.filter((c) => c.nome_original_circulo !== cicloName));
  AppState.selectedPivoNome === name && (AppState.selectedPivoNome = null);
  ProjectTree.hiddenPivots.delete(name);

  ptRedrawPivots();
  atualizarPainelDados();
  mostrarMensagem(t("messages.success.pivot_removed", { name }), "sucesso");
}

async function ptCopyCoords(item) {
  if (!item) return;
  const text = `${Number(item.lat).toFixed(6)}, ${Number(item.lon).toFixed(6)}`;
  try {
    await navigator.clipboard.writeText(text);
    mostrarMensagem(ptT("coords_copied", { coords: text }), "sucesso");
  } catch (e) {
    mostrarMensagem(text, "info");
  }
}

// ---------------------------------------------------------------------
// Menu do botão direito
// ---------------------------------------------------------------------

function ptCloseMenu() {
  ProjectTree.menuEl?.remove();
  ProjectTree.menuEl = null;
}

function ptOpenMenu(row, x, y) {
  ptCloseMenu();
  const kind = row.dataset.kind;
  const key = row.dataset.key;
  const item = ptFindItem(kind, key);
  if (!item) return;

  const actions = [];
  PT_RENAMABLE_KINDS.includes(kind) && actions.push({ id: "rename", label: ptT("rename"), shortcut: "F2" });
  const entity = ptGetEntity(kind, key);
  entity?.nome_manual && actions.push({ id: "auto_name", label: ptT("auto_name") });
  actions.push({ id: "goto", label: ptT("go_to") });
  (kind === "pivot" || kind === "bomba" || kind === "tower") && actions.push({ id: "visibility", label: item.hidden ? ptT("show") : ptT("hide") });
  (kind === "central" || kind === "repeater") && actions.push({ id: "visibility", label: item.hidden ? ptT("enable_coverage") : ptT("disable_coverage") });
  actions.push({ id: "copy", label: ptT("copy_coords") });
  kind === "pivot" && actions.push({ id: "delete", label: ptT("delete"), danger: true });

  const menu = document.createElement("div");
  menu.className = "pt-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", item.name);
  menu.innerHTML = actions.map((a) => `
    ${a.danger ? '<div class="pt-menu-sep" role="separator"></div>' : ""}
    <button type="button" role="menuitem" class="pt-menu-item ${a.danger ? "pt-menu-item--danger" : ""}" data-menu-action="${a.id}">
      <span>${escapeHtml(a.label)}</span>${a.shortcut ? `<kbd>${a.shortcut}</kbd>` : ""}
    </button>`).join("");

  // Vai dentro do #ui-wrapper (que tem transform: scale) pra ficar do
  // mesmo tamanho do resto da UI; as coordenadas do mouse são da tela,
  // então converte pra escala do wrapper.
  const host = document.getElementById("ui-wrapper") || document.body;
  host.appendChild(menu);
  const hostRect = host.getBoundingClientRect();
  const scale = host.offsetWidth ? hostRect.width / host.offsetWidth : 1;
  const menuRect = menu.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - menuRect.width - 8);
  const clampedY = Math.min(y, window.innerHeight - menuRect.height - 8);
  menu.style.left = `${(clampedX - hostRect.left) / scale}px`;
  menu.style.top = `${(clampedY - hostRect.top) / scale}px`;
  ProjectTree.menuEl = menu;

  menu.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-menu-action]");
    if (!btn) return;
    event.stopPropagation();
    ptCloseMenu();
    const action = btn.dataset.menuAction;
    if (action === "rename") ptStartRename(kind, key);
    else if (action === "auto_name") ptUseAutoName(ptGetEntity(kind, key));
    else if (action === "goto") ptGoTo(item);
    else if (action === "visibility") ptToggleItem(kind, item.key, item.hidden);
    else if (action === "copy") ptCopyCoords(item);
    else if (action === "delete") ptDeletePivot(item.key);
  });

  menu.querySelector(".pt-menu-item")?.focus();
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------

function setupProjectTree() {
  const root = document.getElementById("project-tree");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";

  document.getElementById("pt-open-btn")?.addEventListener("click", () => setProjectTreeOpen(true));
  document.getElementById("pt-close-btn")?.addEventListener("click", () => setProjectTreeOpen(false));

  document.getElementById("pt-search")?.addEventListener("input", (event) => {
    ProjectTree.query = event.target.value.trim();
    renderProjectTree();
  });

  const list = document.getElementById("pt-list");

  list.addEventListener("click", (event) => {
    const twisty = event.target.closest('[data-action="toggle-group"]');
    if (twisty) {
      const id = twisty.dataset.group;
      ProjectTree.collapsedGroups.has(id) ? ProjectTree.collapsedGroups.delete(id) : ProjectTree.collapsedGroups.add(id);
      renderProjectTree();
      return;
    }
    if (event.target.closest(".pt-check, .pt-rename-input")) return;

    const row = event.target.closest(".pt-row--item");
    row && ptGoTo(ptFindItem(row.dataset.kind, row.dataset.key));
  });

  list.addEventListener("change", (event) => {
    const el = event.target;
    if (el.dataset.action === "toggle-visibility") ptToggleItem(el.dataset.kind, el.dataset.key, el.checked);
    else if (el.dataset.action === "toggle-group-visibility") ptToggleGroupVisibility(el.dataset.group, el.checked);
  });

  list.addEventListener("dblclick", (event) => {
    const row = event.target.closest('.pt-row--item[data-renamable="1"]');
    if (!row || event.target.closest(".pt-check, .pt-rename-input")) return;
    ptStartRename(row.dataset.kind, row.dataset.key);
  });

  list.addEventListener("contextmenu", (event) => {
    const row = event.target.closest(".pt-row--item");
    if (!row || event.target.closest(".pt-rename-input")) return;
    event.preventDefault();
    ptOpenMenu(row, event.clientX, event.clientY);
  });

  list.addEventListener("keydown", (event) => {
    const input = event.target.closest(".pt-rename-input");
    if (input) {
      if (event.key === "Enter") { event.preventDefault(); ptCommitRename(input); }
      else if (event.key === "Escape") { event.preventDefault(); ptCancelRename(); }
      event.stopPropagation();
      return;
    }

    const row = event.target.closest(".pt-row--item");
    if (!row) return;
    if (event.key === "F2" && row.dataset.renamable === "1") {
      event.preventDefault();
      ptStartRename(row.dataset.kind, row.dataset.key);
    } else if (event.key === "Enter") {
      event.preventDefault();
      ptGoTo(ptFindItem(row.dataset.kind, row.dataset.key));
    } else if (event.key === " " && event.target === row) {
      const check = row.querySelector(".pt-check");
      if (check) {
        event.preventDefault();
        ptToggleItem(row.dataset.kind, row.dataset.key, !check.checked);
        list.querySelector(`.pt-row--item[data-kind="${row.dataset.kind}"][data-key="${CSS.escape(row.dataset.key)}"]`)?.focus();
      }
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      ptOpenMenu(row, rect.left + 24, rect.bottom);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const rows = [...list.querySelectorAll(".pt-row--item")];
      const next = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
      next?.focus();
    }
  });

  // Sair do campo clicando fora = salvar (igual Google Earth).
  list.addEventListener("focusout", (event) => {
    const input = event.target.closest?.(".pt-rename-input");
    if (!input || !ProjectTree.editing) return;
    setTimeout(() => {
      if (ProjectTree.editing && document.activeElement !== input && document.body.contains(input)) ptCommitRename(input);
    }, 0);
  });

  document.addEventListener("click", (event) => {
    ProjectTree.menuEl && !ProjectTree.menuEl.contains(event.target) && ptCloseMenu();
  });

  // Olho / lixeira no painel de repetidoras: mantém a árvore em sincronia.
  document.getElementById("lista-repetidoras")?.addEventListener("click", scheduleProjectTreeRender);
  document.addEventListener("keydown", (event) => {
    event.key === "Escape" && ProjectTree.menuEl && ptCloseMenu();
  });
  window.addEventListener("resize", ptCloseMenu);

  let startOpen = false;
  try { startOpen = localStorage.getItem(PT_STORAGE_KEY) === "1"; } catch (e) { /* storage indisponível */ }
  setProjectTreeOpen(startOpen);
  renderProjectTree();
  document.addEventListener("i18n:applied", renderProjectTree);
}

// ---------------------------------------------------------------------
// Ganchos: redesenha a árvore quando o app redesenha o estudo
// ---------------------------------------------------------------------

function ptWrapGlobal(name, after) {
  const original = window[name];
  if (typeof original != "function" || original.__ptWrapped) return;
  const wrapped = function (...args) {
    const result = original.apply(this, args);
    try { after(); } catch (err) { console.error(`[project-tree] ${name}:`, err); }
    return result;
  };
  wrapped.__ptWrapped = true;
  window[name] = wrapped;
}

(function initProjectTreeHooks() {
  ptWrapGlobal("drawPivos", () => { applyPivotVisibility(); scheduleProjectTreeRender(); });
  ptWrapGlobal("drawCirculos", applyPivotVisibility);
  ptWrapGlobal("drawAntenaCandidates", () => { applyTowerVisibility(); scheduleProjectTreeRender(); });
  ptWrapGlobal("drawBombas", () => { applyBombaVisibility(); scheduleProjectTreeRender(); });
  ptWrapGlobal("setCoverageVisibility", scheduleProjectTreeRender);
  ["atualizarPainelDados", "addRepetidoraNoPainel", "addAntenaAoPainel", "updateAntenaOrRepeaterLabel"]
    .forEach((fn) => ptWrapGlobal(fn, scheduleProjectTreeRender));

  // Reset / novo KMZ: esquece o que estava oculto e qualquer edição aberta.
  ptWrapGlobal("clearMapLayers", () => {
    ProjectTree.hiddenPivots.clear();
    ProjectTree.hiddenTowers.clear();
    ProjectTree.hiddenBombas.clear();
    ProjectTree.editing = null;
    scheduleProjectTreeRender();
  });

  // O modo de edição desenha pinos pra todos os pivôs: mostra tudo de novo.
  ptWrapGlobal("enablePivoEditingMode", () => {
    ProjectTree.hiddenPivots.clear();
    ProjectTree.editing = null;
    typeof drawCirculos == "function" && drawCirculos();
    scheduleProjectTreeRender();
  });

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", setupProjectTree)
    : setupProjectTree();
})();

window.renamePivot = renamePivot;
window.setProjectTreeOpen = setProjectTreeOpen;