const { getCapitalRaidSeasons } = require('../api/clash');
const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');
const {
  notifyRaidStart,
  notifyRaidEnded,
  notifyRaidReminder,
} = require('./capitalNotify');

let monitorTimer = null;
let monitorStopped = false;
let lastState = null;

function pickLatestSeason(data) {
  const items = data?.items || data || [];
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[0];
}

function nextIntervalMs(season) {
  const ongoing = config.capitalPollOngoingMs || 15 * 60 * 1000;
  const idle = config.capitalPollIdleMs || 45 * 60 * 1000;
  if (season && season.state === 'ongoing') return ongoing;
  return idle;
}

async function checkCapitalStatus(bot) {
  try {
    const data = await getCapitalRaidSeasons(config.clanTag, 2);
    const season = pickLatestSeason(data);

    if (!season) {
      lastState = null;
      console.log('[CapitalMonitor] No raid seasons');
      return { season: null, intervalMs: nextIntervalMs(null) };
    }

    if (season.state === 'ongoing') {
      await notifyRaidStart(bot, season);
      await notifyRaidReminder(bot, season);
    } else if (season.state === 'ended') {
      await notifyRaidEnded(bot, season);
    }

    if (season.state !== lastState) {
      lastState = season.state;
      await tgLog.info(
        `Capital raid state → ${season.state}`,
        {
          loot: season.capitalTotalLoot,
          raids: season.raidsCompleted,
        },
        { module: 'CapitalMonitor' }
      );
    }

    console.log(
      `[CapitalMonitor] state=${season.state} loot=${season.capitalTotalLoot ?? 0}`
    );
    return { season, intervalMs: nextIntervalMs(season) };
  } catch (err) {
    console.error('[CapitalMonitor] Check failed:', err.message);
    await tgLog.warn('Capital check failed', err.message, {
      module: 'CapitalMonitor',
    });
    return {
      season: null,
      intervalMs: config.capitalPollIdleMs || 45 * 60 * 1000,
    };
  }
}

function scheduleNext(bot, ms) {
  if (monitorStopped) return;
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = setTimeout(async () => {
    const result = await checkCapitalStatus(bot);
    const next = result?.intervalMs || 45 * 60 * 1000;
    scheduleNext(bot, next);
  }, ms);
}

function startCapitalMonitor(bot) {
  monitorStopped = false;
  console.log('[CapitalMonitor] Starting capital raid monitor...');
  // Slight delay after war monitor
  scheduleNext(bot, 12000);
}

function stopCapitalMonitor() {
  monitorStopped = true;
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = null;
}

module.exports = {
  startCapitalMonitor,
  stopCapitalMonitor,
  checkCapitalStatus,
};
