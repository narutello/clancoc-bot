const { unlinkAll, upsertTelegramUser } = require('../services/linkService');
const { formatTag } = require('../utils/helpers');

module.exports = async function unlinkAllCommand(ctx) {
  const from = ctx.from;
  await upsertTelegramUser(from);

  try {
    const removed = await unlinkAll(from.id);
    if (removed.length === 0) {
      return ctx.reply('ℹ️ هیچ اکانتی لینک نشده بود.');
    }
    const list = removed.map((t) => formatTag(t)).join(', ');
    return ctx.reply(`✅ تمام لینک‌های شما حذف شد:\n${list}`);
  } catch (err) {
    return ctx.reply(`❌ خطا: ${err.message}`);
  }
};
