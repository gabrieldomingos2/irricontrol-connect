const DEFAULT_LANG = "pt-br";
const SAFE_ATTRS = new Set(["title", "placeholder", "aria-label", "aria-describedby", "aria-controls", "alt", "value", "data-label"]);

let currentLanguage = DEFAULT_LANG;
const translationsCache = new Map();
let activeDict = {};

function normalizeLang(lang) {
  if (!lang) return DEFAULT_LANG;
  const normalized = String(lang).toLowerCase();
  return normalized.startsWith("pt") ? "pt-br"
    : normalized.startsWith("en") ? "en"
    : normalized.startsWith("es") ? "es"
    : normalized.startsWith("de") ? "de"
    : normalized.startsWith("ru") ? "ru"
    : DEFAULT_LANG;
}

function getNested(obj, path) {
  return path.split(".").reduce((acc, key) => acc && typeof acc == "object" ? acc[key] : undefined, obj);
}

function deepMerge(base, overrides) {
  const merged = Array.isArray(base) ? [...base] : { ...base };
  if (!overrides || typeof overrides != "object") return merged;
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = value && typeof value == "object" && !Array.isArray(value) ? deepMerge(merged[key] || {}, value) : value;
  }
  return merged;
}

function interpolate(text, params = {}) {
  if (typeof text != "string") return text;
  return Object.keys(params).reduce((result, key) => {
    const pattern = new RegExp(`\\{${key}\\}`, "g");
    return result.replace(pattern, String(params[key]));
  }, text);
}

function isValueAssignable(el) {
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

async function fetchLocaleDict(lang) {
  if (translationsCache.has(lang)) return translationsCache.get(lang);

  const base = (typeof window.I18N_LOCALES_BASE == "string" && window.I18N_LOCALES_BASE || "assets/locales").replace(/\/+$/, "");
  const url = `${base}/${lang}.json`;

  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Could not load ${lang}.json`);
    const dict = await response.json();
    translationsCache.set(lang, dict);
    return dict;
  } catch (err) {
    console.warn(`i18n: failed to load ${lang}.json ->`, err);
    translationsCache.set(lang, {});
    return {};
  }
}

async function loadTranslations(lang) {
  const normalized = normalizeLang(lang);
  const isDefault = normalized === DEFAULT_LANG;
  const defaultDict = await fetchLocaleDict(DEFAULT_LANG);
  const targetDict = isDefault ? defaultDict : await fetchLocaleDict(normalized);
  activeDict = isDefault ? defaultDict : deepMerge(defaultDict, targetDict);
  currentLanguage = normalized;
}

function t(key, params = {}) {
  const value = getNested(activeDict, key);
  if (value == null) {
    console.warn(`i18n: key not found '${key}' in ${currentLanguage}`);
    return interpolate(key, params);
  }
  return interpolate(value, params);
}

function applyTranslationTo(el) {
  const key = el.getAttribute("data-i18n");
  if (!key) return;

  let args = {};
  const rawArgs = el.getAttribute("data-i18n-args");
  if (rawArgs) {
    const trimmed = String(rawArgs).trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        args = JSON.parse(trimmed);
      } catch (err) {
        console.warn("i18n: invalid data-i18n-args, ignoring:", trimmed, err, el);
        args = {};
      }
    } else {
      console.warn("i18n: data-i18n-args does not look like JSON, ignoring:", trimmed, el);
    }
  }

  const targets = (el.getAttribute("data-i18n-attr") || "textContent").split(",").map((s) => s.trim()).filter(Boolean);

  for (const target of targets) {
    if (target === "textContent") {
      el.textContent = t(key, args);
      continue;
    }
    if (!SAFE_ATTRS.has(target)) {
      console.warn(`i18n: disallowed attribute "${target}" for key '${key}'`, el);
      continue;
    }
    if (target === "value" && !isValueAssignable(el)) {
      console.warn(`i18n: attribute "value" skipped on <${el.tagName.toLowerCase()}> for key '${key}'`);
      continue;
    }
    el.setAttribute(target, t(key, args));
  }
}

function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(applyTranslationTo);

  const resetBtn = document.getElementById("resetar-btn");
  resetBtn && resetBtn.setAttribute("title", t("tooltips.reset"));

  const titleEl = document.querySelector("head title[data-i18n]");
  titleEl && (document.title = titleEl.textContent);

  document.dispatchEvent(new CustomEvent("i18n:applied", { detail: { lang: currentLanguage } }));
}

async function setLanguage(lang) {
  await loadTranslations(lang);
  applyTranslations();
  localStorage.setItem("preferredLanguage", currentLanguage);
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = "ltr";
}

async function initI18n() {
  const savedLang = localStorage.getItem("preferredLanguage");
  const browserLang = normalizeLang(navigator.language || navigator.userLanguage);
  await setLanguage(savedLang || browserLang || DEFAULT_LANG);

  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.getAttribute("data-lang");
      setLanguage(lang);
    });
  });
}

window.t = t;
window.setLanguage = setLanguage;
window.applyTranslations = applyTranslations;
window.getCurrentLanguage = () => currentLanguage;

document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", initI18n, { once: true })
  : initI18n();
