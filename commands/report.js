const config = require('../config');
const {
  parseMonthArg,
  buildMonthlyReport,
  formatReportText,
} = require('../services/statsService');
const { formatReportHtml } = require('../services/reportFormat');
const { checkCommandLimit } = require('../utils/commandRateLimit');
const {
  sendLoading,
  deleteLoading,
  replaceLoadingText,
} = require('../utils/loading');
const { isRtl } = require('../utils/i18n');
const { withTelegramRetry } = require('../utils/telegramSafe');

module.exports = async function reportCommand(ctx) {
  let loadingMsg = null;
  const lang = ctx.lang || 'fa';
  const t = ctx.t.bind(ctx);

  try {
    const userId = ctx.from?.id;
    const isOwner =
      userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'report', {
      limit: config.clanCmdLimit,
      windowMs: config.clanCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.reply(t('rate.clan', { sec: limit.retryAfterSec }), {
        parse_mode: 'HTML',
      });
    }

    const arg = (ctx.message?.text || '').split(/\s+/).slice(1)[0];
    const monthKey = parseMonthArg(arg || null);
    if (!monthKey) {
      return ctx.reply(t('report.invalid_month'), { parse_mode: 'HTML' });
    }

    loadingMsg = await sendLoading(ctx, t('loading.report'));
    const report = await buildMonthlyReport(monthKey);
    const html = formatReportHtml(report, lang);

    await deleteLoading(ctx, loadingMsg);
    loadingMsg = null;

    try {
      return await withTelegramRetry(
        () =>
          ctx.telegram.callApi('sendRichMessage', {
            chat_id: ctx.chat.id,
            rich_message: {
              html,
              is_rtl: isRtl(lang),
            },
          }),
        { maxRetries: config.telegramMaxRetries }
      );
    } catch (richErr) {
      console.warn('[/report] rich message failed, fallback text:', richErr.message);
      const text = formatReportText(report, lang);
      return ctx.reply(text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }
  } catch (err) {
    console.error('[/report]', err.message);
    return replaceLoadingText(
      ctx,
      loadingMsg,
      t('report.error', { message: err.message })
    );
  }
};
