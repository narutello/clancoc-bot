/** In-memory pending link verifications (TTL). Not shared across processes. */

const TTL_MS = 10 * 60 * 1000;
const pending = new Map();

function setPending(telegramId, data) {
  pending.set(Number(telegramId), {
    ...data,
    expiresAt: Date.now() + TTL_MS,
  });
}

function getPending(telegramId) {
  const id = Number(telegramId);
  const row = pending.get(id);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    pending.delete(id);
    return null;
  }
  return row;
}

function clearPending(telegramId) {
  pending.delete(Number(telegramId));
}

function sweepExpired() {
  const now = Date.now();
  for (const [id, row] of pending.entries()) {
    if (now > row.expiresAt) pending.delete(id);
  }
}

setInterval(sweepExpired, 60 * 1000).unref?.();

module.exports = {
  setPending,
  getPending,
  clearPending,
  TTL_MS,
};
