const { getCwlStandings, buildCwlLeagueKey } = require('./cwlService');
const { getLinksForTags } = require('./linkService');
const { escapeHtml, tgUserLink, normalizeTag } = require('../utils/helpers');
const { t } = require('../utils/i18n');
const { tgLog } = require('../utils/telegramLogger');
const { groupLang } = require('./warNotify');

const THANKS_MIN_STARS = 15;

function mentionLabel(u, m, lang) {
  if (u.username) {
    return `<a href="tg://user?id=${u.telegram_id}">@${escapeHtml(u.username)}</a>`;
  }
  const label =
    (u.first_name && String(u.first_name).trim()) ||
    (m.name && String(m.name).trim()) ||
    t('common.player_fallback', { lng: lang });
  return tgUserLink(u.telegram_id, label);
}

async function buildThanksMentionsHtml(ourPlayerStars, lang) {
  const entries = Object.entries(ourPlayerStars || {})
    .map(([tag, info]) => ({
      tag: normalizeTag(tag),
      stars: Number(info.stars || 0),
      name: info.name || tag,
    }))
    .filter((x) => x.stars >= THANKS_MIN_STARS)
    .sort((a, b) => b.stars - a.stars);

  if (!entries.length) {
    return `<p>${t('notify.thanks_all', { lng: lang })}</p>`;
  }

  const map = await getLinksForTags(entries.map((e) => e.tag));
  const seen = new Set();
  const mentionParts = [];

  for (const m of entries) {
    const links = map.get(m.tag) || [];
    for (const u of links) {
      const id = u.telegram_id;
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      mentionParts.push(mentionLabel(u, m, lang));
    }
  }

  if (!mentionParts.length) {
    return (
      `<p>${t('notify.thanks_unlinked', {
        lng: lang,
        min: THANKS_MIN_STARS,
      })}</p>` +
      `<p>${t('notify.thanks_rest', { lng: lang })}</p>`
    );
  }

  return (
    `<p>${t('notify.thanks_special', {
      lng: lang,
      min: THANKS_MIN_STARS,
      list: mentionParts.join(' · '),
    })}</p>` +
    `<p>${t('notify.thanks_rest', { lng: lang })}</p>`
  );
}

function buildLeagueEndStandingsTable(standings) {
  return (standings || [])
    .map((row) => {
      const name = escapeHtml(row.name || row.tag);
      const label = row.isOurs ? `<b>🏰 ${name}</b>` : name;
      const starsLabel =
        row.bonusStars > 0
          ? `${row.stars} ⭐ <i>(${row.attackStars}+${row.bonusStars})</i>`
          : `${row.stars} ⭐`;
      return `<tr>
        <td>${row.rank}</td>
        <td>${label}</td>
        <td>${starsLabel}</td>
        <td>${(row.destruction || 0).toFixed(1)}%</td>
      </tr>`;
    })
    .join('');
}

async function notifyCwlLeagueEnded(
  bot,
  found,
  { hasNotification, markNotification, sendToGroup }
) {
  let data;
  try {
    data = await getCwlStandings({ forceFresh: true });
  } catch (err) {
    console.warn('[WarMonitor] League-end standings failed:', err.message);
    await tgLog.warn('CWL league-end standings failed', err.message, {
      module: 'WarMonitor',
    });
    return;
  }
  if (!data || !data.standings || !data.standings.length) return;

  const season = data.season || found?.cwlSeason || 'unknown';
  const leagueKey = buildCwlLeagueKey(season);
  const event = 'cwl_league_ended';
  if (await hasNotification(leagueKey, event)) return;

  const groupEnded = String(data.state || '').toLowerCase() === 'ended';
  const noActiveWars = (data.activeWars || 0) === 0;
  const lastDayFromFound =
    found &&
    found.cwlDay &&
    found.cwlTotalDays &&
    Number(found.cwlDay) === Number(found.cwlTotalDays) &&
    found.war &&
    found.war.state === 'warEnded';
  const allOurWarsDone =
    data.ourWarsTotal > 0 && data.ourWarsEnded >= data.ourWarsTotal;

  const leagueFinished =
    groupEnded || (noActiveWars && (lastDayFromFound || allOurWarsDone));

  if (!leagueFinished) return;
  if ((data.activeWars || 0) > 0 && !groupEnded) return;

  const lang = await groupLang();
  const our = data.ourRow;
  const totalClans = data.standings.length;
  const seasonLine = data.season
    ? `<p>${t('cwl.season', {
        lng: lang,
        season: escapeHtml(String(data.season)),
      })}</p>`
    : '';
  const summary = our
    ? `<p>${t('notify.league_rank', {
        lng: lang,
        rank: our.rank,
        total: totalClans,
        stars: our.stars,
        wins: our.wins,
      })}</p>`
    : '';

  const thanks = await buildThanksMentionsHtml(data.ourPlayerStars || {}, lang);
  const rows = buildLeagueEndStandingsTable(data.standings);

  const html = `<h2>${t('notify.league_ended_title', { lng: lang })}</h2>
${seasonLine}
<p>${t('notify.league_final', { lng: lang })}</p>
<table bordered striped compact>
<tr><th>${t('common.rank', { lng: lang })}</th><th>${t('common.clan', {
    lng: lang,
  })}</th><th>${t('common.stars', { lng: lang })}</th><th>${t(
    'common.destruction',
    { lng: lang }
  )}</th></tr>
${rows}
</table>
${summary}
${thanks}
<p>${t('notify.good_job', { lng: lang })}</p>`.trim();

  await sendToGroup(bot, html, lang);
  await tgLog.info(
    `Notification sent: CWL league ended — rank ${our?.rank || '?'}/${totalClans}`,
    {
      season: String(season),
      groupState: String(data.state || ''),
      activeWars: data.activeWars,
    },
    { module: 'WarMonitor' }
  );
  await markNotification(leagueKey, event);
}

module.exports = { notifyCwlLeagueEnded };
