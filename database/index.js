const { Pool } = require('pg');
const config = require('../config');

/**
 * Neon (and many serverless Postgres hosts) drop idle TCP connections.
 * Keep the pool small, recycle idle clients early, enable TCP keep-alive,
 * and retry once/twice on transient connection errors.
 */
const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
  allowExitOnIdle: true,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
  // Idle clients can die when Neon closes the connection; pool will replace them.
  console.error('[DB] Unexpected error on idle client:', err.message);
});

function isRetryableDbError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '').toLowerCase();
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === '57P01' || // admin_shutdown
    code === '57P03' || // cannot_connect_now
    code === '08006' || // connection_failure
    code === '08001' || // sqlclient_unable_to_establish_sqlconnection
    code === '08003' || // connection_does_not_exist
    msg.includes('connection terminated') ||
    msg.includes('connection timeout') ||
    msg.includes('timeout expired') ||
    msg.includes('server closed the connection') ||
    msg.includes('cannot connect') ||
    msg.includes('connection terminated unexpectedly')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function query(text, params = [], attempt = 1) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 80));
    }
    return res;
  } catch (err) {
    if (attempt < 3 && isRetryableDbError(err)) {
      console.warn(
        `[DB] Retryable error (attempt ${attempt}/3): ${err.message}`
      );
      await sleep(250 * attempt);
      return query(text, params, attempt + 1);
    }
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}

async function getClient() {
  return pool.connect();
}

module.exports = {
  pool,
  query,
  getClient,
  isRetryableDbError,
};
