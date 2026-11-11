const i18next = require('i18next');
const fa = require('../locales/fa.json');
const en = require('../locales/en.json');

const SUPPORTED = ['fa', 'en'];
const DEFAULT_LANG = 'fa';

let ready = false;
let initPromise = null;

function normalizeLang(code) {
  if (!code) return null;
  const base = String(code).trim().toLowerCase().split(/[-_]/)[0];
  if (SUPPORTED.includes(base)) return base;
  return null;
}

/** Map Telegram language_code → supported lang; default fa */
function detectFromTelegramLanguageCode(languageCode) {
  const n = normalizeLang(languageCode);
  return n || DEFAULT_LANG;
}

async function initI18n() {
  if (ready) return i18next;
  if (initPromise) return initPromise;

  initPromise = i18next.init({
    lng: DEFAULT_LANG,
    fallbackLng: DEFAULT_LANG,
    supportedLngs: SUPPORTED,
    nonExplicitSupportedLngs: true,
    resources: {
      fa: { translation: fa },
      en: { translation: en },
    },
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
    returnEmptyString: false,
  }).then(() => {
    ready = true;
    return i18next;
  });

  return initPromise;
}

/**
 * Translate a key for an explicit language (never mutates global lng).
 * @param {string} key
 * @param {object} [options]
 * @param {string} [options.lng]
 */
function t(key, options = {}) {
  const lng = normalizeLang(options.lng) || DEFAULT_LANG;
  const { lng: _ignored, ...rest } = options;
  if (!ready) {
    // Sync fallback before init finishes — still scoped by lng via clone
    return i18next.t(key, { lng, ...rest });
  }
  return i18next.t(key, { lng, ...rest });
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
