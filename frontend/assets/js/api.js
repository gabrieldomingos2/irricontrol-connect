const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BACKEND_URL = window.BACKEND_URL || (isLocal ? "http://localhost:8000" : "https://irricontrol-connect.onrender.com");
const API_PREFIX = window.API_PREFIX || "/api/v1";

const safeT = (...args) => typeof window.t == "function" ? window.t(...args) : args[0];
const notify = (message, type = "info") => typeof window.mostrarMensagem == "function" ? window.mostrarMensagem(message, type) : console[type === "erro" ? "error" : "log"](message);

const tOr = (key, fallback) => {
  if (typeof window.t == "function") {
    const translated = window.t(key);
    if (translated && translated !== key) return translated;
  }
  return fallback;
};

let _lastAuthErrorAt = 0;

function handleUnauthorized(message) {
  const now = Date.now();
  if (now - _lastAuthErrorAt < 2000) return;
  _lastAuthErrorAt = now;
  const finalMessage = message || tOr("messages.errors.session_expired", "Sessao expirada. Faca login novamente.");
  window.Auth?.logout?.({ message: finalMessage });
}

function buildUrl(path) {
  const backend = BACKEND_URL.replace(/\/+$/, "");
  const prefix = API_PREFIX.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${backend}${prefix}${normalizedPath}`;
}

function pickErrorMessage(errorBody, fallback) {
  return !errorBody || typeof errorBody != "object" ? fallback : errorBody.detail || errorBody.message || errorBody.error || errorBody.errors || errorBody.title || fallback;
}

function parseFilenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  try {
    const encodedMatch = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(header);
    if (encodedMatch?.[2]) return decodeURIComponent(encodedMatch[2].trim());
    const plainMatch = /filename[^;=\n]*=\s*((['"]).*?\2|[^;\n]*)/i.exec(header);
    if (plainMatch?.[1]) return plainMatch[1].replace(/['"]/g, "").trim();
  } catch {}
  return fallback;
}

function generateRequestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16 | 0;
    return (char === "x" ? rand : rand & 3 | 8).toString(16);
  });
}

async function apiRequest(path, options = {}) {
  const {
    timeoutMs = 180000,
    expects = options.responseType === "blob" ? "blob" : "json",
    ...fetchOptions
  } = options;

  fetchOptions.headers = fetchOptions.headers || {};
  fetchOptions.body && typeof fetchOptions.body == "string" && !("Content-Type" in fetchOptions.headers) && (fetchOptions.headers["Content-Type"] = "application/json");
  !("Accept" in fetchOptions.headers) && expects !== "blob" && (fetchOptions.headers.Accept = "application/json");
  window.AppState?.templateOverrideEnabled && !("X-Template-Unlock" in fetchOptions.headers) && (fetchOptions.headers["X-Template-Unlock"] = "1");
  "X-Request-ID" in fetchOptions.headers || (fetchOptions.headers["X-Request-ID"] = generateRequestId());

  const token = window.Auth?.getToken?.();
  token && !("Authorization" in fetchOptions.headers) && (fetchOptions.headers.Authorization = `Bearer ${token}`);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  fetchOptions.signal = abortController.signal;

  const url = buildUrl(path);
  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      let errorBody = null;
      try {
        errorBody = await response.clone().json();
      } catch {
        try {
          errorBody = { detail: await response.text() || response.statusText };
        } catch {}
      }
      const errorMessage = pickErrorMessage(errorBody, response.statusText || "Erro de comunicação com o servidor");
      response.status === 401 && handleUnauthorized();
      throw new Error(`Erro ${response.status}: ${errorMessage}`);
    }
    if (response.status === 204) return null;
    if (expects === "blob") return response;
    return (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.text();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Tempo de solicitação esgotado (timeout).");
    console.error(`Erro na requisição ${url}:`, err);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function startEmptyJob() {
  return apiRequest("/kmz/iniciar_job_vazio", {
    method: "POST"
  }).catch((err) => {
    notify(`Não foi possível iniciar uma nova sessão: ${err.message}`, "erro");
    throw err;
  });
}

async function processKmz(formData) {
  return apiRequest("/kmz/processar", {
    method: "POST",
    body: formData
  }).catch((err) => {
    notify(`Falha ao carregar KMZ: ${err.message}`, "erro");
    throw err;
  });
}

function friendlyCloudRFError(message) {
  return /401/.test(message) && /key/i.test(message) ? "Falha na simulação: credenciais da CloudRF ausentes ou inválidas (verifique CLOUDRF_API_KEY no backend)." : `Falha na simulação: ${message}`;
}

async function simulateSignal(payload) {
  return apiRequest("/simulation/run_main", {
    method: "POST",
    body: JSON.stringify(payload)
  }).catch((err) => {
    notify(friendlyCloudRFError(err.message), "erro");
    throw err;
  });
}

async function simulateManual(payload) {
  return apiRequest("/simulation/run_manual", {
    method: "POST",
    body: JSON.stringify(payload)
  }).catch((err) => {
    notify(friendlyCloudRFError(err.message), "erro");
    throw err;
  });
}

async function reevaluatePivots(payload) {
  return apiRequest("/simulation/reevaluate", {
    method: "POST",
    body: JSON.stringify(payload)
  }).catch((err) => {
    notify(`Falha ao reavaliar cobertura: ${err.message}`, "erro");
    throw err;
  });
}

async function getTemplates() {
  try {
    const result = await apiRequest("/simulation/templates");
    if (Array.isArray(result)) return { templates: result, disabled: [] };
    if (result && Array.isArray(result.templates)) {
      return {
        templates: result.templates,
        disabled: Array.isArray(result.disabled) ? result.disabled : []
      };
    }
    throw new Error("Formato inesperado ao carregar templates");
  } catch (err) {
    notify(`Falha ao buscar templates: ${err.message}`, "erro");
    throw err;
  }
}

async function getElevationProfile(payload) {
  return apiRequest("/simulation/elevation_profile", {
    method: "POST",
    body: JSON.stringify(payload)
  }).catch((err) => {
    notify(`Falha no diagnóstico de visada: ${err.message}`, "erro");
    throw err;
  });
}

async function pickSaveTarget(suggestedName) {
  if (typeof window.showSaveFilePicker != "function") return null;
  const ext = suggestedName.includes(".") ? suggestedName.split(".").pop() : "";
  return window.showSaveFilePicker({
    suggestedName,
    types: ext ? [{
      description: ext.toUpperCase(),
      accept: { "application/octet-stream": [`.${ext}`] }
    }] : undefined
  });
}

async function saveBlobToTarget(fileHandle, blob, filename) {
  if (fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.style.display = "none";
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(objectUrl);
  link.remove();
}

async function exportKmz(payload, fileHandle) {
  try {
    const response = await apiRequest("/kmz/exportar", {
      method: "POST",
      body: JSON.stringify(payload),
      expects: "blob"
    });
    const filename = parseFilenameFromContentDisposition(response.headers.get("content-disposition"), "estudo-irricontrol.kmz");
    const blob = await response.blob();
    await saveBlobToTarget(fileHandle, blob, filename);
  } catch (err) {
    notify(`Falha ao exportar KMZ: ${err.message}`, "erro");
    throw err;
  }
}

async function findHighPointsForRepeater(payload) {
  return apiRequest("/simulation/find_repeater_sites", {
    method: "POST",
    body: JSON.stringify(payload)
  }).catch((err) => {
    notify(`Falha na busca por locais de repetidora: ${err.message}`, "erro");
    throw err;
  });
}

async function generatePivotInCircle(payload) {
  return apiRequest("/simulation/generate_pivot_in_circle", {
    method: "POST",
    body: JSON.stringify(payload)
  }).catch((err) => {
    notify(`Falha ao criar pivô: ${err.message}`, "erro");
    throw err;
  });
}

async function optimizeNetwork(payload) {
  const requestOptions = {
    method: "POST",
    body: JSON.stringify(payload)
  };
  try {
    return await apiRequest("/simulation/optimize_network", requestOptions);
  } catch (err) {
    if (/Erro 404/.test(err.message)) {
      try {
        return await apiRequest("/simulation/optimize-network", requestOptions);
      } catch (fallbackErr) {
        notify(`Falha ao otimizar rede: ${fallbackErr.message}`, "erro");
        throw fallbackErr;
      }
    }
    notify(`Falha ao otimizar rede: ${err.message}`, "erro");
    throw err;
  }
}

async function exportPdfReport(payload, fileHandle) {
  try {
    const response = await apiRequest("/report/pdf_export", {
      method: "POST",
      body: JSON.stringify(payload),
      expects: "blob"
    });
    const filename = parseFilenameFromContentDisposition(response.headers.get("content-disposition"), "relatorio-irricontrol.pdf");
    const blob = await response.blob();
    await saveBlobToTarget(fileHandle, blob, filename);
  } catch (err) {
    notify(safeT("Falha ao exportar PDF: {error}", { error: err.message }), "erro");
    throw err;
  }
}

async function exportBundle(payload, fileHandle) {
  try {
    const response = await apiRequest("/report/export_bundle", {
      method: "POST",
      body: JSON.stringify(payload),
      expects: "blob"
    });
    const filename = parseFilenameFromContentDisposition(response.headers.get("content-disposition"), "relatorio-irricontrol.zip");
    const blob = await response.blob();
    await saveBlobToTarget(fileHandle, blob, filename);
  } catch (err) {
    notify(safeT("Falha ao exportar relatório: {error}", { error: err.message }), "erro");
    throw err;
  }
}
