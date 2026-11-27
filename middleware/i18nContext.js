const { t, isRtl } = require('../utils/i18n');
const { resolveLangForCtx } = require('../services/settingsService');
const { isEnabled } = require('../services/maintenanceService');

/**
 * Attaches ctx.lang, ctx.t, ctx.isRtl for the current update.
 * Language is resolved per chat/user — never a process-global mutable lng.
 * During maintenance, skip DB so a slow/down database cannot block replies.
 */
module.exports = async function i18nContext(ctx, next) {
  let lang = 'fa';
  try {
    if (!isEnabled()) {
      lang = await resolveLangForCtx(ctx);
    }
  } catch (err) {
    console.warn('[i18n] resolveLangForCtx failed:', err.message);
  }

  ctx.lang = lang;
  ctx.isRtl = isRtl(lang);
  ctx.t = (key, params = {}) => t(key, { lng: lang, ...params });

  return next();
};
