const http = require('http');
const config = require('./config');
const { createBot } = require('./bot');
const { migrate } = require('./database/migrate');
const { startWarMonitor } = require('./services/warMonitor');
const { pool } = require('./database');

async function main() {
  console.log('========================================');
  console.log('  ClanCoC Bot - Clash of Clans War Manager');
  console.log('========================================');

  // Run migrations
  try {
    await migrate();
  } catch (err) {
    console.error('Failed to migrate database:', err.message);
    process.exit(1);
  }

  // Quick connectivity checks
  try {
    await pool.query('SELECT 1');
    console.log('[OK] Database connected');
  } catch (err) {
    console.error('[FAIL] Database connection:', err.message);
    process.exit(1);
  }

  // Health-check server for Inject Cloud / hosting platforms
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ClanCoC Bot is running');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[OK] Health server listening on port ${port}`);
  });

  const bot = createBot();

  // Launch bot
  bot
    .launch()
    .then(() => {
      console.log('[OK] Telegram bot started');
      console.log(`[INFO] Owner ID: ${config.ownerTelegramId}`);
      console.log(`[INFO] Clan Tag: #${config.clanTag}`);
      console.log(`[INFO] Group ID: ${config.telegramGroupId || 'not set'}`);
      console.log(`[INFO] API Base: ${config.clashApiBaseUrl}`);

      // Start war monitoring
      startWarMonitor(bot);
    })
    .catch((err) => {
      console.error('[FAIL] Bot launch failed:', err.message);
      process.exit(1);
    });

  // Graceful shutdown
  const stop = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
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
