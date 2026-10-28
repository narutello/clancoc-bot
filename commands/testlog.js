const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');

module.exports = async function testLogCommand(ctx) {
  const fromId = ctx.from?.id;
  if (!fromId || String(fromId) !== String(config.ownerTelegramId)) {
    return ctx.reply('⛔ این دستور فقط برای اونر ربات است.');
  }

  if (!config.logTelegramId) {
    return ctx.reply(
      '❌ متغیر LOG_TELEGRAM_ID تنظیم نشده است.\nآن را در Environment Variables ست کنید و Redeploy کنید.'
    );
  }

  try {
    await ctx.telegram.sendMessage(
      config.logTelegramId,
      '✅ تست کانال لاگ\nاگر این پیام را می‌بینید، LOG_TELEGRAM_ID درست است.\n🤖 ClanCoC Bot — Log Test OK',
      { disable_web_page_preview: true }
    );

    await tgLog.info('تست دستی کانال لاگ موفق بود');

    return ctx.reply(
      `✅ پیام تست به کانال لاگ ارسال شد.\nLog ID: <code>${config.logTelegramId}</code>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[/testlog]', err.message);
    return ctx.reply(
      `❌ ارسال به کانال لاگ ناموفق بود:\n<code>${err.message}</code>\n\n` +
        `بررسی کنید:\n` +
        `• LOG_TELEGRAM_ID درست باشد (معمولاً با -100)\n` +
        `• ربات ادمین کانال باشد\n` +
        `• اجازه Post Messages داشته باشد`,
      { parse_mode: 'HTML' }
    );
  }
};
