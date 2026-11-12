try {
  require('dotenv').config();
} catch (_) {
  // optional dependency path; process.env from host is still used
}

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') {
    const related = Object.keys(process.env)
      .filter((k) => {
        const u = k.toUpperCase();
        return (
          u === name ||
          u.includes('BOT') ||
          u.includes('TOKEN') ||
          u.includes('DATABASE') ||
          u.includes('CLAN')
        );
      })
      .sort()
      .join(', ');
    throw new Error(
      `Missing required environment variable: ${name}` +
        (related
          ? ` | env keys visible to process: ${related}`
          : ' | process.env has no BOT/TOKEN/DATABASE/CLAN keys (host is not injecting env)')
    );
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
  clashApiBaseUrl:
    process.env.CLASH_API_BASE_URL || 'https://cocproxy.royaleapi.dev/v1',
  ownerTelegramId: Number(requireEnv('OWNER_TELEGRAM_ID')),
  telegramGroupId: process.env.TELEGRAM_GROUP_ID
    ? process.env.TELEGRAM_GROUP_ID.trim()
    : null,
  clanTag: (process.env.CLAN_TAG || '').replace(/^#/, '').toUpperCase(),

  warPollIntervalMs: intEnv('WAR_POLL_INTERVAL_MS', 120000),

  warPollIdleMs: intEnv('WAR_POLL_IDLE_MS', 300000),
  warPollActiveMs: intEnv('WAR_POLL_ACTIVE_MS', 0),
  warPollNearMs: intEnv('WAR_POLL_NEAR_MS', 30000),
  warPollMinMs: intEnv('WAR_POLL_MIN_MS', 20000),

  logTelegramId: process.env.LOG_TELEGRAM_ID
    ? process.env.LOG_TELEGRAM_ID.trim().replace(/^["']|["']$/g, '')
    : null,

  warCmdLimit: intEnv('WAR_CMD_LIMIT', 5),
  warCmdWindowMs: intEnv('WAR_CMD_WINDOW_MS', 60000),
  clanCmdLimit: intEnv('CLAN_CMD_LIMIT', 8),
  clanCmdWindowMs: intEnv('CLAN_CMD_WINDOW_MS', 60000),
  cwlCmdLimit: intEnv('CWL_CMD_LIMIT', 5),
  cwlCmdWindowMs: intEnv('CWL_CMD_WINDOW_MS', 60000),

  warCacheTtlMs: intEnv('WAR_CACHE_TTL_MS', 8000),

  cwlStandingsCacheTtlMs: intEnv('CWL_STANDINGS_CACHE_TTL_MS', 600000),
  cwlStandingsConcurrency: intEnv('CWL_STANDINGS_CONCURRENCY', 3),

  clashMaxRetries: intEnv('CLASH_MAX_RETRIES', 3),
  clashApiTimeoutMs: intEnv('CLASH_API_TIMEOUT_MS', 15000),
  telegramMaxRetries: intEnv('TELEGRAM_MAX_RETRIES', 3),

  statsRetentionMonths: intEnv('STATS_RETENTION_MONTHS', 6),
};

if (!config.clanTag) {
  throw new Error('Missing required environment variable: CLAN_TAG');
}

if (Number.isNaN(config.ownerTelegramId)) {
  throw new Error('OWNER_TELEGRAM_ID must be a valid number');
}

if (!config.warPollActiveMs) {
  config.warPollActiveMs = config.warPollIntervalMs;
}

module.exports = config;
