const config = require('../config');

module.exports = async function helpCommand(ctx) {
  const userId = ctx.from?.id;
  const ownerId = Number(config.ownerTelegramId);
  const isOwner =
    userId != null && Number.isFinite(ownerId) && Number(userId) === ownerId;

  // Full help for members; extended help for owner
  const text = isOwner ? ctx.t('help.owner') : ctx.t('help.user');

  return ctx.reply(text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
};
