const { getCurrentWar } = require('../api/clash');
const { isInCwl } = require('../services/cwlService');
const config = require('../config');
const { checkCommandLimit } = require('../utils/commandRateLimit');
const { singleflight } = require('../utils/singleflight');
const { getCache, setCache } = require('../utils/ttlCache');
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
        `⏳ تعداد درخواست‌های /war زیاد است.\n` +
          `لطفاً حدود <b>${limit.retryAfterSec}</b> ثانیه دیگر دوباره تلاش کنید.`,
        { parse_mode: 'HTML' }
      );
    }

    const resolved = await resolveRegularWar();
    if (resolved && resolved.war) {
      const html = await buildOurHtml(resolved, '⚔️ وضعیت وار');
      return sendRich(ctx, html, keyboardOur('war'));
    }

    if (await isInCwl()) {
      return ctx.reply(
        '🏟 کلن الان در <b>لیگ کلن‌ها (CWL)</b> است.\n' +
          'برای وضعیت لیگ از دستور /cwl استفاده کنید.',
        { parse_mode: 'HTML' }
      );
    }

    return ctx.reply('در حال حاضر کلن در وار نیست.');
  } catch (err) {
    console.error('[/war]', err.message);
    return richMessageErrorReply(
      ctx,
      err,
      `❌ خطا در دریافت اطلاعات وار: ${err.message}`
    );
  }
}

async function warEnemyAction(ctx) {
  try {
    const resolved = await resolveRegularWar();
    if (!resolved || !resolved.war) {
      return ctx.answerCbQuery('در حال حاضر کلن در وار معمولی نیست.', {
        show_alert: true,
      });
    }
    await ctx.answerCbQuery();
    const html = await buildEnemyHtml(resolved, '⚡ تیم حریف');
    return editRich(ctx, html, keyboardEnemy('war'));
  } catch (err) {
    console.error('[war:enemy]', err.message);
    try {
      await ctx.answerCbQuery('خطا در دریافت اطلاعات حریف', { show_alert: true });
    } catch (_) {}
  }
}

async function warHomeAction(ctx) {
  try {
    const resolved = await resolveRegularWar();
    if (!resolved || !resolved.war) {
      return ctx.answerCbQuery('در حال حاضر کلن در وار معمولی نیست.', {
        show_alert: true,
      });
    }
    await ctx.answerCbQuery();
    const html = await buildOurHtml(resolved, '⚔️ وضعیت وار');
    return editRich(ctx, html, keyboardOur('war'));
  } catch (err) {
    console.error('[war:home]', err.message);
    try {
      await ctx.answerCbQuery('خطا در بازگشت', { show_alert: true });
    } catch (_) {}
  }
}

module.exports = warCommand;
module.exports.warEnemyAction = warEnemyAction;
module.exports.warHomeAction = warHomeAction;
module.exports.resolveRegularWar = resolveRegularWar;
