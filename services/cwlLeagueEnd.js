const { getLinksForTags } = require('./linkService');
const {
  escapeHtml,
  tgUserLink,
  normalizeTag,
} = require('../utils/helpers');
const { tgLog } = require('../utils/telegramLogger');
const {
  getCwlStandings,
  buildCwlLeagueKey,
} = require('./cwlService');

/** Minimum attack stars across the league to appear in special thanks */
const THANKS_MIN_STARS = 15;

/**
 * Mention only linked Telegram users for the given clash tags.
 * Prefer @username; otherwise clickable first_name / in-game name (never the word «منشن»).
 */
async function buildThanksMentionsHtml(playerStarsMap) {
  const entries = Object.entries(playerStarsMap || {})
    .map(([tag, info]) => ({
      tag: normalizeTag(tag),
      stars: Number(info?.stars) || 0,
      name: info?.name || tag,
    }))
    .filter((e) => e.tag && e.stars >= THANKS_MIN_STARS)
    .sort((a, b) => b.stars - a.stars);

  if (!entries.length) {
    return `<p>💚 از همه اعضای کلن بابت تلاش این فصل ممنونیم.</p>`;
  }

  const tags = entries.map((e) => e.tag);
  const linksMap = await getLinksForTags(tags);
  const nameByTag = new Map(entries.map((e) => [e.tag, e.name]));

  const seenIds = new Set();
  const parts = [];

  for (const e of entries) {
    const links = linksMap.get(e.tag) || [];
    for (const u of links) {
      const id = u.telegram_id;
      if (id == null || seenIds.has(id)) continue;
      seenIds.add(id);

      if (u.username) {
        // Real @username, still deep-linked so notification works in groups
        parts.push(
          `<a href="tg://user?id=${id}">@${escapeHtml(u.username)}</a>`
        );
      } else {
        // No public username → Telegram cannot show @handle; use name (opens profile)
        const label =
          (u.first_name && String(u.first_name).trim()) ||
          nameByTag.get(e.tag) ||
          'بازیکن';
        parts.push(tgUserLink(id, label));
      }
    }
  }

  if (!parts.length) {
    // Eligible by stars but nobody linked their account
    return (
      `<p>⭐ این فصل چند نفر حداقل ${THANKS_MIN_STARS} ستاره گرفتند؛ ` +
      `برای منشن شدن اکانت‌شان را به ربات لینک کنند.</p>` +
      `<p>💚 از بقیه اعضای کلن هم ممنونیم.</p>`
    );
  }

  return (
    `<p>⭐ با تشکر ویژه از کسانی که حداقل <b>${THANKS_MIN_STARS}</b> ستاره گرفتند:<br/>` +
    `${parts.join(' · ')}</p>` +
    `<p>💚 و از بقیه اعضای کلن هم بابت همراهی این فصل ممنونیم.</p>`
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

async function notifyCwlLeagueEnded(bot, found, { hasNotification, markNotification, sendToGroup }) {
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

  const our = data.ourRow;
  const totalClans = data.standings.length;
  const seasonLine = data.season
    ? `<p>📅 فصل: <b>${escapeHtml(String(data.season))}</b></p>`
    : '';
  const summary = our
    ? `<p>🏅 رتبه کلن ما: <b>${our.rank} از ${totalClans}</b><br/>⭐ مجموع ستاره: <b>${our.stars}</b><br/>🏆 تعداد برد: <b>${our.wins}</b></p>`
    : '';

  const thanks = await buildThanksMentionsHtml(data.ourPlayerStars || {});
  const rows = buildLeagueEndStandingsTable(data.standings);

  const html = `<h2>🏁 لیگ کلن‌ها به پایان رسید!</h2>
${seasonLine}
<p>🏟 نتیجه نهایی گروه</p>
<table bordered striped compact>
<tr><th>#</th><th>کلن</th><th>ستاره</th><th>تخریب</th></tr>
${rows}
</table>
${summary}
${thanks}
<p>خسته نباشید 💪</p>`.trim();

  await sendToGroup(bot, html);
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
