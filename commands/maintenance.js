const config = require('../config');
const {
  isEnabled,
  getState,
  enable,
  disable,
  setPending,
  getPending,
  clearPending,
  parseEndsAt,
  formatEndsAt,
} = require('../services/maintenanceService');

function isOwner(userId) {
  return userId != null && Number(userId) === Number(config.ownerTelegramId);
}

function confirmKeyboard(userId, ctx) {
  return {
    inline_keyboard: [
      [
        {
          text: ctx.t('maintenance.confirm_btn'),
          callback_data: `maint:confirm:${userId}`,
        },
        {
          text: ctx.t('maintenance.cancel_btn'),
          callback_data: `maint:cancel:${userId}`,
        },
      ],
    ],
  };
}

function skipKeyboard(userId, step) {
  return {
    inline_keyboard: [
      [
        {
          text: '⏭ Skip',
          callback_data: `maint:skip:${step}:${userId}`,
        },
      ],
    ],
  };
}

function offKeyboard(userId, ctx) {
  return {
    inline_keyboard: [
      [
        {
          text: ctx.t('maintenance.disable_btn'),
          callback_data: `maint:off:${userId}`,
        },
      ],
    ],
  };
}

function statusText(ctx, state) {
  const lines = [ctx.t('maintenance.status_on')];
  if (state.reason) {
    lines.push(ctx.t('maintenance.status_reason', { reason: state.reason }));
  }
  if (state.endsAt) {
    lines.push(
      ctx.t('maintenance.status_ends', {
        time: formatEndsAt(state.endsAt, ctx.lang) || state.endsAt,
      })
    );
  }
  return lines.join('\n');
}

function publicMessage(ctx, state) {
  const lines = [ctx.t('maintenance.public_default')];
  if (state.reason) {
    lines.push('');
    lines.push(ctx.t('maintenance.public_reason', { reason: state.reason }));
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

module.exports = async function maintenanceCommand(ctx) {
  const userId = ctx.from?.id;
  if (!isOwner(userId)) {
    return ctx.reply(ctx.t('maintenance.owner_only'));
  }

  const state = getState();
  if (state.enabled) {
    return ctx.reply(statusText(ctx, state), {
      parse_mode: 'HTML',
      reply_markup: offKeyboard(userId, ctx),
    });
  }

  return ctx.reply(ctx.t('maintenance.confirm_prompt'), {
    parse_mode: 'HTML',
    reply_markup: confirmKeyboard(userId, ctx),
  });
};

async function maintenanceAction(ctx) {
  const data = ctx.callbackQuery?.data || '';
  const parts = data.split(':');
  // maint : action : ...
  const action = parts[1];
  const fromId = ctx.from?.id;

  if (!isOwner(fromId)) {
    await ctx.answerCbQuery(ctx.t('maintenance.owner_only'), {
      show_alert: true,
    });
    return;
  }

  try {
    if (action === 'cancel') {
      const targetId = Number(parts[2]);
      if (Number(fromId) !== targetId) {
        await ctx.answerCbQuery(ctx.t('maintenance.not_yours'), {
          show_alert: true,
        });
        return;
      }
      clearPending(fromId);
      await ctx.answerCbQuery();
      try {
        await ctx.editMessageText(ctx.t('maintenance.cancelled'));
      } catch (_) {
        await ctx.reply(ctx.t('maintenance.cancelled'));
      }
      return;
    }

    if (action === 'confirm') {
      const targetId = Number(parts[2]);
      if (Number(fromId) !== targetId) {
        await ctx.answerCbQuery(ctx.t('maintenance.not_yours'), {
          show_alert: true,
        });
        return;
      }
      setPending(fromId, { step: 'reason', reason: null });
      await ctx.answerCbQuery();
      try {
        await ctx.editMessageText(ctx.t('maintenance.ask_reason'), {
          parse_mode: 'HTML',
          reply_markup: skipKeyboard(fromId, 'reason'),
        });
      } catch (_) {
        await ctx.reply(ctx.t('maintenance.ask_reason'), {
          parse_mode: 'HTML',
          reply_markup: skipKeyboard(fromId, 'reason'),
        });
      }
      return;
    }

    if (action === 'skip') {
      const step = parts[2];
      const targetId = Number(parts[3]);
      if (Number(fromId) !== targetId) {
        await ctx.answerCbQuery(ctx.t('maintenance.not_yours'), {
          show_alert: true,
        });
        return;
      }

      const pend = getPending(fromId);
      if (!pend || pend.step !== step) {
        await ctx.answerCbQuery(ctx.t('maintenance.session_expired'), {
          show_alert: true,
        });
        return;
      }

      if (step === 'reason') {
        setPending(fromId, { step: 'endsAt', reason: null });
        await ctx.answerCbQuery();
        try {
          await ctx.editMessageText(ctx.t('maintenance.ask_ends'), {
            parse_mode: 'HTML',
            reply_markup: skipKeyboard(fromId, 'endsAt'),
          });
        } catch (_) {
          await ctx.reply(ctx.t('maintenance.ask_ends'), {
            parse_mode: 'HTML',
            reply_markup: skipKeyboard(fromId, 'endsAt'),
          });
        }
        return;
      }

      if (step === 'endsAt') {
        clearPending(fromId);
        const state = await enable({
          reason: pend.reason,
          endsAt: null,
          updatedBy: fromId,
        });
        await ctx.answerCbQuery();
        const text = ctx.t('maintenance.enabled') + '\n\n' + statusText(ctx, state);
        try {
          await ctx.editMessageText(text, { parse_mode: 'HTML' });
        } catch (_) {
          await ctx.reply(text, { parse_mode: 'HTML' });
        }
        return;
      }
    }

    if (action === 'off') {
      const targetId = Number(parts[2]);
      if (Number(fromId) !== targetId) {
        await ctx.answerCbQuery(ctx.t('maintenance.not_yours'), {
          show_alert: true,
        });
        return;
      }
      clearPending(fromId);
      await disable({ updatedBy: fromId, source: 'manual' });
      await ctx.answerCbQuery();
      try {
        await ctx.editMessageText(ctx.t('maintenance.disabled'));
      } catch (_) {
        await ctx.reply(ctx.t('maintenance.disabled'));
      }
      return;
    }

    await ctx.answerCbQuery();
  } catch (err) {
    console.error('[maintenanceAction]', err.message);
    try {
      await ctx.answerCbQuery(ctx.t('common.generic_error'), {
        show_alert: true,
      });
    } catch (_) {}
  }
}

async function maintenanceTextMessage(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId || !isOwner(userId)) return next();

  const pend = getPending(userId);
  if (!pend) return next();

  const text = (ctx.message?.text || '').trim();
  if (!text || text.startsWith('/')) {
    clearPending(userId);
    return next();
  }

  try {
    if (pend.step === 'reason') {
      setPending(userId, { step: 'endsAt', reason: text.slice(0, 300) });
      await ctx.reply(ctx.t('maintenance.ask_ends'), {
        parse_mode: 'HTML',
        reply_markup: skipKeyboard(userId, 'endsAt'),
      });
      return;
    }

    if (pend.step === 'endsAt') {
      const endsAt = parseEndsAt(text);
      if (!endsAt) {
        await ctx.reply(ctx.t('maintenance.invalid_ends'), {
          parse_mode: 'HTML',
          reply_markup: skipKeyboard(userId, 'endsAt'),
        });
        return;
      }
      clearPending(userId);
      const state = await enable({
        reason: pend.reason,
        endsAt,
        updatedBy: userId,
      });
      const msg =
        ctx.t('maintenance.enabled') + '\n\n' + statusText(ctx, state);
      await ctx.reply(msg, { parse_mode: 'HTML' });
      return;
    }
  } catch (err) {
    console.error('[maintenanceText]', err.message);
    clearPending(userId);
    await ctx.reply(ctx.t('common.generic_error'));
  }
}

module.exports.maintenanceAction = maintenanceAction;
module.exports.maintenanceTextMessage = maintenanceTextMessage;
module.exports.publicMessage = publicMessage;
module.exports.isOwner = isOwner;
