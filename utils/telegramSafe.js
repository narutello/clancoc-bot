/**
 * ارسال امن به تلگرام با رعایت 429 و backoff
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableTelegramError(err) {
  const code = err?.response?.error_code || err?.code || err?.status;
  const desc = String(err?.description || err?.message || '');
  if (code === 429) return true;
  if (code === 408 || code === 502 || code === 503 || code === 504) return true;
  if (/ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up/i.test(desc)) return true;
  return false;
}

function getRetryAfterMs(err, attempt) {
  const retryAfter =
    err?.parameters?.retry_after ??
    err?.response?.parameters?.retry_after ??
    err?.retry_after;
  if (retryAfter != null && Number(retryAfter) > 0) {
    return Number(retryAfter) * 1000;
  }
  return Math.min(1000 * Math.pow(2, attempt - 1), 15000);
}

async function withTelegramRetry(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 3;
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableTelegramError(err) || attempt === maxRetries) {
        throw err;
      }
      const wait = getRetryAfterMs(err, attempt);
      console.warn(
        `[TGSafe] retry ${attempt}/${maxRetries} after ${wait}ms: ${err.message || err.description || err}`
      );
      await sleep(wait);
    }
  }
  throw lastError;
}

module.exports = {
  withTelegramRetry,
  isRetryableTelegramError,
  getRetryAfterMs,
  sleep,
};
