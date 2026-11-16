/**
 * Map Clash API errors to a user-facing localized string.
 * Only true maintenance (err.isMaintenance) gets the maintenance copy.
 */
function clashUserMessage(err, t, fallbackKey = 'common.generic_error') {
  if (err && err.isMaintenance) {
    return t('api.maintenance');
  }
  if (err && err.isRateLimited) {
    return t('api.rate_limited');
  }
  if (fallbackKey === 'war.fetch_error' || fallbackKey === 'clan.fetch_error') {
    return t(fallbackKey, { message: err?.message || 'unknown' });
  }
  return t(fallbackKey, { message: err?.message || 'unknown' });
}

module.exports = { clashUserMessage };
