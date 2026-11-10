const { unlinkAll, upsertTelegramUser } = require('../services/linkService');
const { formatTag } = require('../utils/helpers');

function confirmKeyboard(userId) {
  return {
    inline_keyboard: [
      [
        {
          text: 'تأیید حذف',
          callback_data: `unlinkall:confirm:${userId}`,
          style: 'danger',
        },
        {
          text: 'لغو',
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

  return ctx.reply(
    '⚠️ آیا مطمئنید همهٔ اکانت‌های لینک‌شده‌تان حذف شود؟\n' +
      'این کار قابل برگشت نیست.',
    { reply_markup: confirmKeyboard(from.id) }
  );
};

async function unlinkAllConfirmAction(ctx) {
  const data = ctx.callbackQuery?.data || '';
  const parts = data.split(':');
  const targetId = Number(parts[2]);
  const fromId = ctx.from?.id;

  if (!fromId || !targetId || Number(fromId) !== targetId) {
    return ctx.answerCbQuery('این دکمه برای شما نیست.', { show_alert: true });
  }

  try {
    await ctx.answerCbQuery();
    const removed = await unlinkAll(fromId);
    const text =
      removed.length === 0
        ? 'ℹ️ هیچ اکانتی لینک نشده بود.'
        : `✅ تمام لینک‌های شما حذف شد:\n${removed.map((t) => formatTag(t)).join(', ')}`;

    try {
      await ctx.editMessageText(text);
    } catch (_) {
      await ctx.reply(text);
    }
  } catch (err) {
    try {
      await ctx.answerCbQuery(`خطا: ${err.message}`, { show_alert: true });
    } catch (_) {}
  }
}

async function unlinkAllCancelAction(ctx) {
  const data = ctx.callbackQuery?.data || '';
  const parts = data.split(':');
  const targetId = Number(parts[2]);
  const fromId = ctx.from?.id;

  if (!fromId || !targetId || Number(fromId) !== targetId) {
    return ctx.answerCbQuery('این دکمه برای شما نیست.', { show_alert: true });
  }

  try {
    await ctx.answerCbQuery('لغو شد');
    try {
      await ctx.editMessageText('❎ حذف همه لینک‌ها لغو شد.');
    } catch (_) {
      await ctx.reply('❎ حذف همه لینک‌ها لغو شد.');
    }
  } catch (err) {
    try {
      await ctx.answerCbQuery(err.message || 'خطا', { show_alert: true });
    } catch (_) {}
  }
}

module.exports.unlinkAllConfirmAction = unlinkAllConfirmAction;
module.exports.unlinkAllCancelAction = unlinkAllCancelAction;
