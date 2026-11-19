const config = require('../config');
const { isEnabled, getState } = require('../services/maintenanceService');
const { publicMessage } = require('../commands/maintenance');

function isOwner(userId) {
  return userId != null && Number(userId) === Number(config.ownerTelegramId);
}

/**
 * When maintenance is on, only the owner can use the bot.
 * Owner callbacks for maintenance actions still pass through.
 */
async function maintenanceMiddleware(ctx, next) {
  if (!isEnabled()) return next();

  const userId = ctx.from?.id;
  if (isOwner(userId)) return next();

  // Allow answering callback queries so buttons don't spin forever
  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery();
    } catch (_) {}
  }

  const state = getState();
  const text = publicMessage(ctx, state);

  try {
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML' });
      } catch (_) {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(text, { parse_mode: 'HTML' });
    }
  } catch (_) {}
}

module.exports = maintenanceMiddleware;
