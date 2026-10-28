const http = require('http');
const config = require('./config');
const { createBot } = require('./bot');
const { migrate } = require('./database/migrate');
const { startWarMonitor } = require('./services/warMonitor');
const { pool } = require('./database');
const { tgLog } = require('./utils/telegramLogger');

async function main() {
  console.log('========================================');
  console.log('  ClanCoC Bot - Clash of Clans War Manager');
  console.log('========================================');
  console.log(`[INFO] LOG_TELEGRAM_ID=${config.logTelegramId || '(not set)'}`);
  console.log(`[INFO] TELEGRAM_GROUP_ID=${config.telegramGroupId || '(not set)'}`);

  try {
    await migrate();
  } catch (err) {
    console.error('Failed to migrate database:', err.message);
    process.exit(1);
  }

  try {
    await pool.query('SELECT 1');
    console.log('[OK] Database connected');
  } catch (err) {
    console.error('[FAIL] Database connection:', err.message);
    process.exit(1);
  }

  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ClanCoC Bot is running');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[OK] Health server listening on port ${port}`);
  });

  const bot = createBot();
  tgLog.setBot(bot);

  // مهم: launch را await نکن — در بعضی محیط‌ها Promise تمام نمی‌شود
  bot
    .launch()
    .then(() => {
      console.log('[OK] Telegram bot started (launch resolved)');
    })
    .catch((err) => {
      console.error('[FAIL] Bot launch failed:', err.message);
      process.exit(1);
    });

  console.log('[OK] Bot launch initiated');
  console.log(`[INFO] Owner ID: ${config.ownerTelegramId}`);
  console.log(`[INFO] Clan Tag: #${config.clanTag}`);
  console.log(`[INFO] Group ID: ${config.telegramGroupId || 'not set'}`);
  console.log(`[INFO] Log channel: ${config.logTelegramId || 'not set'}`);
  console.log(`[INFO] API Base: ${config.clashApiBaseUrl}`);

  setTimeout(async () => {
    try {
      const ok = await tgLog.sendStartupBanner();
      if (!ok) {
        console.warn('[WARN] Startup log was not delivered');
      }
    } catch (e) {
      console.error('[WARN] Startup log error:', e.message);
    }
  }, 3000);

  setTimeout(() => {
    try {
      startWarMonitor(bot);
      console.log('[OK] War monitor started');
    } catch (e) {
      console.error('[FAIL] War monitor start:', e.message);
    }
  }, 4000);

  const stop = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    try {
      await tgLog.warn(`Shutting down (${signal})`);
    } catch (_) {}
    try {
      bot.stop(signal);
    } catch (_) {}
    server.close();
    try {
      await pool.end();
    } catch (_) {}
    process.exit(0);
  };

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
