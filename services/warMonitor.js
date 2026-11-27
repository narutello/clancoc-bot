const { getCurrentWar, getCwlWar } = require('../api/clash');
const config = require('../config');
const { resetQueryCount } = require('../database');
const { tgLog } = require('../utils/telegramLogger');
const { parseClashTime, normalizeTag } = require('../utils/helpers');
const { findOurCwlWar } = require('./cwlService');
const { notifyCwlLeagueEnded } = require('./cwlLeagueEnd');
const {
  claimNotification,
  releaseNotification,
  getLastState,
  saveStateIfChanged,
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
  notifyNewAttacks,
} = require('./warNotify');
const {
  markPollStart,
  markPollSuccess,
  markPollError,
  markNextPoll,
  getMonitorStats,
} = require('./monitorStats');
const {
  recordFinishedWar,
  recordFinishedWarFromSaved,
  startStatsMaintenance,
  stopStatsMaintenance,
} = require('./statsService');
const { isNotifyEnabled } = require('./settingsService');

let lastLoggedWarState = null;
let monitorTimer = null;
let monitorStopped = false;
let lastActiveWar = null;
let lastMetricsLogAt = 0;

const CWL_END_NOTIFY_WINDOW_MS = 8 * 60 * 60 * 1000;
const METRICS_LOG_EVERY_MS = 15 * 60 * 1000;

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

async function maybeNotifyAttacks(bot, war, last, isCwl) {
  if (!war || war.state !== 'inWar') return;
  const warKey = buildWarKey(war);
  const lastKey = buildWarKeyFromSaved(last);
  if (!last || lastKey !== warKey) return;
  if (last.state !== 'inWar' && last.state !== 'preparation') return;

  let prevMembers = last.members_json;
  if (typeof prevMembers === 'string') {
    try {
      prevMembers = JSON.parse(prevMembers);
    } catch {
      prevMembers = [];
    }
  }
  await notifyNewAttacks(bot, war, prevMembers || [], isCwl);
}

function notInWarPayload(isCwl = false) {
  return {
    state: 'notInWar',
    isCwl: Boolean(isCwl),
    opponentTag: null,
    warTag: null,
    membersJson: null,
    teamSize: null,
    preparationStart: null,
    startTime: null,
    endTime: null,
    ourStars: null,
    theirStars: null,
    ourDestruction: null,
    theirDestruction: null,
  };
}

/** Map save payload to war_state row shape used by notify/diff helpers. */
function toLastRowShape(data) {
  return {
    state: data.state,
    war_tag: data.warTag || null,
    opponent_tag: data.opponentTag || null,
    team_size: data.teamSize ?? null,
    preparation_start: data.preparationStart || null,
    start_time: data.startTime || null,
    end_time: data.endTime || null,
    our_stars: data.ourStars ?? null,
    their_stars: data.theirStars ?? null,
    our_destruction: data.ourDestruction ?? null,
    their_destruction: data.theirDestruction ?? null,
    members_json: data.membersJson ?? null,
    is_cwl: Boolean(data.isCwl),
  };
}

/**
 * Persist only when changed; keep in-tick state ref in sync for that slot.
 * @param {{ last: object|null }} stateRef
 */
async function persistSlotState(stateRef, payload) {
  const saved = await saveStateIfChanged(stateRef.last, payload);
  if (saved) {
    stateRef.last = toLastRowShape(payload);
  }
  return saved;
}

/** Orient CWL war so war.clan is always our clan. */
function orientCwlWar(war) {
  if (!war) return war;
  const ourTag = normalizeTag(config.clanTag);
  const clanTag = normalizeTag(war.clan?.tag);
  const oppTag = normalizeTag(war.opponent?.tag);
  if (oppTag === ourTag && clanTag !== ourTag) {
    const tmp = war.clan;
    war.clan = war.opponent;
    war.opponent = tmp;
  }
  return war;
}

/**
 * Prefer a fresh API snapshot of the previous CWL day so late attacks are included.
 * Falls back to saved state when war_tag is missing or the request fails.
 */
async function closeCwlDayFromSavedOrApi(bot, last) {
  if (!last?.is_cwl) return;

  const warTag = last.war_tag;
  if (warTag) {
    try {
      let war = await getCwlWar(warTag);
      war = orientCwlWar(war);
      if (war && war.state && war.state !== 'notInWar') {
        await notifyWarEnded(bot, war, true);
        await recordFinishedWar(war, { isCwl: true });
        await tgLog.info(
          'CWL day closed from API snapshot',
          { warTag: normalizeTag(warTag), state: war.state },
          { module: 'WarMonitor' }
        );
        return;
      }
    } catch (err) {
      console.warn(
        '[WarMonitor] CWL final fetch failed, using saved state:',
        err.message
      );
    }
  }

  await notifyWarEndedFromSaved(bot, last, true);
  await recordFinishedWarFromSaved(last, true);
}

/**
 * When CWL advances to a new day, findOurCwlWar returns the new active war and
 * never surfaces the previous day's warEnded. Close out the saved day first.
 */
async function closePreviousCwlDayIfNeeded(bot, stateRef, warKey) {
  const last = stateRef.last;
  if (!last?.is_cwl) return;
  if (!last.state || last.state === 'notInWar' || last.state === 'warEnded') return;

  const lastKey = buildWarKeyFromSaved(last);
  if (!lastKey || !warKey || lastKey === warKey) return;

  console.log(
    `[WarMonitor] CWL day transition — closing previous war (${lastKey} → ${warKey})`
  );
  await closeCwlDayFromSavedOrApi(bot, last);
  await tgLog.info(
    'CWL previous day closed on transition',
    { from: lastKey, to: warKey, lastState: last.state },
    { module: 'WarMonitor' }
  );
}

async function checkRegularWar(bot, stateRef) {
  const last = stateRef.last;
  let war;
  try {
    war = await getCurrentWar();
  } catch (err) {
    if (err.isNotFound) war = { state: 'notInWar' };
    else throw err;
  }

  if (!war || war.state === 'notInWar') {
    if (last && last.state && last.state !== 'notInWar') {
      await notifyWarEndedFromSaved(bot, last, false);
      await recordFinishedWarFromSaved(last, false);
      await persistSlotState(stateRef, notInWarPayload(false));
    } else {
      await persistSlotState(stateRef, notInWarPayload(false));
    }
    return { state: 'notInWar', isCwl: false };
  }

  const members = extractMembers(war);
  if (war.state === 'preparation') await notifyPreparation(bot, war);
  if (war.state === 'inWar') {
    await notifyBattleStart(bot, war, false);
    await maybeNotifyAttacks(bot, war, last, false);
    await notifyOneHourLeft(bot, war, false);
  }
  if (war.state === 'warEnded') {
    await notifyWarEnded(bot, war, false);
    await recordFinishedWar(war, { isCwl: false });
  }
  await persistSlotState(stateRef, {
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

async function checkCwl(bot, stateRef) {
  let found;
  try {
    found = await findOurCwlWar();
  } catch (err) {
    console.warn('[WarMonitor] CWL lookup failed:', err.message);
    await tgLog.warn('CWL lookup failed', err.message, { module: 'WarMonitor' });
    return null;
  }

  const last = stateRef.last;

  if (!found || !found.war) {
    if (
      last?.is_cwl &&
      last.state &&
      last.state !== 'notInWar' &&
      last.state !== 'warEnded'
    ) {
      await closeCwlDayFromSavedOrApi(bot, last);
      await persistSlotState(stateRef, notInWarPayload(true));
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

  // Days 1–6: next day becomes active before we ever see warEnded of previous day
  await closePreviousCwlDayIfNeeded(bot, stateRef, warKey);

  if (war.state === 'preparation') await notifyCwlLeagueStart(bot, war, meta);
  if (war.state === 'inWar') {
    await notifyBattleStart(bot, war, true);
    await maybeNotifyAttacks(bot, war, stateRef.last, true);
    await notifyOneHourLeft(bot, war, true);
  }

  if (war.state === 'warEnded') {
    const lastWasActive =
      stateRef.last &&
      stateRef.last.is_cwl &&
      buildWarKeyFromSaved(stateRef.last) === warKey &&
      (stateRef.last.state === 'inWar' || stateRef.last.state === 'preparation');

    const recentlyEnded = isRecentlyEnded(war);

    if (lastWasActive || recentlyEnded) {
      await notifyWarEnded(bot, war, true);
      await recordFinishedWar(war, { isCwl: true });
    } else {
      console.log(
        `[WarMonitor] Skip stale CWL warEnded notify (day ${meta.cwlDay}, last=${stateRef.last?.state || 'none'}, is_cwl=${stateRef.last?.is_cwl ? 1 : 0})`
      );
      await recordFinishedWar(war, { isCwl: true });
      await tgLog.debug(
        'Skipped stale CWL warEnded notify',
        {
          day: meta.cwlDay,
          lastState: stateRef.last?.state || 'none',
          lastIsCwl: Boolean(stateRef.last?.is_cwl),
        },
        { module: 'WarMonitor' }
      );
    }
  }

  try {
    const leagueEndAllowed =
      !config.telegramGroupId ||
      (await isNotifyEnabled(config.telegramGroupId, 'cwl', 'war_ended'));
    if (leagueEndAllowed) {
      await notifyCwlLeagueEnded(bot, found, {
        claimNotification,
        releaseNotification,
        sendToGroup,
      });
    }
  } catch (err) {
    console.warn('[WarMonitor] notifyCwlLeagueEnded error:', err.message);
    await tgLog.warn('notifyCwlLeagueEnded error', err.message, {
      module: 'WarMonitor',
    });
  }

  await persistSlotState(stateRef, {
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
  resetQueryCount();
  try {
    // Separate slots so CWL and regular war never overwrite each other.
    const cwlRef = { last: await getLastState(true) };
    const regularRef = { last: await getLastState(false) };

    const cwlWar = await checkCwl(bot, cwlRef);
    const war = await checkRegularWar(bot, regularRef);
    const active =
      cwlWar && cwlWar.state && cwlWar.state !== 'notInWar' ? cwlWar : war;
    lastActiveWar = active;

    const state = active?.state || 'unknown';
    const opp =
      active?.opponent?.name || active?.opponent?.tag || '-';
    const isCwl = Boolean(cwlWar && cwlWar.state && cwlWar.state !== 'notInWar');
    const dbQueries = resetQueryCount();

    markPollSuccess({
      state,
      opponent: String(opp).slice(0, 80),
      isCwl,
      cwlDay: cwlWar?.__cwlMeta?.cwlDay || null,
      cwlTotalDays: cwlWar?.__cwlMeta?.cwlTotalDays || null,
      dbQueries,
    });

    // Stats maintenance runs on its own timer (startStatsMaintenance).

    console.log(`[WarMonitor] Check done — state=${state} opponent=${opp}`);
    await tgLog.debug(
      `War poll OK — state=${state}`,
      { opponent: String(opp).slice(0, 80), cwl: isCwl, dbQueries },
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

    const now = Date.now();
    if (now - lastMetricsLogAt >= METRICS_LOG_EVERY_MS) {
      lastMetricsLogAt = now;
      const mon = getMonitorStats();
      console.log(
        `[WarMonitor] metrics dbQueries(lastPoll)=${dbQueries} saveWrites=${mon.saveStateWrites} saveSkips=${mon.saveStateSkips} polls=${mon.pollCount}`
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
  startStatsMaintenance(bot);
}

function stopWarMonitor() {
  monitorStopped = true;
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = null;
  stopStatsMaintenance();
}

module.exports = {
  startWarMonitor,
  stopWarMonitor,
  checkWarStatus,
};
