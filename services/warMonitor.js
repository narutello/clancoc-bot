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
    if (last && !last.is_cwl && last.state && last.state !== 'notInWar') {
      await notifyWarEndedFromSaved(bot, last, false);
    }
    await saveState({
      state: 'notInWar',
      isCwl: false,
      opponentTag: null,
      warTag: null,
      membersJson: null,
    });
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
  if (!found || !found.war) return null;
  const war = found.war;
  const meta = {
    cwlDay: found.cwlDay,
    cwlTotalDays: found.cwlTotalDays,
    cwlSeason: found.cwlSeason,
  };
  war.__cwlMeta = meta;

  const last = await getLastState();
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
    if (lastWasActive) {
      await notifyWarEnded(bot, war, true);
    } else {
      console.log(
        `[WarMonitor] Skip stale CWL warEnded notify (day ${meta.cwlDay}, last=${last?.state || 'none'})`
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
    const war = await checkRegularWar(bot);
    const state = war?.state || 'unknown';
    const opp = war?.opponent?.name || war?.opponent?.tag || '-';
    console.log(`[WarMonitor] Check done — state=${state} opponent=${opp}`);
    await tgLog.debug(
      `War poll OK — state=${state}`,
      { opponent: String(opp).slice(0, 80) },
      { module: 'WarMonitor' }
    );
    if (state !== lastLoggedWarState) {
      lastLoggedWarState = state;
      await tgLog.info(
        `War state changed → ${state}`,
        { opponent: String(opp).slice(0, 80) },
        { module: 'WarMonitor' }
      );
    }
    await checkCwl(bot);
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
