const { getClan, getCapitalRaidSeasons } = require('../api/clash');
const config = require('../config');
const { checkCommandLimit } = require('../utils/commandRateLimit');
const { singleflight } = require('../utils/singleflight');
const { getCache, setCache } = require('../utils/ttlCache');
const {
  sendLoading,
  deleteLoading,
  replaceLoadingText,
} = require('../utils/loading');
const { clashUserMessage } = require('../utils/apiErrors');
const { withTelegramRetry } = require('../utils/telegramSafe');
const { isRtl } = require('../utils/i18n');
const {
  escapeHtml,
  formatTag,
  stripEmojis,
  parseClashTime,
  formatWarTime,
} = require('../utils/helpers');
const {
  buildSummaryHtml,
  buildTopMembersHtml,
  buildPendingHtml,
  stateLabel,
} = require('../services/capitalNotify');

async function fetchRaidSeason() {
  const data = await getCapitalRaidSeasons(config.clanTag, 2);
  const items = data?.items || [];
  return items[0] || null;
}

async function resolveRaidSeason() {
  const cacheKey = `capitalRaid:${config.clanTag}`;
  const cached = getCache(cacheKey);
  if (cached !== null) return cached;

  return singleflight(cacheKey, async () => {
    const again = getCache(cacheKey);
    if (again !== null) return again;
    const season = await fetchRaidSeason();
    setCache(cacheKey, season, config.warCacheTtlMs || 8000);
    return season;
  });
}

async function sendRichOrFallback(ctx, html, fallback, lang) {
  try {
    return await withTelegramRetry(
      () =>
        ctx.telegram.callApi('sendRichMessage', {
          chat_id: ctx.chat.id,
          rich_message: { html, is_rtl: isRtl(lang) },
        }),
      { maxRetries: config.telegramMaxRetries }
    );
  } catch (err) {
    console.warn('[/capital] rich failed:', err.message);
    return ctx.reply(fallback, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }
}

async function capitalCommand(ctx) {
  let loadingMsg = null;
  const lang = ctx.lang || 'fa';
  const t = ctx.t.bind(ctx);

  try {
    const userId = ctx.from?.id;
    const isOwner =
      userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'capital', {
      limit: config.clanCmdLimit,
      windowMs: config.clanCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.reply(t('rate.capital', { sec: limit.retryAfterSec }), {
        parse_mode: 'HTML',
      });
    }

    loadingMsg = await sendLoading(ctx, t('loading.capital'));

    const clan = await getClan();
    const capital = clan.clanCapital || {};
    const hall = capital.capitalHallLevel ?? '—';
    const points = clan.clanCapitalPoints ?? '—';
    const league = clan.capitalLeague?.name || '—';
    const name = stripEmojis(clan.name || '—') || '—';
    const districts = capital.districts || [];

    const districtRows = districts
      .map(
        (d) =>
          `<tr><td>${escapeHtml(d.name || '—')}</td><td>${
            d.districtHallLevel ?? '—'
          }</td></tr>`
      )
      .join('\n');

    const html = `
      <h2>🏛 ${t('capital.title')}</h2>
      <p>🏰 <b>${escapeHtml(name)}</b> <code>${escapeHtml(
      formatTag(clan.tag)
    )}</code></p>
      <table bordered striped compact>
        <tr><th>${t('clan.col_item')}</th><th>${t('clan.col_value')}</th></tr>
        <tr><td>${t('capital.hall_level')}</td><td><b>${hall}</b></td></tr>
        <tr><td>${t('capital.points')}</td><td><b>${points}</b></td></tr>
        <tr><td>${t('capital.league')}</td><td><b>${escapeHtml(
      league
    )}</b></td></tr>
      </table>
      ${
        districts.length
          ? `<h3>${t('capital.districts')}</h3>
      <table bordered striped compact>
        <tr><th>${t('capital.district_name')}</th><th>${t(
              'capital.district_level'
            )}</th></tr>
        ${districtRows}
      </table>`
          : ''
      }
      <p>${t('capital.hint_raid')}</p>
    `.trim();

    const fallback = `
🏛 <b>${t('capital.title')}</b>
🏰 ${escapeHtml(name)} <code>${escapeHtml(formatTag(clan.tag))}</code>

${t('capital.hall_level')}: <b>${hall}</b>
${t('capital.points')}: <b>${points}</b>
${t('capital.league')}: <b>${escapeHtml(league)}</b>

${t('capital.hint_raid')}
`.trim();

    await deleteLoading(ctx, loadingMsg);
    loadingMsg = null;
    return sendRichOrFallback(ctx, html, fallback, lang);
  } catch (err) {
    console.error('[/capital]', err.message);
    return replaceLoadingText(
      ctx,
      loadingMsg,
      clashUserMessage(err, t, 'capital.fetch_error')
    );
  }
}

async function raidCommand(ctx) {
  let loadingMsg = null;
  const lang = ctx.lang || 'fa';
  const t = ctx.t.bind(ctx);

  try {
    const userId = ctx.from?.id;
    const isOwner =
      userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'raid', {
      limit: config.clanCmdLimit,
      windowMs: config.clanCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.reply(t('rate.raid', { sec: limit.retryAfterSec }), {
        parse_mode: 'HTML',
      });
    }

    loadingMsg = await sendLoading(ctx, t('loading.raid'));

    const season = await resolveRaidSeason();
    if (!season) {
      return replaceLoadingText(ctx, loadingMsg, t('capital.no_raid'));
    }

    const title =
      season.state === 'ongoing'
        ? t('capital.raid_title_ongoing')
        : t('capital.raid_title_last');

    let extra = await buildTopMembersHtml(season.members || [], lang, 12);
    if (season.state === 'ongoing') {
      extra += '\n' + (await buildPendingHtml(season.members || [], lang));
    }

    const html = buildSummaryHtml(season, title, lang, extra);

    const start = parseClashTime(season.startTime);
    const end = parseClashTime(season.endTime);
    const fallback = `
${title}
${t('capital.state_line', { state: stateLabel(season.state, lang) })}
💰 ${t('capital.loot')}: <b>${season.capitalTotalLoot ?? 0}</b>
⚔️ ${t('capital.total_attacks')}: <b>${season.totalAttacks ?? 0}</b>
🏕 ${t('capital.raids_completed')}: <b>${season.raidsCompleted ?? 0}</b>
${start ? `🕐 ${formatWarTime(start, lang)}` : ''}
${end ? `🏁 ${formatWarTime(end, lang)}` : ''}
`.trim();

    await deleteLoading(ctx, loadingMsg);
    loadingMsg = null;
    return sendRichOrFallback(ctx, html, fallback, lang);
  } catch (err) {
    console.error('[/raid]', err.message);
    return replaceLoadingText(
      ctx,
      loadingMsg,
      clashUserMessage(err, t, 'capital.fetch_error')
    );
  }
}

module.exports = capitalCommand;
module.exports.raidCommand = raidCommand;
