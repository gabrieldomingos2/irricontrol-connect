// assets/js/api.js

// -------- Config --------
const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const BACKEND_URL =
  window.BACKEND_URL ||
  (isLocal ? "http://localhost:8000" : "https://irricontrol-connect.onrender.com");

const API_PREFIX = window.API_PREFIX || "/api/v1";

// Helpers globais opcionais
const safeT = (...args) =>
  (typeof window.t === "function" ? window.t(...args) : args[0]);
const notify = (msg, tipo = "info") =>
  (typeof window.mostrarMensagem === "function"
    ? window.mostrarMensagem(msg, tipo)
    : console[(tipo === "erro" ? "error" : "log")](msg));

// -------- Core fetch wrapper --------
function buildUrl(endpoint) {
  const base = BACKEND_URL.replace(/\/+$/, "");
  const prefix = API_PREFIX.replace(/\/+$/, "");
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${prefix}${path}`;
}

function pickErrorMessage(obj, fallback) {
  if (!obj || typeof obj !== "object") return fallback;
  return (
    obj.detail ||
    obj.message ||
    obj.error ||
    obj.errors ||
    obj.title ||
    fallback
  );
}

function parseFilenameFromContentDisposition(disposition, fallback) {
  // RFC 6266: filename*=UTF-8''name.ext  |  filename="name.ext"
  if (!disposition) return fallback;
  try {
    const star = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(disposition);
    if (star && star[2]) return decodeURIComponent(star[2].trim());

    const plain = /filename[^;=\n]*=\s*((['"]).*?\2|[^;\n]*)/i.exec(disposition);
    if (plain && plain[1]) return plain[1].replace(/['"]/g, "").trim();
  } catch {}
  return fallback;
}

// Gera um X-Request-ID simples p/ correlação com o backend
function _makeRequestId() {
  // RFC4122-ish (suficiente para correlação de logs)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * API request com timeout, parse inteligente e suporte a blob.
 * options:
 *   - method, headers, body
 *   - expects: 'json' | 'blob' | 'text'  (ou manter responseType: 'blob' por compat)
 *   - timeoutMs: número (default 180000)
 */
async function apiRequest(endpoint, options = {}) {
  const {
    timeoutMs = 180000,
    expects = options.responseType === "blob" ? "blob" : "json",
    ...fetchOpts
  } = options;

  // Define cabeçalhos padrão
  fetchOpts.headers = fetchOpts.headers || {};
  if (
    fetchOpts.body &&
    typeof fetchOpts.body === "string" &&
    !("Content-Type" in fetchOpts.headers)
  ) {
    fetchOpts.headers["Content-Type"] = "application/json";
  }
  if (!("Accept" in fetchOpts.headers) && expects !== "blob") {  fetchOpts.headers["Accept"] = "application/json"; }
  if (window.AppState?.templateOverrideEnabled && !("X-Template-Unlock" in fetchOpts.headers)) { fetchOpts.headers["X-Template-Unlock"] = "1"; }
  // Injeta X-Request-ID para correlação com logs do backend (middleware)
  if (!("X-Request-ID" in fetchOpts.headers)) {
    fetchOpts.headers["X-Request-ID"] = _makeRequestId();
  }

  // ✅ Injeta Authorization automaticamente (se tiver token do login)
  const token = window.Auth?.getToken?.();
  if (token && !("Authorization" in fetchOpts.headers)) {
    fetchOpts.headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  fetchOpts.signal = controller.signal;

  const url = buildUrl(endpoint);

  try {
    const response = await fetch(url, fetchOpts);


    // HTTP error handling
    if (!response.ok) {
      let errorPayload = null;
      try {
        errorPayload = await response.clone().json();
      } catch {
        // tenta texto simples
        try {
          const txt = await response.text();
          errorPayload = { detail: txt || response.statusText };
        } catch {}
      }
      const msg = pickErrorMessage(
        errorPayload,
        response.statusText || "Erro de comunicação com o servidor"
      );
      throw new Error(`Erro ${response.status}: ${msg}`);
    }

    // No Content
    if (response.status === 204) {
      return null;
    }

    // Conteúdo binário
    if (expects === "blob") {
      return response; // o chamador decide o que fazer com o blob
    }

    // JSON por padrão
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      return await response.json();
    }
    // fallback texto
    return await response.text();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Tempo de solicitação esgotado (timeout).");
    }
    console.error(`Erro na requisição ${url}:`, error);
    throw error;
  } finally {
    clearTimeout(id);
  }
}

// -------- Funções de API --------

async function startEmptyJob() {
  return apiRequest("/kmz/iniciar_job_vazio", { method: "POST" }).catch(
    (error) => {
      notify(`Não foi possível iniciar uma nova sessão: ${error.message}`, "erro");
      throw error;
    }
  );
}

async function processKmz(formData) {
  return apiRequest("/kmz/processar", {
    method: "POST",
    body: formData, // não defina Content-Type manualmente para FormData
  }).catch((error) => {
    notify(`Falha ao carregar KMZ: ${error.message}`, "erro");
    throw error;
  });
}

function friendlyCloudRFError(message) {
  if (/401/.test(message) && /key/i.test(message)) {
    return "Falha na simulação: credenciais da CloudRF ausentes ou inválidas (verifique CLOUDRF_API_KEY no backend).";
  }
  return `Falha na simulação: ${message}`;
}

async function simulateSignal(payload) {
  return apiRequest("/simulation/run_main", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch((error) => {
    notify(friendlyCloudRFError(error.message), "erro");
    throw error;
  });
}

async function simulateManual(payload) {
  return apiRequest("/simulation/run_manual", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch((error) => {
    notify(friendlyCloudRFError(error.message), "erro");
    throw error;
  });
}

async function reevaluatePivots(payload) {
  return apiRequest("/simulation/reevaluate", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch((error) => {
    notify(`Falha ao reavaliar cobertura: ${error.message}`, "erro");
    throw error;
  });
}

async function getTemplates() {
  try {
    const response = await apiRequest("/simulation/templates");
    if (Array.isArray(response)) {
      return { templates: response, disabled: [] };
    }
    if (response && Array.isArray(response.templates)) {
      return {
        templates: response.templates,
        disabled: Array.isArray(response.disabled) ? response.disabled : [],
      };
    }
    throw new Error("Formato inesperado ao carregar templates");
  } catch (error) {
    notify(`Falha ao buscar templates: ${error.message}`, "erro");
    throw error;
  }
}

async function getElevationProfile(payload) {
  return apiRequest("/simulation/elevation_profile", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch((error) => {
    notify(`Falha no diagnóstico de visada: ${error.message}`, "erro");
    throw error;
  });
}

async function downloadBlobResponse(response, fallbackName) {
  const disposition = response.headers.get("content-disposition");
  const filename = parseFilenameFromContentDisposition(disposition, fallbackName);
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}

async function exportKmz(payload) {
  try {
    const response = await apiRequest("/kmz/exportar", {
      method: "POST",
      body: JSON.stringify(payload),
      expects: "blob",
    });
    await downloadBlobResponse(response, "estudo-irricontrol.kmz");
  } catch (error) {
    notify(`Falha ao exportar KMZ: ${error.message}`, "erro");
    throw error;
  }
}

async function findHighPointsForRepeater(payload) {
  return apiRequest("/simulation/find_repeater_sites", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch((error) => {
    notify(`Falha na busca por locais de repetidora: ${error.message}`, "erro");
    throw error;
  });
}

async function generatePivotInCircle(payload) {
  return apiRequest("/simulation/generate_pivot_in_circle", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch((error) => {
    notify(`Falha ao criar pivô: ${error.message}`, "erro");
    throw error;
  });
}

// Tenta primeiro underscore, se der 404 tenta hyphen (ou vice-versa)
async function optimizeNetwork(payload) {
  const opts = { method: "POST", body: JSON.stringify(payload) };
  try {
    return await apiRequest("/simulation/optimize_network", opts);
  } catch (err1) {
    if (/Erro 404/.test(err1.message)) {
      try {
        return await apiRequest("/simulation/optimize-network", opts);
      } catch (err2) {
        notify(`Falha ao otimizar rede: ${err2.message}`, "erro");
        throw err2;
      }
    }
    notify(`Falha ao otimizar rede: ${err1.message}`, "erro");
    throw err1;
  }
}

async function exportPdfReport(payload) {
  try {
    const response = await apiRequest("/report/pdf_export", {
      method: "POST",
      body: JSON.stringify(payload),
      expects: "blob",
    });
    await downloadBlobResponse(response, "relatorio-irricontrol.pdf");
  } catch (error) {
    notify(
      safeT("Falha ao exportar PDF: {error}", { error: error.message }),
      "erro"
    );
    throw error;
  }
}

