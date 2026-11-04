/**
 * کش کوتاه‌مدت در حافظه
 */
const store = new Map();

function getCache(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function clearCache(key) {
  if (key) store.delete(key);
  else store.clear();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now > v.expiresAt) store.delete(k);
  }
}, 60 * 1000).unref?.();

module.exports = { getCache, setCache, clearCache };
