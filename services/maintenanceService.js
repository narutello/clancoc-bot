const { readState, writeState } = require('./maintenanceStore');
const { stopWarMonitor, startWarMonitor } = require('./warMonitor');
const {
  stopCapitalMonitor,
  startCapitalMonitor,
} = require('./capitalMonitor');
const { tgLog } = require('../utils/telegramLogger');

/** @type {import('telegraf').Telegraf | null} */
let botRef = null;
/** @type {NodeJS.Timeout | null} */
let autoOffTimer = null;

/** @type {Map<number, { step: 'reason' | 'endsAt', reason: string | null }>} */
const pending = new Map();

function setBot(bot) {
  botRef = bot;
}

function getState() {
  return readState();
}

function isEnabled() {
  return Boolean(readState().enabled);
}

function clearAutoOffTimer() {
  if (autoOffTimer) {
    clearTimeout(autoOffTimer);
    autoOffTimer = null;
  }
}

function scheduleAutoOff() {
  clearAutoOffTimer();
  const state = readState();
  if (!state.enabled || !state.endsAt) return;

  const ends = new Date(state.endsAt).getTime();
  if (!Number.isFinite(ends)) return;

  const delay = ends - Date.now();
  if (delay <= 0) {
    disable({ silent: false, source: 'auto' }).catch((err) => {
      console.warn('[Maintenance] auto-off failed:', err.message);
    });
    return;
  }

  // setTimeout max ~24.8 days; clamp for safety
  const maxDelay = 2147483647;
  autoOffTimer = setTimeout(() => {
    disable({ silent: false, source: 'auto' }).catch((err) => {
      console.warn('[Maintenance] auto-off failed:', err.message);
    });
  }, Math.min(delay, maxDelay));
}

function stopAllMonitors() {
  try {
    stopWarMonitor();
  } catch (err) {
    console.warn('[Maintenance] stopWarMonitor:', err.message);
  }
  try {
    stopCapitalMonitor();
  } catch (err) {
    console.warn('[Maintenance] stopCapitalMonitor:', err.message);
  }
}

function startAllMonitors() {
  if (!botRef) return;
  try {
    startWarMonitor(botRef);
  } catch (err) {
    console.warn('[Maintenance] startWarMonitor:', err.message);
  }
  try {
    startCapitalMonitor(botRef);
  } catch (err) {
    console.warn('[Maintenance] startCapitalMonitor:', err.message);
  }
}

async function enable({ reason = null, endsAt = null, updatedBy = null } = {}) {
  const next = writeState({
    enabled: true,
    reason: reason || null,
    endsAt: endsAt || null,
    updatedAt: new Date().toISOString(),
    updatedBy,
  });

  stopAllMonitors();
  scheduleAutoOff();

  try {
    await tgLog.warn(
      'Maintenance mode ON',
      {
        reason: next.reason || '(none)',
        endsAt: next.endsAt || '(none)',
        by: updatedBy,
      },
      { module: 'Maintenance' }
    );
  } catch (_) {}

  return next;
}

async function disable({ silent = false, source = 'manual', updatedBy = null } = {}) {
  clearAutoOffTimer();
  const next = writeState({
    enabled: false,
    reason: null,
    endsAt: null,
    updatedAt: new Date().toISOString(),
    updatedBy,
  });

  startAllMonitors();

  if (!silent) {
    try {
      await tgLog.info(
        `Maintenance mode OFF (${source})`,
        { by: updatedBy },
        { module: 'Maintenance' }
      );
    } catch (_) {}
  }

  return next;
}

function initFromDisk() {
  const state = readState();
  if (state.enabled) {
    stopAllMonitors();
    scheduleAutoOff();
  }
  return state;
}

function setPending(userId, data) {
  pending.set(Number(userId), data);
}

function getPending(userId) {
  return pending.get(Number(userId)) || null;
}

function clearPending(userId) {
  pending.delete(Number(userId));
}

/**
 * Parse relative durations like 30m, 2h, 1d or absolute ISO-ish datetime.
 * Returns ISO string or null.
 */
function parseEndsAt(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;

  const rel = /^(\d+)\s*([mhd])$/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = rel[2].toLowerCase();
    const mult =
      unit === 'm' ? 60 * 1000 : unit === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return new Date(Date.now() + n * mult).toISOString();
  }

  // YYYY-MM-DD HH:mm or YYYY-MM-DDTHH:mm
  const normalized = s.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= Date.now()) return null;
  return d.toISOString();
}

function formatEndsAt(iso, lang = 'fa') {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

module.exports = {
  setBot,
  getState,
  isEnabled,
  enable,
  disable,
  initFromDisk,
  scheduleAutoOff,
  setPending,
  getPending,
  clearPending,
  parseEndsAt,
  formatEndsAt,
};
