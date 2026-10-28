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

  bot
    .launch()
    .then(async () => {
      console.log('[OK] Telegram bot started');
      console.log(`[INFO] Owner ID: ${config.ownerTelegramId}`);
      console.log(`[INFO] Clan Tag: #${config.clanTag}`);
      console.log(`[INFO] Group ID: ${config.telegramGroupId || 'not set'}`);
      console.log(`[INFO] Log channel: ${config.logTelegramId || 'not set'}`);
      console.log(`[INFO] API Base: ${config.clashApiBaseUrl}`);

      await tgLog.info('ربات آنلاین شد', {
        clan: `#${config.clanTag}`,
        group: config.telegramGroupId || null,
        pollMs: config.warPollIntervalMs,
      });

      startWarMonitor(bot);
    })
    .catch(async (err) => {
      console.error('[FAIL] Bot launch failed:', err.message);
      try {
        await tgLog.error('Bot launch failed', err.message);
      } catch (_) {}
      process.exit(1);
    });

  const stop = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    try {
      await tgLog.warn(`Shutting down (${signal})`);
    } catch (_) {}
    bot.stop(signal);
    server.close();
    await pool.end();
    process.exit(0);
  };

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
