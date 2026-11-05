/**
 * Loading helpers for slow commands (Clash API / DB).
 * Prefer editing the loading message for plain text;
 * for Rich Message results, delete loading then send the final message.
 */

async function sendLoading(ctx, text = '⏳ در حال دریافت اطلاعات...') {
  try {
    return await ctx.reply(text);
  } catch (err) {
    console.warn('[loading] send failed:', err.message);
    return null;
  }
}

async function deleteLoading(ctx, loadingMsg) {
  if (!loadingMsg) return;
  try {
    await ctx.telegram.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
  } catch (_) {
    // message may already be gone
  }
}

/**
 * Replace loading with plain text (edit in place, fallback to new reply).
 */
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
      await deleteLoading(ctx, loadingMsg);
    }
  }
  return ctx.reply(text, extra);
}

module.exports = {
  sendLoading,
  deleteLoading,
  replaceLoadingText,
};
