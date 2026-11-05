/**
 * Loading helpers for slow commands (Clash API / DB).
 *
 * Private chats: Telegram Bot API sendMessageDraft with empty text
 * → native "Thinking…" bubble (private chats only).
 * Groups/supergroups/channels: fallback to a normal loading message.
 *
 * Public API for command handlers stays unchanged:
 *   sendLoading / deleteLoading / replaceLoadingText
 */

function isPrivateChat(ctx) {
  return ctx.chat?.type === 'private';
}

function nextDraftId() {
  // Must be non-zero integer
  return (Date.now() % 2147483646) + 1;
}

/**
 * @returns {Promise<null | {
 *   mode: 'draft' | 'message',
 *   draftId?: number,
 *   chatId?: number,
 *   message?: object
 * }>
 */
async function sendLoading(ctx, text = '⏳ در حال دریافت اطلاعات...') {
  // Private → native Thinking… via sendMessageDraft
  if (isPrivateChat(ctx)) {
    const draftId = nextDraftId();
    try {
      // Empty text → official "Thinking…" placeholder
      await ctx.telegram.callApi('sendMessageDraft', {
        chat_id: ctx.chat.id,
        draft_id: draftId,
        text: '',
      });
      return {
        mode: 'draft',
        draftId,
        chatId: ctx.chat.id,
      };
    } catch (err) {
      console.warn(
        '[loading] sendMessageDraft failed, falling back to message:',
        err.message
      );
      // fall through to classic loading message
    }
  }

  // Group / fallback: classic loading message (draft is private-only)
  try {
    const message = await ctx.reply(text || '⏳ در حال دریافت اطلاعات...');
    return {
      mode: 'message',
      message,
      chatId: message.chat.id,
    };
  } catch (err) {
    console.warn('[loading] send failed:', err.message);
    return null;
  }
}

/**
 * Clear loading indicator.
 * Draft mode: no-op (draft clears when the bot sends a real message).
 * Message mode: delete the temporary loading message.
 */
async function deleteLoading(ctx, loading) {
  if (!loading) return;

  if (loading.mode === 'draft') {
    return;
  }

  const msg = loading.message;
  if (!msg) return;
  try {
    await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id);
  } catch (_) {
    // already gone
  }
}

/**
 * Replace loading with plain text.
 * Draft mode: send a real message (draft clears automatically).
 * Message mode: edit in place, fallback to new reply.
 */
async function replaceLoadingText(ctx, loading, text, extra = {}) {
  if (loading && loading.mode === 'message' && loading.message) {
    try {
      await ctx.telegram.editMessageText(
        loading.message.chat.id,
        loading.message.message_id,
        undefined,
        text,
        extra
      );
      return;
    } catch (_) {
      await deleteLoading(ctx, loading);
    }
  }

  // draft mode or edit failed → normal reply (also clears draft)
  return ctx.reply(text, extra);
}

module.exports = {
  sendLoading,
  deleteLoading,
  replaceLoadingText,
};
