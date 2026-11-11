const faBase = require('../locales/fa.json');
const enBase = require('../locales/en.json');

let faExtra = {};
let enExtra = {};
try {
  faExtra = require('../locales/fa-extra.json');
} catch (_) {}
try {
  enExtra = require('../locales/en-extra.json');
} catch (_) {}

function mergeDeep(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === 'object'
    ) {
      out[k] = { ...out[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

const catalogs = {
  fa: mergeDeep(faBase, faExtra),
  en: mergeDeep(enBase, enExtra),
};

const SUPPORTED = ['fa', 'en'];
const DEFAULT_LANG = 'fa';

function normalizeLang(code) {
  if (!code) return null;
  const base = String(code).trim().toLowerCase().split(/[-_]/)[0];
  if (SUPPORTED.includes(base)) return base;
  return null;
}

function detectFromTelegramLanguageCode(languageCode) {
  const n = normalizeLang(languageCode);
  return n || DEFAULT_LANG;
}

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function interpolate(str, params) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (params && Object.prototype.hasOwnProperty.call(params, key)) {
      const v = params[key];
      return v == null ? '' : String(v);
    }
    return '';
  });
}

function t(key, options = {}) {
  const lng = normalizeLang(options.lng) || DEFAULT_LANG;
  const { lng: _ignored, ...params } = options;

  let value = getByPath(catalogs[lng], key);
  if (value == null && lng !== DEFAULT_LANG) {
    value = getByPath(catalogs[DEFAULT_LANG], key);
  }
  if (value == null) return key;
  if (typeof value !== 'string') return String(value);
  return interpolate(value, params);
}

async function initI18n() {
  return true;
}

function isRtl(lang) {
  return (normalizeLang(lang) || DEFAULT_LANG) === 'fa';
}

function languageLabel(lang, uiLang) {
  const code = normalizeLang(lang) || DEFAULT_LANG;
  return t(`lang.name.${code}`, { lng: uiLang || code });
}

module.exports = {
  SUPPORTED,
  DEFAULT_LANG,
  initI18n,
  t,
  normalizeLang,
  detectFromTelegramLanguageCode,
  isRtl,
  languageLabel,
};
