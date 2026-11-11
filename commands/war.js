const { getCurrentWar } = require('../api/clash');
const { isInCwl } = require('../services/cwlService');
const config = require('../config');
const { checkCommandLimit } = require('../utils/commandRateLimit');
const { singleflight } = require('../utils/singleflight');
const { getCache, setCache } = require('../utils/ttlCache');
const {
  sendLoading,
  deleteLoading,
  replaceLoadingText,
} = require('../utils/loading');
const {
  keyboardOur,
  keyboardEnemy,
  buildOurHtml,
  buildEnemyHtml,
  sendRich,
  editRich,
  richMessageErrorReply,
} = require('./warView');

async function fetchRegularWar() {
  try {
    const war = await getCurrentWar();
    if (war && war.state && war.state !== 'notInWar') {
      return { war, isCwl: false, cwlDay: null, cwlTotalDays: null };
    }
  } catch (err) {
    if (!err.isNotFound) throw err;
  }
  return null;
}

async function resolveRegularWar() {
  const cacheKey = `regularWar:${config.clanTag}`;
  const cached = getCache(cacheKey);
  if (cached !== null) return cached;

  return singleflight(cacheKey, async () => {
    const again = getCache(cacheKey);
    if (again !== null) return again;
    const result = await fetchRegularWar();
    setCache(cacheKey, result, config.warCacheTtlMs);
    return result;
  });
}

async function warCommand(ctx) {
  let loadingMsg = null;
  const lang = ctx.lang || 'fa';
  try {
    const userId = ctx.from?.id;
    const isOwner =
      userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'war', {
      limit: config.warCmdLimit,
      windowMs: config.warCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.reply(
        ctx.t('rate.war', { sec: limit.retryAfterSec }),
        { parse_mode: 'HTML' }
      );
    }

    loadingMsg = await sendLoading(ctx, ctx.t('loading.war'));

    const resolved = await resolveRegularWar();
    if (resolved && resolved.war) {
      const html = await buildOurHtml(resolved, ctx.t('war.title'), lang);
      await deleteLoading(ctx, loadingMsg);
      loadingMsg = null;
      return sendRich(ctx, html, keyboardOur('war', lang), lang);
    }

    if (await isInCwl()) {
      return replaceLoadingText(ctx, loadingMsg, ctx.t('war.use_cwl'), {
        parse_mode: 'HTML',
      });
    }

    return replaceLoadingText(ctx, loadingMsg, ctx.t('war.not_in_war'));
  } catch (err) {
    console.error('[/war]', err.message);
    return richMessageErrorReply(
      ctx,
      err,
      ctx.t('war.fetch_error', { message: err.message })
    );
  }
}

async function warEnemyAction(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    await ctx.answerCbQuery();
    const resolved = await resolveRegularWar();
    if (!resolved || !resolved.war) {
      return ctx.reply(ctx.t('war.not_in_war'));
    }
    const html = await buildEnemyHtml(resolved, ctx.t('war.enemy_title'), lang);
    return editRich(ctx, html, keyboardEnemy('war', lang), lang);
  } catch (err) {
    console.error('[war:enemy]', err.message);
    return ctx.reply(ctx.t('war.fetch_error', { message: err.message }));
  }
}

async function warHomeAction(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    await ctx.answerCbQuery();
    const resolved = await resolveRegularWar();
    if (!resolved || !resolved.war) {
      return ctx.reply(ctx.t('war.not_in_war'));
    }
    const html = await buildOurHtml(resolved, ctx.t('war.title'), lang);
    return editRich(ctx, html, keyboardOur('war', lang), lang);
  } catch (err) {
    console.error('[war:home]', err.message);
    return ctx.reply(ctx.t('war.fetch_error', { message: err.message }));
  }
}

module.exports = warCommand;
module.exports.warEnemyAction = warEnemyAction;
module.exports.warHomeAction = warHomeAction;
module.exports.resolveRegularWar = resolveRegularWar;
