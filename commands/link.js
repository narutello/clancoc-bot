const { Markup } = require('telegraf');
const config = require('../config');
const {
  linkAccount,
  upsertTelegramUser,
} = require('../services/linkService');
const { getPlayer, verifyPlayerWithToken } = require('../api/clash');
const {
  formatTag,
  normalizeTag,
  isValidTag,
  escapeHtml,
} = require('../utils/helpers');
const {
  setPending,
  getPending,
  clearPending,
} = require('../services/linkPending');

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };

function playerSummaryHtml(player, lang, t) {
  const tag = formatTag(player.tag);
  const name = escapeHtml(player.name || '—');
  const th = player.townHallLevel ?? player.townhallLevel ?? '—';
  const trophies = player.trophies ?? '—';
  const level = player.expLevel ?? '—';
  const clanName = player.clan?.name
    ? escapeHtml(player.clan.name)
    : t('link.no_clan', { lng: lang });
  const role = player.role ? escapeHtml(String(player.role)) : '—';

  return (
    `<b>${t('link.confirm_title', { lng: lang })}</b>\n\n` +
    `🏷 <code>${tag}</code>\n` +
    `👤 ${name}\n` +
    `🏠 TH ${th} · ⭐ XP ${level}\n` +
    `🏆 ${trophies}\n` +
    `🏰 ${clanName}` +
    (player.role ? ` (${role})` : '') +
    `\n\n${t('link.confirm_ask', { lng: lang })}`
  );
}

function confirmKeyboard(telegramId, tag) {
  const clean = normalizeTag(tag);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅', `link:confirm:${telegramId}:${clean}`),
      Markup.button.callback('❌', `link:cancel:${telegramId}`),
    ],
  ]);
}

async function linkCommand(ctx) {
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

  const clean = normalizeTag(tagArg);
  if (!isValidTag(clean)) {
    return ctx.reply(ctx.t('link_errors.invalid_tag'), HTML);
  }

  // Owner linking someone else → no ownership proof required
  if (targetTelegramId !== from.id && isOwner) {
    try {
      const result = await linkAccount(targetTelegramId, clean, true);
      const tag = formatTag(result.tag);
      const name = result.name ? ` (${escapeHtml(result.name)})` : '';
      if (result.alreadyLinked) {
        return ctx.reply(ctx.t('link.already', { tag, name }), HTML);
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
  }

  // Self-link: require API token verification
  try {
    await getPlayer(clean);
  } catch (err) {
    if (err.isNotFound) {
      return ctx.reply(ctx.t('link_errors.not_found'), HTML);
    }
    return ctx.reply(ctx.t('common.error', { message: err.message }), HTML);
  }

  setPending(from.id, {
    step: 'await_token',
    tag: clean,
    targetTelegramId: from.id,
  });

  const tag = formatTag(clean);
  const hint =
    ctx.chat?.type && ctx.chat.type !== 'private'
      ? `\n\n${ctx.t('link.prefer_private')}`
      : '';

  return ctx.reply(
    ctx.t('link.ask_token', { tag }) + hint,
    HTML
  );
}

/** Handle plain text when user is in await_token step (token paste). */
async function linkTokenMessage(ctx, next) {
  const from = ctx.from;
  if (!from?.id || !ctx.message?.text) return next();

  // Ignore commands
  if (ctx.message.text.startsWith('/')) return next();

  const pending = getPending(from.id);
  if (!pending || pending.step !== 'await_token') return next();

  const token = String(ctx.message.text).trim();
  // Heuristic: CoC API tokens are long JWTs / eyJ...
  if (token.length < 20) {
    return ctx.reply(ctx.t('link.token_invalid'), HTML);
  }

  // Best-effort: delete the message containing the token (private chats)
  if (ctx.chat?.type === 'private') {
    try {
      await ctx.deleteMessage();
    } catch (_) {}
  }

  try {
    const player = await verifyPlayerWithToken(pending.tag, token);
    setPending(from.id, {
      step: 'await_confirm',
      tag: pending.tag,
      targetTelegramId: pending.targetTelegramId,
      playerName: player.name || null,
    });

    const html = playerSummaryHtml(player, ctx.lang || 'fa', ctx.t.bind(ctx));
    return ctx.reply(html, {
      ...HTML,
      ...confirmKeyboard(from.id, pending.tag),
    });
  } catch (err) {
    if (err.isAuthError) {
      return ctx.reply(ctx.t('link.token_mismatch'), HTML);
    }
    if (err.isNotFound) {
      clearPending(from.id);
      return ctx.reply(ctx.t('link_errors.not_found'), HTML);
    }
    return ctx.reply(ctx.t('common.error', { message: err.message }), HTML);
  }
}

async function linkConfirmAction(ctx) {
  const from = ctx.from;
  const parts = (ctx.callbackQuery?.data || '').split(':');
  // link:confirm:{telegramId}:{tag}
  const targetId = Number(parts[2]);
  const tag = normalizeTag(parts[3]);

  if (!from || Number(from.id) !== targetId) {
    await ctx.answerCbQuery(ctx.t('link.not_yours'));
    return;
  }

  const pending = getPending(from.id);
  if (!pending || pending.step !== 'await_confirm' || pending.tag !== tag) {
    await ctx.answerCbQuery(ctx.t('link.session_expired'));
    try {
      await ctx.editMessageText(ctx.t('link.session_expired'), HTML);
    } catch (_) {}
    return;
  }

  try {
    const result = await linkAccount(pending.targetTelegramId, tag, true);
    clearPending(from.id);
    const displayTag = formatTag(result.tag);
    const name = result.name ? ` (${escapeHtml(result.name)})` : '';
    const text = result.alreadyLinked
      ? ctx.t('link.already', { tag: displayTag, name })
      : ctx.t('link.success_self', { tag: displayTag, name });
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(text, HTML);
    } catch (_) {
      await ctx.reply(text, HTML);
    }
  } catch (err) {
    clearPending(from.id);
    await ctx.answerCbQuery();
    const msg =
      err.code && typeof err.code === 'string' && err.code.includes('.')
        ? ctx.t(err.code)
        : ctx.t('common.error', { message: err.message });
    try {
      await ctx.editMessageText(msg, HTML);
    } catch (_) {
      await ctx.reply(msg, HTML);
    }
  }
}

async function linkCancelAction(ctx) {
  const from = ctx.from;
  const parts = (ctx.callbackQuery?.data || '').split(':');
  const targetId = Number(parts[2]);

  if (!from || Number(from.id) !== targetId) {
    await ctx.answerCbQuery(ctx.t('link.not_yours'));
    return;
  }

  clearPending(from.id);
  await ctx.answerCbQuery();
  try {
    await ctx.editMessageText(ctx.t('link.cancelled'), HTML);
  } catch (_) {
    await ctx.reply(ctx.t('link.cancelled'), HTML);
  }
}

module.exports = linkCommand;
module.exports.linkTokenMessage = linkTokenMessage;
module.exports.linkConfirmAction = linkConfirmAction;
module.exports.linkCancelAction = linkCancelAction;
