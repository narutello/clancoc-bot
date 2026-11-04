require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  botToken: requireEnv('BOT_TOKEN'),
  databaseUrl: requireEnv('DATABASE_URL'),
  clashApiToken: requireEnv('CLASH_API_TOKEN'),
  clashApiBaseUrl: process.env.CLASH_API_BASE_URL || 'https://cocproxy.royaleapi.dev/v1',
  ownerTelegramId: Number(requireEnv('OWNER_TELEGRAM_ID')),
  telegramGroupId: process.env.TELEGRAM_GROUP_ID ? process.env.TELEGRAM_GROUP_ID.trim() : null,
  clanTag: (process.env.CLAN_TAG || '').replace(/^#/, '').toUpperCase(),
  warPollIntervalMs: intEnv('WAR_POLL_INTERVAL_MS', 120000),
  logTelegramId: process.env.LOG_TELEGRAM_ID
    ? process.env.LOG_TELEGRAM_ID.trim().replace(/^["']|["']$/g, '')
    : null,

  warCmdLimit: intEnv('WAR_CMD_LIMIT', 5),
  warCmdWindowMs: intEnv('WAR_CMD_WINDOW_MS', 60000),
  clanCmdLimit: intEnv('CLAN_CMD_LIMIT', 8),
  clanCmdWindowMs: intEnv('CLAN_CMD_WINDOW_MS', 60000),

  warCacheTtlMs: intEnv('WAR_CACHE_TTL_MS', 8000),

  clashMaxRetries: intEnv('CLASH_MAX_RETRIES', 3),
  clashApiTimeoutMs: intEnv('CLASH_API_TIMEOUT_MS', 15000),
  telegramMaxRetries: intEnv('TELEGRAM_MAX_RETRIES', 3),
};

if (!config.clanTag) {
  throw new Error('Missing required environment variable: CLAN_TAG');
}

if (Number.isNaN(config.ownerTelegramId)) {
  throw new Error('OWNER_TELEGRAM_ID must be a valid number');
}

module.exports = config;
