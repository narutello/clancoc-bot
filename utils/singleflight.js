/**
 * درخواست‌های هم‌زمان با کلید یکسان را به یک Promise مشترک تبدیل می‌کند.
 */
const inflight = new Map();

async function singleflight(key, fn) {
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

module.exports = { singleflight };
