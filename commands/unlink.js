const config = require('../config');
const { unlinkAccount, upsertTelegramUser } = require('../services/linkService');
const { formatTag } = require('../utils/helpers');

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
      return ctx.reply(ctx.t('unlink.owner_only_others'));
    }
    const possibleId = Number(args[0]);
    if (Number.isNaN(possibleId) || possibleId <= 0) {
      return ctx.reply(ctx.t('unlink.invalid_telegram_id'));
    }
    targetTelegramId = possibleId;
    tagArg = args[1];
  } else {
    return ctx.reply(ctx.t('unlink.usage'));
  }

  try {
    const ok = await unlinkAccount(targetTelegramId, tagArg);
    const tag = formatTag(tagArg);
    if (!ok) {
      return ctx.reply(ctx.t('unlink.not_found', { tag }));
    }
    return ctx.reply(ctx.t('unlink.success', { tag }));
  } catch (err) {
    return ctx.reply(ctx.t('common.error', { message: err.message }));
  }
};
