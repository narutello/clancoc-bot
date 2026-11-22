const axios = require('axios');
const config = require('../config');

const client = axios.create({
  baseURL: config.clashApiBaseUrl,
  timeout: config.clashApiTimeoutMs || 15000,
  headers: {
    Authorization: `Bearer ${config.clashApiToken}`,
    Accept: 'application/json',
  },
});

function encodeTag(tag) {
  const clean = String(tag).replace(/^#/, '').toUpperCase();
  return `%23${clean}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getRetryAfterMs(err, attempt) {
  const headers = err.response?.headers || {};
  const retryAfter =
    headers['retry-after'] ||
    headers['Retry-After'] ||
    err.response?.data?.retryAfter;
  if (retryAfter != null) {
    const n = Number(retryAfter);
    if (!Number.isNaN(n) && n >= 0) {
      return n > 1000 ? n : n * 1000;
    }
  }
  return Math.min(1000 * Math.pow(2, attempt - 1), 12000);
}

/**
 * True only when Supercell clearly signals API/game maintenance.
 * Generic 500 / unknownException alone is NOT treated as maintenance.
 */
function isMaintenanceResponse(status, message, reason) {
  const text = `${message || ''} ${reason || ''}`.toLowerCase();
  if (!text.trim()) return false;

  // Explicit maintenance wording from official API
  if (
    /\bin maintenance\b/.test(text) ||
    /\bunder maintenance\b/.test(text) ||
    /\bcurrently in maintenance\b/.test(text) ||
    /\bapi is currently in maintenance\b/.test(text)
  ) {
    return true;
  }

  // 503 + come back later is the known maintenance payload
  if (status === 503 && /come back later/.test(text)) {
    return true;
  }

  return false;
}

function isRetryableStatus(status, isMaintenance) {
  if (isMaintenance) return false;
  if (!status) return true;
  if (status === 429 || status === 408) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

function isPermanentStatus(status) {
  return status === 401 || status === 403 || status === 404 || status === 400;
}

function buildClashError(err) {
  const status = err.response?.status;
  const data = err.response?.data || {};
  const message = data.message || data.reason || err.message;
  const reason = data.reason || '';
  const maintenance = isMaintenanceResponse(status, message, reason);

  const error = new Error(
    maintenance
      ? 'Clash API maintenance'
      : `Clash API error ${status || ''}: ${message}`
  );
  error.status = status;
  error.isNotFound = status === 404;
  error.isRateLimited = status === 429;
  error.isAuthError = status === 401 || status === 403;
  error.isMaintenance = maintenance;
  error.apiMessage = message;
  return error;
}

async function request(path, retries = config.clashMaxRetries || 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await client.get(path);
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const data = err.response?.data || {};
      const message = data.message || data.reason || err.message;
      const maintenance = isMaintenanceResponse(status, message, data.reason);

      if (maintenance || isPermanentStatus(status)) {
        break;
      }

      if (!isRetryableStatus(status, maintenance) || attempt === retries) {
        break;
      }

      const delay = getRetryAfterMs(err, attempt);
      console.warn(
        `[API] Retry ${attempt}/${retries} for ${path} after ${delay}ms (${status || err.message})`
      );
      await sleep(delay);
    }
  }

  throw buildClashError(lastError);
}

async function getClan(tag = config.clanTag) {
  return request(`/clans/${encodeTag(tag)}`);
}

async function getCurrentWar(tag = config.clanTag) {
  return request(`/clans/${encodeTag(tag)}/currentwar`);
}

async function getCurrentWarLeagueGroup(tag = config.clanTag) {
  return request(`/clans/${encodeTag(tag)}/currentwar/leaguegroup`);
}

async function getCwlWar(warTag) {
  return request(`/clanwarleagues/wars/${encodeTag(warTag)}`);
}

async function getPlayer(tag) {
  return request(`/players/${encodeTag(tag)}`);
}

/** Clan Capital raid seasons (Raid Weekend history + current). */
async function getCapitalRaidSeasons(tag = config.clanTag, limit = 2) {
  const q = limit != null ? `?limit=${Number(limit) || 2}` : '';
  return request(`/clans/${encodeTag(tag)}/capitalraidseasons${q}`);
}

/**
 * Verify in-game player API token (short code from Settings → API Token).
 * Official endpoint: POST /players/{tag}/verifytoken
 * Body: { "token": "<player token>" }
 * Auth: developer Bearer token (same as other API calls).
 * Returns player profile on success. Never stores the player token.
 */
async function verifyPlayerWithToken(tag, playerToken) {
  const clean = String(tag).replace(/^#/, '').toUpperCase();
  const token = String(playerToken || '').trim();

  // In-game tokens are typically ~8 alphanumeric chars (one-time use)
  if (!token || token.length < 4 || token.length > 64) {
    const err = new Error('Invalid player API token');
    err.isAuthError = true;
    throw err;
  }

  const path = `/players/${encodeTag(clean)}/verifytoken`;

  try {
    const res = await client.post(
      path,
      { token },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );
    const status = String(res.data?.status || '').toLowerCase();
    if (status !== 'ok') {
      const err = new Error('Player token invalid or expired');
      err.isAuthError = true;
      throw err;
    }
  } catch (err) {
    if (err.isAuthError) throw err;
    if (err.isMaintenance) throw err;
    throw buildClashError(err);
  }

  // Token valid — load profile for confirmation UI (bot developer token)
  return getPlayer(clean);
}

module.exports = {
  getClan,
  getCurrentWar,
  getCurrentWarLeagueGroup,
  getCwlWar,
  getPlayer,
  getCapitalRaidSeasons,
  verifyPlayerWithToken,
  encodeTag,
  isMaintenanceResponse,
};
