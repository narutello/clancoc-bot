const config = require('../config');
const { linkAccount, upsertTelegramUser } = require('../services/linkService');
const { formatTag } = require('../utils/helpers');

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };

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
      return ctx.reply(ctx.t('link.owner_only_others'), HTML);
    }
    const possibleId = Number(args[0]);
    if (Number.isNaN(possibleId) || possibleId <= 0) {
      return ctx.reply(ctx.t('link.invalid_telegram_id'), HTML);
    }
    targetTelegramId = possibleId;
    tagArg = args[1];
  } else {
    return ctx.reply(ctx.t('link.usage'), HTML);
  }

  try {
    const result = await linkAccount(targetTelegramId, tagArg, true);
    const tag = formatTag(result.tag);
    const name = result.name ? ` (${result.name})` : '';

    if (result.alreadyLinked) {
      return ctx.reply(ctx.t('link.already', { tag, name }), HTML);
    }

    if (targetTelegramId === from.id) {
      return ctx.reply(ctx.t('link.success_self', { tag, name }), HTML);
    }
    return ctx.reply(
      ctx.t('link.success_other', { tag, name, userId: targetTelegramId }),
      HTML
    );
  } catch (err) {
    if (err.code && typeof err.code === 'string' && err.code.includes('.')) {
      return ctx.reply(ctx.t(err.code), HTML);
    }
    return ctx.reply(ctx.t('common.error', { message: err.message }), HTML);
  }
};
