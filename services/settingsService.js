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
};

const NOTIFY_KEYS = [
  'preparation',
  'battle_start',
  'one_hour_left',
  'war_ended',
  'attack',
];

function mergeNotify(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { war: { ...DEFAULT_NOTIFY.war }, cwl: { ...DEFAULT_NOTIFY.cwl } };
  for (const scope of ['war', 'cwl']) {
    const block = src[scope] && typeof src[scope] === 'object' ? src[scope] : {};
    for (const key of NOTIFY_KEYS) {
      if (typeof block[key] === 'boolean') out[scope][key] = block[key];
    }
  }
  return out;
}

async function getChatSettingsRow(chatId) {
  if (chatId == null) return null;
  const res = await query(
    `SELECT language, settings_json FROM chat_settings WHERE chat_id = $1`,
    [String(chatId)]
  );
  return res.rows[0] || null;
}

async function getChatLanguage(chatId) {
  if (chatId == null) return DEFAULT_LANG;
  const row = await getChatSettingsRow(chatId);
  const lang = normalizeLang(row?.language);
  return lang || DEFAULT_LANG;
}

async function setChatLanguage(chatId, language) {
  const lang = normalizeLang(language) || DEFAULT_LANG;
  await query(
    `INSERT INTO chat_settings (chat_id, language, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       language = EXCLUDED.language,
       updated_at = NOW()`,
    [String(chatId), lang]
  );
  return lang;
}

async function getNotifySettings(chatId) {
  const row = await getChatSettingsRow(chatId);
  const json = row?.settings_json || {};
  return mergeNotify(json.notify);
}

async function isNotifyEnabled(chatId, scope, key) {
  const s = scope === 'cwl' ? 'cwl' : 'war';
  const k = NOTIFY_KEYS.includes(key) ? key : null;
  if (!k) return true;
  const settings = await getNotifySettings(chatId);
  return Boolean(settings[s][k]);
}

async function toggleNotifySetting(chatId, scope, key) {
  const s = scope === 'cwl' ? 'cwl' : 'war';
  if (!NOTIFY_KEYS.includes(key)) {
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

  await query(
    `INSERT INTO chat_settings (chat_id, language, settings_json, updated_at)
     VALUES ($1, COALESCE($2, 'fa'), $3::jsonb, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       settings_json = EXCLUDED.settings_json,
       updated_at = NOW()`,
    [
      String(chatId),
      row?.language || DEFAULT_LANG,
      JSON.stringify(currentJson),
    ]
  );
  return notify;
}

async function getUserLanguage(userId) {
  if (userId == null) return DEFAULT_LANG;
  const res = await query(
    `SELECT language FROM user_settings WHERE user_id = $1`,
    [Number(userId)]
  );
  const lang = normalizeLang(res.rows[0]?.language);
  return lang || null;
}

async function setUserLanguage(userId, language) {
  const lang = normalizeLang(language) || DEFAULT_LANG;
  await query(
    `INSERT INTO user_settings (user_id, language, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       language = EXCLUDED.language,
       updated_at = NOW()`,
    [Number(userId), lang]
  );
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
