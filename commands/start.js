const { upsertTelegramUser } = require('../services/linkService');
const { ensureUserLanguage } = require('../services/settingsService');

module.exports = async function startCommand(ctx) {
  if (ctx.from) {
    try {
      await upsertTelegramUser(ctx.from);
      if (!ctx.chat?.type || ctx.chat.type === 'private') {
        await ensureUserLanguage(ctx.from.id, ctx.from.language_code);
      }
    } catch (err) {
      console.warn('[/start] user bootstrap failed:', err.message);
    }
  }

  const text = ctx.t
    ? ctx.t('start.message')
    : 'Hi! Use /help and /setting.';

  return ctx.reply(text);
};
