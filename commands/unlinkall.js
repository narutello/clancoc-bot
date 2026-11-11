const { unlinkAll, upsertTelegramUser } = require('../services/linkService');
const { formatTag } = require('../utils/helpers');

function confirmKeyboard(userId, lang, ctx) {
  return {
    inline_keyboard: [
      [
        {
          text: ctx.t('unlinkall.confirm_btn'),
          callback_data: `unlinkall:confirm:${userId}`,
          style: 'danger',
        },
        {
          text: ctx.t('unlinkall.cancel_btn'),
          callback_data: `unlinkall:cancel:${userId}`,
          style: 'success',
        },
      ],
    ],
  };
}

module.exports = async function unlinkAllCommand(ctx) {
  const from = ctx.from;
  await upsertTelegramUser(from);

  return ctx.reply(ctx.t('unlinkall.confirm_prompt'), {
    reply_markup: confirmKeyboard(from.id, ctx.lang, ctx),
  });
};

async function unlinkAllConfirmAction(ctx) {
  const data = ctx.callbackQuery?.data || '';
  const parts = data.split(':');
  const targetId = Number(parts[2]);
  const fromId = ctx.from?.id;

  if (!fromId || !targetId || Number(fromId) !== targetId) {
    return ctx.answerCbQuery(ctx.t('unlinkall.not_yours'), { show_alert: true });
  }

  try {
    await ctx.answerCbQuery();
    const removed = await unlinkAll(fromId);
    const text =
      removed.length === 0
        ? ctx.t('unlinkall.none')
        : ctx.t('unlinkall.success', {
            list: removed.map((x) => formatTag(x)).join(', '),
          });

    try {
      await ctx.editMessageText(text);
    } catch (_) {
      await ctx.reply(text);
    }
  } catch (err) {
    try {
      await ctx.answerCbQuery(err.message, { show_alert: true });
    } catch (_) {}
  }
}

async function unlinkAllCancelAction(ctx) {
  const data = ctx.callbackQuery?.data || '';
  const parts = data.split(':');
  const targetId = Number(parts[2]);
  const fromId = ctx.from?.id;

  if (!fromId || !targetId || Number(fromId) !== targetId) {
    return ctx.answerCbQuery(ctx.t('unlinkall.not_yours'), { show_alert: true });
  }

  try {
    await ctx.answerCbQuery();
    const text = ctx.t('unlinkall.cancelled');
    try {
      await ctx.editMessageText(text);
    } catch (_) {
      await ctx.reply(text);
    }
  } catch (err) {
    try {
      await ctx.answerCbQuery(err.message || 'Error', { show_alert: true });
    } catch (_) {}
  }
}

module.exports.unlinkAllConfirmAction = unlinkAllConfirmAction;
module.exports.unlinkAllCancelAction = unlinkAllCancelAction;
