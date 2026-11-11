const http = require('http');
const config = require('./config');
const { createBot } = require('./bot');
const { migrate } = require('./database/migrate');
const { startWarMonitor, stopWarMonitor } = require('./services/warMonitor');
const { pool } = require('./database');
const { tgLog } = require('./utils/telegramLogger');
const { getMonitorStats } = require('./services/monitorStats');
const { initI18n } = require('./utils/i18n');

const bootAt = Date.now();
let botReady = false;

async function checkDb() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: String(err.message || err).slice(0, 200),
    };
  }
}

async function buildHealthPayload() {
  const mon = getMonitorStats();
  const db = await checkDb();
  const uptimeSec = Math.floor((Date.now() - bootAt) / 1000);

  const ok = db.ok && botReady;

  return {
    ok,
    service: 'clancoc-bot',
    time: new Date().toISOString(),
    uptimeSec,
    botReady,
    database: db,
    monitor: {
      lastPollAt: mon.lastPollAt
        ? new Date(mon.lastPollAt).toISOString()
        : null,
      lastPollOk: mon.lastPollOk,
      lastPollError: mon.lastPollError,
      lastState: mon.lastState,
      lastOpponent: mon.lastOpponent,
      isCwl: mon.isCwl,
      cwlDay: mon.cwlDay,
      cwlTotalDays: mon.cwlTotalDays,
      nextPollMs: mon.nextPollMs,
      nextPollAt: mon.nextPollAt
        ? new Date(mon.nextPollAt).toISOString()
        : null,
      adaptiveReason: mon.adaptiveReason,
      pollCount: mon.pollCount,
      errorCount: mon.errorCount,
    },
    config: {
      clanTag: config.clanTag ? `#${config.clanTag}` : null,
      hasGroup: Boolean(config.telegramGroupId),
      hasLogChannel: Boolean(config.logTelegramId),
      pollIdleMs: config.warPollIdleMs,
      pollActiveMs: config.warPollActiveMs,
      pollNearMs: config.warPollNearMs,
    },
  };
}

function startHealthServer(port) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = (req.url || '/').split('?')[0];
      if (req.method === 'GET' && (url === '/' || url === '/health')) {
        const body = await buildHealthPayload();
        const code = body.ok ? 200 : 503;
        res.writeHead(code, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(body, null, 2));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ClanCoC Bot is running');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({ ok: false, error: String(err.message || err) })
      );
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[OK] Health server listening on port ${port}`);
  });

  return server;
}

async function main() {
  console.log('========================================');
  console.log('  ClanCoC Bot - Clash of Clans War Manager');
  console.log('========================================');
  console.log(`[INFO] LOG_TELEGRAM_ID=${config.logTelegramId || '(not set)'}`);
  console.log(`[INFO] TELEGRAM_GROUP_ID=${config.telegramGroupId || '(not set)'}`);

  try {
    await initI18n();
    console.log('[OK] i18n ready (fa, en)');
  } catch (err) {
    console.error('[FAIL] i18n init:', err.message);
    process.exit(1);
  }

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

  const port = process.env.PORT || process.env.SERVER_PORT || 3000;
  const server = startHealthServer(port);

  const bot = createBot();
  tgLog.setBot(bot);

  bot
    .launch()
    .then(() => {
      botReady = true;
      console.log('[OK] Telegram bot started (launch resolved)');
    })
    .catch((err) => {
      console.error('[FAIL] Bot launch failed:', err.message);
      process.exit(1);
    });

  console.log('[OK] Bot launch initiated');
  await tgLog.info(
    'Bot launch initiated',
    {
      clan: config.clanTag,
      group: config.telegramGroupId,
      pollIdleMs: config.warPollIdleMs,
      pollActiveMs: config.warPollActiveMs,
      pollNearMs: config.warPollNearMs,
    },
    { module: 'Boot' }
  );
  console.log(`[INFO] Owner ID: ${config.ownerTelegramId}`);
  console.log(`[INFO] Clan Tag: #${config.clanTag}`);
  console.log(`[INFO] Group ID: ${config.telegramGroupId || 'not set'}`);
  console.log(`[INFO] Log channel: ${config.logTelegramId || 'not set'}`);
  console.log(`[INFO] API Base: ${config.clashApiBaseUrl}`);
  console.log(
    `[INFO] Adaptive poll idle=${config.warPollIdleMs} active=${config.warPollActiveMs} near=${config.warPollNearMs}`
  );

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
      console.log('[OK] War monitor started (adaptive)');
    } catch (e) {
      console.error('[FAIL] War monitor start:', e.message);
    }
  }, 4000);

  const stop = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    try {
      stopWarMonitor();
    } catch (_) {}
    try {
      await tgLog.warn(`Shutting down (${signal})`, null, { module: 'Boot' });
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
