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

async function fetchCwlWar() {
  try {
    const found = await findOurCwlWar();
    if (found && found.war) return found;
  } catch (err) {
    if (!err.isNotFound) throw err;
  }
  return null;
}

async function resolveCwlWar() {
  const cacheKey = `cwlWar:${config.clanTag}`;
  const cached = getCache(cacheKey);
  if (cached !== null) return cached;

  return singleflight(cacheKey, async () => {
    const again = getCache(cacheKey);
    if (again !== null) return again;
    const result = await fetchCwlWar();
    setCache(cacheKey, result, config.warCacheTtlMs);
    return result;
  });
}

async function cwlCommand(ctx) {
  let loadingMsg = null;
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
      return ctx.reply(
        `⏳ تعداد درخواست‌های /cwl زیاد است.\n` +
          `لطفاً حدود <b>${limit.retryAfterSec}</b> ثانیه دیگر دوباره تلاش کنید.`,
        { parse_mode: 'HTML' }
      );
    }

    loadingMsg = await sendLoading(ctx, '⏳ در حال دریافت وضعیت لیگ...');

    const resolved = await resolveCwlWar();
    if (!resolved || !resolved.war) {
      return replaceLoadingText(
        ctx,
        loadingMsg,
        'در حال حاضر کلن در لیگ کلن‌ها (CWL) نیست.'
      );
    }

    const html = await buildOurHtml(resolved, '🏟 وضعیت لیگ کلن‌ها');
    await deleteLoading(ctx, loadingMsg);
    loadingMsg = null;
    return sendRich(ctx, html, keyboardOur('cwl'));
  } catch (err) {
    console.error('[/cwl]', err.message);
    await deleteLoading(ctx, loadingMsg);
    return richMessageErrorReply(
      ctx,
      err,
      `❌ خطا در دریافت اطلاعات CWL: ${err.message}`
    );
  }
}

async function cwlEnemyAction(ctx) {
  try {
    await ctx.answerCbQuery('⏳ در حال بارگذاری...');
    const resolved = await resolveCwlWar();
    if (!resolved || !resolved.war) {
      return ctx.answerCbQuery('در حال حاضر کلن در CWL نیست.', {
        show_alert: true,
      });
    }
    const html = await buildEnemyHtml(resolved, '⚡ تیم حریف (CWL)');
    return editRich(ctx, html, keyboardEnemy('cwl'));
  } catch (err) {
    console.error('[cwl:enemy]', err.message);
    try {
      await ctx.answerCbQuery('خطا در دریافت اطلاعات حریف', { show_alert: true });
    } catch (_) {}
  }
}

async function cwlHomeAction(ctx) {
  try {
    await ctx.answerCbQuery('⏳ در حال بارگذاری...');
    const resolved = await resolveCwlWar();
    if (!resolved || !resolved.war) {
      return ctx.answerCbQuery('در حال حاضر کلن در CWL نیست.', {
        show_alert: true,
      });
    }
    const html = await buildOurHtml(resolved, '🏟 وضعیت لیگ کلن‌ها');
    return editRich(ctx, html, keyboardOur('cwl'));
  } catch (err) {
    console.error('[cwl:home]', err.message);
    try {
      await ctx.answerCbQuery('خطا در بازگشت', { show_alert: true });
    } catch (_) {}
  }
}

async function cwlStandingsAction(ctx) {
  try {
    const userId = ctx.from?.id;
    const isOwner =
      userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'cwl_standings', {
      limit: config.cwlCmdLimit,
      windowMs: config.cwlCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.answerCbQuery(
        `درخواست زیاد است. حدود ${limit.retryAfterSec} ثانیه صبر کنید.`,
        { show_alert: true }
      );
    }

    await ctx.answerCbQuery('⏳ در حال ساخت جدول لیگ...');
    const data = await getCwlStandings();
    if (!data || !data.standings || !data.standings.length) {
      return ctx.answerCbQuery('جدول لیگ در دسترس نیست.', { show_alert: true });
    }

    const html = buildStandingsHtml(data);
    return editRich(ctx, html, keyboardStandings());
  } catch (err) {
    console.error('[cwl:standings]', err.message);
    try {
      await ctx.answerCbQuery('خطا در دریافت جدول لیگ', { show_alert: true });
    } catch (_) {}
  }
}

module.exports = cwlCommand;
module.exports.cwlEnemyAction = cwlEnemyAction;
module.exports.cwlHomeAction = cwlHomeAction;
module.exports.cwlStandingsAction = cwlStandingsAction;
module.exports.resolveCwlWar = resolveCwlWar;
