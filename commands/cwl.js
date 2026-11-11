const { findOurCwlWar, getCwlStandings } = require('../services/cwlService');
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
  keyboardStandings,
  buildOurHtml,
  buildEnemyHtml,
  buildStandingsHtml,
  sendRich,
  editRich,
  richMessageErrorReply,
} = require('./warView');

async function resolveCwlWar() {
  const cacheKey = `cwlWar:${config.clanTag}`;
  const cached = getCache(cacheKey);
  if (cached !== null) return cached;

  return singleflight(cacheKey, async () => {
    const again = getCache(cacheKey);
    if (again !== null) return again;
    const found = await findOurCwlWar();
    if (!found || !found.war) {
      setCache(cacheKey, null, config.warCacheTtlMs);
      return null;
    }
    const resolved = {
      war: found.war,
      isCwl: true,
      cwlDay: found.cwlDay,
      cwlTotalDays: found.cwlTotalDays,
      cwlSeason: found.cwlSeason,
    };
    setCache(cacheKey, resolved, config.warCacheTtlMs);
    return resolved;
  });
}

async function cwlCommand(ctx) {
  let loadingMsg = null;
  const lang = ctx.lang || 'fa';
  try {
    const userId = ctx.from?.id;
    const isOwner =
      userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'cwl', {
      limit: config.cwlCmdLimit,
      windowMs: config.cwlCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.reply(ctx.t('rate.cwl', { sec: limit.retryAfterSec }), {
        parse_mode: 'HTML',
      });
    }

    loadingMsg = await sendLoading(ctx, ctx.t('loading.cwl'));

    const resolved = await resolveCwlWar();
    if (!resolved || !resolved.war) {
      return replaceLoadingText(ctx, loadingMsg, ctx.t('cwl.not_in_cwl'));
    }

    const html = await buildOurHtml(resolved, ctx.t('cwl.title'), lang);
    await deleteLoading(ctx, loadingMsg);
    loadingMsg = null;
    return sendRich(ctx, html, keyboardOur('cwl', lang), lang);
  } catch (err) {
    console.error('[/cwl]', err.message);
    return richMessageErrorReply(
      ctx,
      err,
      ctx.t('war.fetch_error', { message: err.message })
    );
  }
}

async function cwlEnemyAction(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    await ctx.answerCbQuery();
    const resolved = await resolveCwlWar();
    if (!resolved || !resolved.war) {
      return ctx.reply(ctx.t('cwl.not_in_cwl'));
    }
    const html = await buildEnemyHtml(resolved, ctx.t('war.enemy_title'), lang);
    return editRich(ctx, html, keyboardEnemy('cwl', lang), lang);
  } catch (err) {
    console.error('[cwl:enemy]', err.message);
    return ctx.reply(ctx.t('war.fetch_error', { message: err.message }));
  }
}

async function cwlHomeAction(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    await ctx.answerCbQuery();
    const resolved = await resolveCwlWar();
    if (!resolved || !resolved.war) {
      return ctx.reply(ctx.t('cwl.not_in_cwl'));
    }
    const html = await buildOurHtml(resolved, ctx.t('cwl.title'), lang);
    return editRich(ctx, html, keyboardOur('cwl', lang), lang);
  } catch (err) {
    console.error('[cwl:home]', err.message);
    return ctx.reply(ctx.t('war.fetch_error', { message: err.message }));
  }
}

async function cwlStandingsAction(ctx) {
  const lang = ctx.lang || 'fa';
  try {
    await ctx.answerCbQuery();
    const data = await getCwlStandings();
    const html = buildStandingsHtml(data, lang);
    return editRich(ctx, html, keyboardStandings(lang), lang);
  } catch (err) {
    console.error('[cwl:standings]', err.message);
    return ctx.reply(ctx.t('war.fetch_error', { message: err.message }));
  }
}

module.exports = cwlCommand;
module.exports.cwlEnemyAction = cwlEnemyAction;
module.exports.cwlHomeAction = cwlHomeAction;
module.exports.cwlStandingsAction = cwlStandingsAction;
