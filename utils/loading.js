/**
 * Loading helpers for slow commands (Clash API / DB).
 *
 * Private chats: Telegram Bot API sendMessageDraft ("Thinking…" bubble).
 * Groups/supergroups/channels: fallback to a normal loading message
 * (sendMessageDraft is private-chat only).
 *
 * The public API stays the same for command handlers:
 *   sendLoading / deleteLoading / replaceLoadingText
 */

function isPrivateChat(ctx) {
  return ctx.chat?.type === 'private';
}

function nextDraftId() {
  // Must be non-zero integer; reuse same id within one turn for animation.
  const id = (Date.now() % 2147483646) + 1;
  return id;
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
  // Private → native Thinking / draft preview
  if (isPrivateChat(ctx)) {
    const draftId = nextDraftId();
    try {
      // Empty text shows the built-in "Thinking…" placeholder.
      // If a custom caption is provided, show that draft text instead.
      const payload = {
        chat_id: ctx.chat.id,
        draft_id: draftId,
      };
      if (text && String(text).trim()) {
        payload.text = String(text).trim();
      } else {
        payload.text = '';
      }

      await ctx.telegram.callApi('sendMessageDraft', payload);
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

  // Group / fallback: classic loading message
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
 * Draft mode: no-op (draft disappears when the bot sends a real message).
 * Message mode: delete the temporary loading message.
 */
async function deleteLoading(ctx, loading) {
  if (!loading) return;

  if (loading.mode === 'draft') {
    // Ephemeral draft auto-clears when we send the final message.
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
