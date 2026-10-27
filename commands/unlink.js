const config = require('../config');
const { unlinkAccount, upsertTelegramUser } = require('../services/linkService');
const { formatTag, normalizeTag } = require('../utils/helpers');

module.exports = async function unlinkCommand(ctx) {
  const from = ctx.from;
  await upsertTelegramUser(from);

  const args = (ctx.message.text || '').split(/\s+/).slice(1);
  const isOwner = Number(from.id) === config.ownerTelegramId;

  let targetTelegramId = from.id;
  let tagArg = null;

  if (args.length === 1) {
    tagArg = args[0];
  } else if (args.length >= 2) {
    if (!isOwner) {
      return ctx.reply('❌ فقط اونر ربات می‌تواند لینک دیگران را حذف کند.');
    }
    const possibleId = Number(args[0]);
    if (Number.isNaN(possibleId) || possibleId <= 0) {
      return ctx.reply('❌ شناسه تلگرام نامعتبر است.');
    }
    targetTelegramId = possibleId;
    tagArg = args[1];
  } else {
    return ctx.reply(
      'استفاده:\n/unlink #CLASH_TAG\nیا (اونر):\n/unlink TELEGRAM_USER_ID #CLASH_TAG'
    );
  }

  try {
    const removed = await unlinkAccount(targetTelegramId, tagArg);
    const tag = formatTag(normalizeTag(tagArg));

    if (!removed) {
      return ctx.reply(`ℹ️ لینکی برای ${tag} پیدا نشد.`);
    }

    if (targetTelegramId === from.id) {
      return ctx.reply(`✅ لینک ${tag} از حساب شما حذف شد.`);
    }
    return ctx.reply(`✅ لینک ${tag} از کاربر ${targetTelegramId} حذف شد.`);
  } catch (err) {
    return ctx.reply(`❌ خطا: ${err.message}`);
  }
};
