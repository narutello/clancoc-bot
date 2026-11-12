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
const {
  markPollStart,
  markPollSuccess,
  markPollError,
  markNextPoll,
} = require('./monitorStats');
const {
  recordFinishedWar,
  recordFinishedWarFromSaved,
  runStatsMaintenance,
} = require('./statsService');

let lastLoggedWarState = null;
let monitorTimer = null;
let monitorStopped = false;
let lastActiveWar = null;

const CWL_END_NOTIFY_WINDOW_MS = 8 * 60 * 60 * 1000;

function isRecentlyEnded(war, windowMs = CWL_END_NOTIFY_WINDOW_MS) {
  const end = parseClashTime(war?.endTime);
  if (!end) return false;
  const age = Date.now() - end.getTime();
  return age >= 0 && age <= windowMs;
}

function clampPollMs(ms) {
  const min = Math.max(10000, config.warPollMinMs || 20000);
  const max = 15 * 60 * 1000;
  const n = Number(ms);
  if (!Number.isFinite(n)) return config.warPollActiveMs || 120000;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function computeNextInterval(war) {
  const idle = config.warPollIdleMs || 300000;
  const active = config.warPollActiveMs || config.warPollIntervalMs || 120000;
  const near = config.warPollNearMs || 30000;

  if (!war || !war.state || war.state === 'notInWar') {
    return { ms: clampPollMs(idle), reason: 'idle_not_in_war' };
  }

  const now = Date.now();

  if (war.state === 'preparation') {
    const start =
      parseClashTime(war.startTime) || parseClashTime(war.preparationStartTime);
    if (start) {
      const msToStart = start.getTime() - now;
      if (msToStart <= 0) {
        return { ms: clampPollMs(near), reason: 'prep_should_have_started' };
      }
      if (msToStart <= 20 * 60 * 1000) {
        return { ms: clampPollMs(near), reason: 'prep_near_start' };
      }
    }
    return { ms: clampPollMs(active), reason: 'preparation' };
  }

  if (war.state === 'inWar') {
    const end = parseClashTime(war.endTime);
    if (end) {
      const msToEnd = end.getTime() - now;
      if (msToEnd <= 0) {
        return { ms: clampPollMs(near), reason: 'inwar_should_have_ended' };
      }
      if (msToEnd >= 50 * 60 * 1000 && msToEnd <= 75 * 60 * 1000) {
        return { ms: clampPollMs(near), reason: 'inwar_one_hour_window' };
      }
      if (msToEnd <= 20 * 60 * 1000) {
        return { ms: clampPollMs(near), reason: 'inwar_near_end' };
      }
      if (msToEnd <= 2 * 60 * 60 * 1000) {
        return { ms: clampPollMs(active), reason: 'inwar_within_2h' };
      }
    }
    return { ms: clampPollMs(active), reason: 'in_war' };
  }

  if (war.state === 'warEnded') {
    return { ms: clampPollMs(active), reason: 'war_ended' };
  }

  return { ms: clampPollMs(active), reason: 'default_active' };
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
    if (last && !last.is_cwl && last.state && last.state !== 'notInWar') {
      await notifyWarEndedFromSaved(bot, last, false);
      await recordFinishedWarFromSaved(last, false);
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
  if (war.state === 'warEnded') {
    await notifyWarEnded(bot, war, false);
    await recordFinishedWar(war, { isCwl: false });
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

  if (!found || !found.war) {
    if (
      last?.is_cwl &&
      last.state &&
      last.state !== 'notInWar' &&
      last.state !== 'warEnded'
    ) {
      await notifyWarEndedFromSaved(bot, last, true);
      await recordFinishedWarFromSaved(last, true);
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

    const recentlyEnded = isRecentlyEnded(war);

    if (lastWasActive || recentlyEnded) {
      await notifyWarEnded(bot, war, true);
      await recordFinishedWar(war, { isCwl: true });
    } else {
      console.log(
        `[WarMonitor] Skip stale CWL warEnded notify (day ${meta.cwlDay}, last=${last?.state || 'none'}, is_cwl=${last?.is_cwl ? 1 : 0})`
      );
      await recordFinishedWar(war, { isCwl: true });
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
    membersJson: extractMembers(war),
  });
  return war;
}

async function checkWarStatus(bot) {
  markPollStart();
  try {
    const cwlWar = await checkCwl(bot);
    const war = await checkRegularWar(bot);
    const active =
      cwlWar && cwlWar.state && cwlWar.state !== 'notInWar' ? cwlWar : war;
    lastActiveWar = active;

    const state = active?.state || 'unknown';
    const opp =
      active?.opponent?.name || active?.opponent?.tag || '-';
    const isCwl = Boolean(cwlWar && cwlWar.state && cwlWar.state !== 'notInWar');

    markPollSuccess({
      state,
      opponent: String(opp).slice(0, 80),
      isCwl,
      cwlDay: cwlWar?.__cwlMeta?.cwlDay || null,
      cwlTotalDays: cwlWar?.__cwlMeta?.cwlTotalDays || null,
    });

    try {
      await runStatsMaintenance(bot);
    } catch (err) {
      console.warn('[WarMonitor] stats maintenance:', err.message);
    }

    console.log(`[WarMonitor] Check done — state=${state} opponent=${opp}`);
    await tgLog.debug(
      `War poll OK — state=${state}`,
      { opponent: String(opp).slice(0, 80), cwl: isCwl },
      { module: 'WarMonitor' }
    );
    if (state !== lastLoggedWarState) {
      lastLoggedWarState = state;
      await tgLog.info(
        `War state → ${state}`,
        { opponent: String(opp).slice(0, 80), cwl: isCwl },
        { module: 'WarMonitor' }
      );
    }

    const interval = computeNextInterval(
      active && active.state ? active : { state: 'notInWar' }
    );
    markNextPoll(interval.ms, interval.reason);
    return { war: active, interval };
  } catch (err) {
    markPollError(err);
    console.error('[WarMonitor] Check failed:', err.message);
    await tgLog.error('War check failed', err.stack || err.message, {
      module: 'WarMonitor',
    });
    const interval = {
      ms: clampPollMs(config.warPollActiveMs || 120000),
      reason: 'error_backoff',
    };
    markNextPoll(interval.ms, interval.reason);
    return { war: lastActiveWar, interval };
  }
}

function scheduleNext(bot, ms) {
  if (monitorStopped) return;
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = setTimeout(async () => {
    const result = await checkWarStatus(bot);
    const next = result?.interval?.ms || config.warPollActiveMs || 120000;
    scheduleNext(bot, next);
  }, ms);
}

function startWarMonitor(bot) {
  monitorStopped = false;
  console.log('[WarMonitor] Starting adaptive war monitor...');
  scheduleNext(bot, 3000);
}

function stopWarMonitor() {
  monitorStopped = true;
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = null;
}

module.exports = {
  startWarMonitor,
  stopWarMonitor,
  checkWarStatus,
};
