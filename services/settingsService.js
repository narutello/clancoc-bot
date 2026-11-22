const { query } = require('../database');
const {
  DEFAULT_LANG,
  normalizeLang,
  detectFromTelegramLanguageCode,
} = require('../utils/i18n');

/** Default notification flags (attack off by default). */
const DEFAULT_NOTIFY = {
  war: {
    preparation: true,
    battle_start: true,
    one_hour_left: true,
    war_ended: true,
    attack: false,
  },
  cwl: {
    preparation: true,
    battle_start: true,
    one_hour_left: true,
    war_ended: true,
    attack: false,
  },
  capital: {
    raid_start: true,
    raid_ended: true,
    reminder: true,
  },
};

const NOTIFY_KEYS = [
  'preparation',
  'battle_start',
  'one_hour_left',
  'war_ended',
  'attack',
];

const CAPITAL_NOTIFY_KEYS = ['raid_start', 'raid_ended', 'reminder'];

/** Short in-memory TTL for chat_settings / user language (phase 4). */
const CACHE_TTL_MS = 45 * 1000;
/** @type {Map<string, { expires: number, value: any }>} */
const chatSettingsCache = new Map();
/** @type {Map<string, { expires: number, value: any }>} */
const userLangCache = new Map();

function cacheGet(map, key) {
  try {
    const k = String(key);
    const entry = map.get(k);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      map.delete(k);
      return undefined;
    }
    return entry.value;
  } catch {
    return undefined;
  }
}

function cacheSet(map, key, value) {
  try {
    map.set(String(key), { expires: Date.now() + CACHE_TTL_MS, value });
  } catch {
    // never break settings path on cache errors
  }
}

function cacheDel(map, key) {
  try {
    map.delete(String(key));
  } catch {
    // ignore
  }
}

function mergeNotify(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    war: { ...DEFAULT_NOTIFY.war },
    cwl: { ...DEFAULT_NOTIFY.cwl },
    capital: { ...DEFAULT_NOTIFY.capital },
  };
  for (const scope of ['war', 'cwl']) {
    const block = src[scope] && typeof src[scope] === 'object' ? src[scope] : {};
    for (const key of NOTIFY_KEYS) {
      if (typeof block[key] === 'boolean') out[scope][key] = block[key];
    }
  }
  const cap =
    src.capital && typeof src.capital === 'object' ? src.capital : {};
  for (const key of CAPITAL_NOTIFY_KEYS) {
    if (typeof cap[key] === 'boolean') out.capital[key] = cap[key];
  }
  return out;
}

async function getChatSettingsRow(chatId) {
  if (chatId == null) return null;
  const key = String(chatId);
  const cached = cacheGet(chatSettingsCache, key);
  if (cached !== undefined) return cached;

  const res = await query(
    `SELECT language, settings_json FROM chat_settings WHERE chat_id = $1`,
    [key]
  );
  const row = res.rows[0] || null;
  cacheSet(chatSettingsCache, key, row);
  return row;
}

async function getChatLanguage(chatId) {
  if (chatId == null) return DEFAULT_LANG;
  const row = await getChatSettingsRow(chatId);
  const lang = normalizeLang(row?.language);
  return lang || DEFAULT_LANG;
}

async function setChatLanguage(chatId, language) {
  const lang = normalizeLang(language) || DEFAULT_LANG;
  const key = String(chatId);
  await query(
    `INSERT INTO chat_settings (chat_id, language, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       language = EXCLUDED.language,
       updated_at = NOW()`,
    [key, lang]
  );
  cacheDel(chatSettingsCache, key);
  return lang;
}

async function getNotifySettings(chatId) {
  const row = await getChatSettingsRow(chatId);
  const json = row?.settings_json || {};
  return mergeNotify(json.notify);
}

function resolveNotifyScope(scope) {
  if (scope === 'cwl') return 'cwl';
  if (scope === 'capital') return 'capital';
  return 'war';
}

async function isNotifyEnabled(chatId, scope, key) {
  const s = resolveNotifyScope(scope);
  const settings = await getNotifySettings(chatId);
  if (s === 'capital') {
    if (!CAPITAL_NOTIFY_KEYS.includes(key)) return true;
    return Boolean(settings.capital[key]);
  }
  if (!NOTIFY_KEYS.includes(key)) return true;
  return Boolean(settings[s][key]);
}

async function toggleNotifySetting(chatId, scope, key) {
  const s = resolveNotifyScope(scope);
  const allowed =
    s === 'capital' ? CAPITAL_NOTIFY_KEYS : NOTIFY_KEYS;
  if (!allowed.includes(key)) {
    throw new Error(`Unknown notify key: ${key}`);
  }

  const row = await getChatSettingsRow(chatId);
  const currentJson =
    row?.settings_json && typeof row.settings_json === 'object'
      ? { ...row.settings_json }
      : {};
  const notify = mergeNotify(currentJson.notify);
  notify[s][key] = !notify[s][key];
  currentJson.notify = notify;

  const keyId = String(chatId);
  await query(
    `INSERT INTO chat_settings (chat_id, language, settings_json, updated_at)
     VALUES ($1, COALESCE($2, 'fa'), $3::jsonb, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       settings_json = EXCLUDED.settings_json,
       updated_at = NOW()`,
    [
      keyId,
      row?.language || DEFAULT_LANG,
      JSON.stringify(currentJson),
    ]
  );
  cacheDel(chatSettingsCache, keyId);
  return notify;
}

async function getUserLanguage(userId) {
  if (userId == null) return DEFAULT_LANG;
  const key = String(Number(userId));
  const cached = cacheGet(userLangCache, key);
  if (cached !== undefined) return cached;

  const res = await query(
    `SELECT language FROM user_settings WHERE user_id = $1`,
    [Number(userId)]
  );
  const lang = normalizeLang(res.rows[0]?.language);
  const value = lang || null;
  cacheSet(userLangCache, key, value);
  return value;
}

async function setUserLanguage(userId, language) {
  const lang = normalizeLang(language) || DEFAULT_LANG;
  const key = String(Number(userId));
  await query(
    `INSERT INTO user_settings (user_id, language, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       language = EXCLUDED.language,
       updated_at = NOW()`,
    [Number(userId), lang]
  );
  cacheDel(userLangCache, key);
  cacheSet(userLangCache, key, lang);
  return lang;
}

async function ensureUserLanguage(userId, languageCode) {
  const existing = await getUserLanguage(userId);
  if (existing) return existing;
  const detected = detectFromTelegramLanguageCode(languageCode);
  return setUserLanguage(userId, detected);
}

async function resolveLangForCtx(ctx) {
  const chatType = ctx.chat?.type;
  if (chatType === 'group' || chatType === 'supergroup') {
    return getChatLanguage(ctx.chat.id);
  }
  if (ctx.from?.id) {
    return ensureUserLanguage(ctx.from.id, ctx.from.language_code);
  }
  return DEFAULT_LANG;
}

module.exports = {
  DEFAULT_NOTIFY,
  NOTIFY_KEYS,
  CAPITAL_NOTIFY_KEYS,
  getChatLanguage,
  setChatLanguage,
  getNotifySettings,
  isNotifyEnabled,
  toggleNotifySetting,
  getUserLanguage,
  setUserLanguage,
  ensureUserLanguage,
  resolveLangForCtx,
};
