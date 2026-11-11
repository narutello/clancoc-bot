const { t, DEFAULT_LANG } = require('./i18n');

async function sendLoading(ctx, text) {
  const lang = ctx.lang || DEFAULT_LANG;
  const msg =
    text ||
    (typeof ctx.t === 'function'
      ? ctx.t('loading.default')
      : t('loading.default', { lng: lang }));
  try {
    return await ctx.reply(msg);
  } catch (err) {
    console.warn('[loading] send failed:', err.message);
    return null;
  }
}

async function deleteLoading(ctx, loadingMsg) {
  if (!loadingMsg) return;
  try {
    await ctx.telegram.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
  } catch (_) {}
}

async function replaceLoadingText(ctx, loadingMsg, text, extra = {}) {
  if (loadingMsg) {
    try {
      await ctx.telegram.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        undefined,
        text,
        extra
      );
      return;
    } catch (_) {
      try {
        await deleteLoading(ctx, loadingMsg);
      } catch (_) {}
    }
  }
  return ctx.reply(text, extra);
}

module.exports = {
  sendLoading,
  deleteLoading,
  replaceLoadingText,
};
