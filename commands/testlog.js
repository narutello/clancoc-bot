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
      '✅ Log channel test\nIf you see this, LOG_TELEGRAM_ID is correct.\n🤖 ClanCoC Bot — Log Test OK',
      { disable_web_page_preview: true }
    );

    await tgLog.info(
      'Manual log channel test OK',
      { from: ctx.from?.id },
      { module: 'TestLog' }
    );

    return ctx.reply(
      `✅ پیام تست به کانال لاگ ارسال شد.\nLog ID: <code>${config.logTelegramId}</code>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[/testlog]', err.message);
    await tgLog.error('Manual log test failed', err.message, { module: 'TestLog' });
    return ctx.reply(`❌ خطا در ارسال به کانال لاگ:\n${err.message}`);
  }
};
