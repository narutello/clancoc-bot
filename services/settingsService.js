const { query } = require('../database');
const {
  DEFAULT_LANG,
  normalizeLang,
  detectFromTelegramLanguageCode,
} = require('../utils/i18n');

async function getChatLanguage(chatId) {
  if (chatId == null) return DEFAULT_LANG;
  const res = await query(
    `SELECT language FROM chat_settings WHERE chat_id = $1`,
    [String(chatId)]
  );
  const lang = normalizeLang(res.rows[0]?.language);
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

/**
 * Ensure private user has a language row (Telegram language on first touch).
 */
async function ensureUserLanguage(userId, languageCode) {
  const existing = await getUserLanguage(userId);
  if (existing) return existing;
  const detected = detectFromTelegramLanguageCode(languageCode);
  return setUserLanguage(userId, detected);
}

/**
 * Resolve language for a Telegram update context.
 * Group/supergroup → chat settings
 * Private → user settings (with first-touch detection)
 */
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
  getChatLanguage,
  setChatLanguage,
  getUserLanguage,
  setUserLanguage,
  ensureUserLanguage,
  resolveLangForCtx,
};
