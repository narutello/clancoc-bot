require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

const config = {
  botToken: requireEnv('BOT_TOKEN'),
  databaseUrl: requireEnv('DATABASE_URL'),
  clashApiToken: requireEnv('CLASH_API_TOKEN'),
  clashApiBaseUrl: process.env.CLASH_API_BASE_URL || 'https://cocproxy.royaleapi.dev/v1',
  ownerTelegramId: Number(requireEnv('OWNER_TELEGRAM_ID')),
  telegramGroupId: process.env.TELEGRAM_GROUP_ID ? process.env.TELEGRAM_GROUP_ID.trim() : null,
  clanTag: (process.env.CLAN_TAG || '').replace(/^#/, '').toUpperCase(),
  warPollIntervalMs: Number(process.env.WAR_POLL_INTERVAL_MS) || 120000,
};

if (!config.clanTag) {
  throw new Error('Missing required environment variable: CLAN_TAG');
}

if (Number.isNaN(config.ownerTelegramId)) {
  throw new Error('OWNER_TELEGRAM_ID must be a valid number');
}

module.exports = config;
