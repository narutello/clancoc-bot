const config = require('../config');
const {
  isEnabled,
  getState,
  formatEndsAt,
} = require('../services/maintenanceService');
const { escapeHtml } = require('../utils/helpers');

function isOwner(userId) {
  return userId != null && Number(userId) === Number(config.ownerTelegramId);
}

function buildPublicMessage(ctx, state) {
  const lines = [ctx.t('maintenance.public_default')];
  if (state.reason) {
    lines.push('');
    lines.push(
      ctx.t('maintenance.public_reason', {
        reason: escapeHtml(state.reason),
      })
    );
  }
  if (state.endsAt) {
    lines.push(
      ctx.t('maintenance.public_ends', {
        time: formatEndsAt(state.endsAt, ctx.lang) || state.endsAt,
      })
    );
  }
  return lines.join('\n');
}

/**
 * When maintenance is on, only the owner can use the bot.
 */
async function maintenanceMiddleware(ctx, next) {
  if (!isEnabled()) return next();

  const userId = ctx.from?.id;
  if (isOwner(userId)) return next();

  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery();
    } catch (_) {}
  }

  const state = getState();
  const text = buildPublicMessage(ctx, state);

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
