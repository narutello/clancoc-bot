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

async function buildThanksMentionsHtml(rosterTags) {
  if (!rosterTags || rosterTags.length === 0) return '';
  const linksMap = await getLinksForTags(rosterTags);
  const seenIds = new Set();
  const parts = [];
  for (const tag of rosterTags) {
    const key = normalizeTag(tag);
    const links = linksMap.get(key) || linksMap.get(tag) || [];
    for (const u of links) {
      const id = u.telegram_id;
      if (id == null || seenIds.has(id)) continue;
      seenIds.add(id);
      if (u.username) {
        parts.push(
          `<a href="tg://user?id=${id}">@${escapeHtml(u.username)}</a>`
        );
      } else {
        parts.push(tgUserLink(id, u.first_name || 'منشن'));
      }
    }
  }
  if (!parts.length) return '';
  return `<p>🙏 ممنون از همه کسانی که این فصل جنگیدن:<br/>${parts.join(' · ')}</p>`;
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

/**
 * یک‌بار در پایان فصل لیگ: جدول نهایی + تشکر از اعضای roster (لینک‌شده).
 */
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

  const thanks = await buildThanksMentionsHtml(data.ourRosterTags || []);
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
