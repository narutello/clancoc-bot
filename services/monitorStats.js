/**
 * In-memory monitor stats shared by warMonitor and HTTP health.
 * Not persisted — resets on process restart.
 */

const startedAt = Date.now();

const stats = {
  startedAt,
  lastPollAt: null,
  lastPollOk: null,
  lastPollError: null,
  lastState: null,
  lastOpponent: null,
  isCwl: false,
  cwlDay: null,
  cwlTotalDays: null,
  nextPollMs: null,
  nextPollAt: null,
  pollCount: 0,
  errorCount: 0,
  adaptiveReason: 'boot',
};

function markPollStart() {
  stats.pollCount += 1;
}

function markPollSuccess(snapshot = {}) {
  stats.lastPollAt = Date.now();
  stats.lastPollOk = true;
  stats.lastPollError = null;
  if (snapshot.state != null) stats.lastState = snapshot.state;
  if (snapshot.opponent != null) stats.lastOpponent = snapshot.opponent;
  if (snapshot.isCwl != null) stats.isCwl = Boolean(snapshot.isCwl);
  if (snapshot.cwlDay != null) stats.cwlDay = snapshot.cwlDay;
  if (snapshot.cwlTotalDays != null) stats.cwlTotalDays = snapshot.cwlTotalDays;
}

function markPollError(err) {
  stats.lastPollAt = Date.now();
  stats.lastPollOk = false;
  stats.lastPollError = err ? String(err.message || err).slice(0, 300) : 'unknown';
  stats.errorCount += 1;
}

function markNextPoll(ms, reason) {
  const n = Math.max(5000, Number(ms) || 60000);
  stats.nextPollMs = n;
  stats.nextPollAt = Date.now() + n;
  stats.adaptiveReason = reason || 'default';
}

function getMonitorStats() {
  return { ...stats };
}

module.exports = {
  markPollStart,
  markPollSuccess,
  markPollError,
  markNextPoll,
  getMonitorStats,
};
