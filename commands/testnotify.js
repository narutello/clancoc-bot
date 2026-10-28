const config = require('../config');

module.exports = async function testNotifyCommand(ctx) {
  const fromId = ctx.from?.id;
  if (!fromId || String(fromId) !== String(config.ownerTelegramId)) {
    return ctx.reply('⛔ این دستور فقط برای اونر ربات است.');
  }

  if (!config.telegramGroupId) {
    return ctx.reply(
      '❌ متغیر TELEGRAM_GROUP_ID تنظیم نشده است.\nاول آیدی گروه را در Environment Variables ست کنید.'
    );
  }

  const html = `
    <h2>✅ تست نوتیفیکیشن</h2>
    <p>اگر این پیام را در گروه می‌بینید، اتصال ربات به گروه درست است.</p>
    <table bordered striped compact>
      <tr>
        <th>مورد</th>
        <th>مقدار</th>
      </tr>
      <tr>
        <td>Group ID</td>
        <td><code>${config.telegramGroupId}</code></td>
      </tr>
      <tr>
        <td>Owner</td>
        <td><code>${config.ownerTelegramId}</code></td>
      </tr>
      <tr>
        <td>Clan</td>
        <td><code>#${config.clanTag}</code></td>
      </tr>
    </table>
    <p>🤖 ClanCoC Bot — Test OK</p>
  `.trim();

  try {
    await ctx.telegram.callApi('sendRichMessage', {
      chat_id: config.telegramGroupId,
      rich_message: {
        html,
        is_rtl: true,
      },
    });
    return ctx.reply(
      `✅ پیام تست به گروه ارسال شد.\nGroup ID: <code>${config.telegramGroupId}</code>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[/testnotify]', err.message);
    try {
      await ctx.telegram.sendMessage(
        config.telegramGroupId,
        '✅ تست نوتیفیکیشن\nاگر این پیام را می‌بینید، اتصال ربات به گروه درست است.\n🤖 ClanCoC Bot — Test OK'
      );
      return ctx.reply(
        `✅ پیام تست (ساده) به گروه ارسال شد.\nGroup ID: <code>${config.telegramGroupId}</code>`,
        { parse_mode: 'HTML' }
      );
    } catch (err2) {
      return ctx.reply(
        `❌ ارسال به گروه ناموفق بود:\n<code>${err2.message}</code>\n\n` +
          `بررسی کنید:\n` +
          `• TELEGRAM_GROUP_ID درست باشد\n` +
          `• ربات داخل گروه باشد\n` +
          `• ربات اجازه ارسال پیام داشته باشد`,
        { parse_mode: 'HTML' }
      );
    }
  }
};
