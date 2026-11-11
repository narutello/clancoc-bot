const { getCurrentWar } = require('../api/clash');
const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');
const { parseClashTime } = require('../utils/helpers');
const { findOurCwlWar } = require('./cwlService');
const { notifyCwlLeagueEnded } = require('./cwlLeagueEnd');
const {
  hasNotification,
  markNotification,
  getLastState,
  saveState,
  buildWarKey,
  buildWarKeyFromSaved,
} = require('./warState');
const { extractMembers } = require('./warHtml');
const {
  sendToGroup,
  notifyPreparation,
  notifyCwlLeagueStart,
  notifyBattleStart,
  notifyOneHourLeft,
  notifyWarEndedFromSaved,
  notifyWarEnded,
} = require('./warNotify');

let lastLoggedWarState = null;

/** Consider a CWL day-end notification eligible if war ended within this window */
const CWL_END_NOTIFY_WINDOW_MS = 8 * 60 * 60 * 1000;

function isRecentlyEnded(war, windowMs = CWL_END_NOTIFY_WINDOW_MS) {
  const end = parseClashTime(war?.endTime);
  if (!end) return false;
  const age = Date.now() - end.getTime();
  return age >= 0 && age <= windowMs;
}

async function checkRegularWar(bot) {
  const last = await getLastState();
  let war;
  try {
    war = await getCurrentWar();
  } catch (err) {
    if (err.isNotFound) war = { state: 'notInWar' };
    else throw err;
  }

  if (!war || war.state === 'notInWar') {
    // Only close out *regular* wars here. During CWL the clan war endpoint is often
    // notInWar; overwriting last state as is_cwl=false was skipping CWL day-end notifies.
    if (last && !last.is_cwl && last.state && last.state !== 'notInWar') {
      await notifyWarEndedFromSaved(bot, last, false);
      await saveState({
        state: 'notInWar',
        isCwl: false,
        opponentTag: null,
        warTag: null,
        membersJson: null,
      });
    } else if (!last?.is_cwl) {
      await saveState({
        state: 'notInWar',
        isCwl: false,
        opponentTag: null,
        warTag: null,
        membersJson: null,
      });
    }
    return { state: 'notInWar', isCwl: false };
  }

  const members = extractMembers(war);
  if (war.state === 'preparation') await notifyPreparation(bot, war);
  if (war.state === 'inWar') {
    await notifyBattleStart(bot, war, false);
    await notifyOneHourLeft(bot, war, false);
  }
  if (war.state === 'warEnded') await notifyWarEnded(bot, war, false);
  await saveState({
    state: war.state,
    warTag: war.tag || null,
    opponentTag: war.opponent?.tag,
    teamSize: war.teamSize,
    preparationStart: war.preparationStartTime
      ? parseClashTime(war.preparationStartTime)
      : null,
    startTime: war.startTime ? parseClashTime(war.startTime) : null,
    endTime: war.endTime ? parseClashTime(war.endTime) : null,
    ourStars: war.clan?.stars,
    theirStars: war.opponent?.stars,
    ourDestruction: war.clan?.destructionPercentage,
    theirDestruction: war.opponent?.destructionPercentage,
    membersJson: members,
    isCwl: false,
  });
  return war;
}

async function checkCwl(bot) {
  let found;
  try {
    found = await findOurCwlWar();
  } catch (err) {
    console.warn('[WarMonitor] CWL lookup failed:', err.message);
    await tgLog.warn('CWL lookup failed', err.message, { module: 'WarMonitor' });
    return null;
  }

  const last = await getLastState();

  // League / day data gone: if we were mid-CWL day, emit end from saved state once
  if (!found || !found.war) {
    if (last?.is_cwl && last.state && last.state !== 'notInWar' && last.state !== 'warEnded') {
      await notifyWarEndedFromSaved(bot, last, true);
    }
    return null;
  }

  const war = found.war;
  const meta = {
    cwlDay: found.cwlDay,
    cwlTotalDays: found.cwlTotalDays,
    cwlSeason: found.cwlSeason,
  };
  war.__cwlMeta = meta;

  const warKey = buildWarKey(war);
  const lastKey = buildWarKeyFromSaved(last);

  if (war.state === 'preparation') await notifyCwlLeagueStart(bot, war, meta);
  if (war.state === 'inWar') {
    await notifyBattleStart(bot, war, true);
    await notifyOneHourLeft(bot, war, true);
  }

  if (war.state === 'warEnded') {
    const lastWasActive =
      last &&
      last.is_cwl &&
      lastKey === warKey &&
      (last.state === 'inWar' || last.state === 'preparation');

    // hasNotification inside notifyWarEnded still prevents duplicates.
    // recentlyEnded covers the case where regular-war poll wiped is_cwl before we ran.
    const recentlyEnded = isRecentlyEnded(war);

    if (lastWasActive || recentlyEnded) {
      await notifyWarEnded(bot, war, true);
    } else {
      console.log(
        `[WarMonitor] Skip stale CWL warEnded notify (day ${meta.cwlDay}, last=${last?.state || 'none'}, is_cwl=${last?.is_cwl ? 1 : 0})`
      );
      await tgLog.debug(
        'Skipped stale CWL warEnded notify',
        {
          day: meta.cwlDay,
          lastState: last?.state || 'none',
          lastIsCwl: Boolean(last?.is_cwl),
        },
        { module: 'WarMonitor' }
      );
    }
  }

  try {
    await notifyCwlLeagueEnded(bot, found, {
      hasNotification,
      markNotification,
      sendToGroup,
    });
  } catch (err) {
    console.warn('[WarMonitor] notifyCwlLeagueEnded error:', err.message);
    await tgLog.warn('notifyCwlLeagueEnded error', err.message, {
      module: 'WarMonitor',
    });
  }

  await saveState({
    state: war.state,
    warTag: war.tag || null,
    opponentTag: war.opponent?.tag,
    teamSize: war.teamSize,
    preparationStart: war.preparationStartTime
      ? parseClashTime(war.preparationStartTime)
      : null,
    startTime: war.startTime ? parseClashTime(war.startTime) : null,
    endTime: war.endTime ? parseClashTime(war.endTime) : null,
    isCwl: true,
    ourStars: war.clan?.stars,
    theirStars: war.opponent?.stars,
    ourDestruction: war.clan?.destructionPercentage,
    theirDestruction: war.opponent?.destructionPercentage,
  });
  return war;
}

async function checkWarStatus(bot) {
  try {
    // CWL first so day transitions are not lost when clan /currentwar is notInWar
    const cwlWar = await checkCwl(bot);
    const war = await checkRegularWar(bot);
    const state = cwlWar?.state || war?.state || 'unknown';
    const opp =
      cwlWar?.opponent?.name ||
      cwlWar?.opponent?.tag ||
      war?.opponent?.name ||
      war?.opponent?.tag ||
      '-';
    console.log(`[WarMonitor] Check done — state=${state} opponent=${opp}`);
    await tgLog.debug(
      `War poll OK — state=${state}`,
      { opponent: String(opp).slice(0, 80), cwl: Boolean(cwlWar) },
      { module: 'WarMonitor' }
    );
    if (state !== lastLoggedWarState) {
      lastLoggedWarState = state;
      await tgLog.info(
        `War state changed → ${state}`,
        { opponent: String(opp).slice(0, 80), cwl: Boolean(cwlWar) },
        { module: 'WarMonitor' }
      );
    }
  } catch (err) {
    console.error('[WarMonitor] Error during check:', err.message);
    console.error(err.stack);
    await tgLog.error('War check failed', err.stack || err.message, {
      module: 'WarMonitor',
    });
  }
}

function startWarMonitor(bot) {
  console.log(`[WarMonitor] Starting with interval ${config.warPollIntervalMs}ms`);
  tgLog.info(
    `War monitor started (interval ${config.warPollIntervalMs}ms)`,
    null,
    { module: 'WarMonitor' }
  );
  setTimeout(() => checkWarStatus(bot), 5000);
  const interval = setInterval(
    () => checkWarStatus(bot),
    config.warPollIntervalMs
  );
  if (global.__warMonitorInterval) clearInterval(global.__warMonitorInterval);
  global.__warMonitorInterval = interval;
  return interval;
}

function formatMembersList(members) {
  return (members || [])
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0))
    .map((m, i) => `${i + 1}. ${m.name || m.tag}`)
    .join('\n');
}

module.exports = {
  startWarMonitor,
  checkWarStatus,
  formatMembersList,
};
