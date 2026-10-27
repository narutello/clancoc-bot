const config = require('../config');
const { linkAccount, upsertTelegramUser } = require('../services/linkService');
const { formatTag } = require('../utils/helpers');

module.exports = async function linkCommand(ctx) {
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
      return ctx.reply('❌ فقط اونر ربات می‌تواند اکانت دیگران را لینک کند.');
    }
    const possibleId = Number(args[0]);
    if (Number.isNaN(possibleId) || possibleId <= 0) {
      return ctx.reply('❌ شناسه تلگرام نامعتبر است.');
    }
    targetTelegramId = possibleId;
    tagArg = args[1];
  } else {
    return ctx.reply(
      'استفاده:\n/link #CLASH_TAG\nیا (اونر):\n/link TELEGRAM_USER_ID #CLASH_TAG'
    );
  }

  try {
    const result = await linkAccount(targetTelegramId, tagArg, true);
    const tag = formatTag(result.tag);
    const name = result.name ? ` (${result.name})` : '';

    if (result.alreadyLinked) {
      return ctx.reply(`ℹ️ این اکانت قبلاً لینک شده است: ${tag}${name}`);
    }

    if (targetTelegramId === from.id) {
      return ctx.reply(`✅ اکانت ${tag}${name} با موفقیت به حساب شما لینک شد.`);
    }
    return ctx.reply(
      `✅ اکانت ${tag}${name} با موفقیت به کاربر ${targetTelegramId} لینک شد.`
    );
  } catch (err) {
    return ctx.reply(`❌ خطا: ${err.message}`);
  }
};
