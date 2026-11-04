/**
 * محدودیت دستورات به‌ازای هر کاربر (حافظه داخلی، بدون Redis)
 * Owner از محدودیت دستورات معاف است.
 */

const hits = new Map(); // key -> number[] timestamps

function prune(timestamps, windowMs, now) {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) i += 1;
  if (i > 0) timestamps.splice(0, i);
  return timestamps;
}

/**
 * @returns {{ allowed: boolean, remaining: number, retryAfterSec: number }}
 */
function checkCommandLimit(userId, command, { limit, windowMs, isOwner }) {
  if (isOwner) {
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }

  const key = `${command}:${userId}`;
  const now = Date.now();
  let list = hits.get(key) || [];
  list = prune(list, windowMs, now);

  if (list.length >= limit) {
    const oldest = list[0];
    const retryAfterMs = Math.max(0, windowMs - (now - oldest));
    hits.set(key, list);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
    };
  }

  list.push(now);
  hits.set(key, list);
  return {
    allowed: true,
    remaining: Math.max(0, limit - list.length),
    retryAfterSec: 0,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, list] of hits.entries()) {
    const kept = list.filter((t) => now - t < 5 * 60 * 1000);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
  }
}, 5 * 60 * 1000).unref?.();

module.exports = { checkCommandLimit };
