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

function isRetryableStatus(status) {
  if (!status) return true;
  if (status === 429 || status === 408) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

function isPermanentStatus(status) {
  return status === 401 || status === 403 || status === 404 || status === 400;
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

      if (isPermanentStatus(status)) {
        break;
      }

      if (!isRetryableStatus(status) || attempt === retries) {
        break;
      }

      const delay = getRetryAfterMs(err, attempt);
      console.warn(
        `[API] Retry ${attempt}/${retries} for ${path} after ${delay}ms (${status || err.message})`
      );
      await sleep(delay);
    }
  }

  const status = lastError.response?.status;
  const message =
    lastError.response?.data?.message ||
    lastError.response?.data?.reason ||
    lastError.message;
  const error = new Error(`Clash API error ${status || ''}: ${message}`);
  error.status = status;
  error.isNotFound = status === 404;
  error.isRateLimited = status === 429;
  error.isAuthError = status === 401 || status === 403;
  throw error;
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
    const httpStatus = err.response?.status;
    const message =
      err.response?.data?.message ||
      err.response?.data?.reason ||
      err.message;
    const error = new Error(`Player token verify failed: ${message}`);
    error.status = httpStatus;
    error.isNotFound = httpStatus === 404;
    error.isAuthError =
      httpStatus === 401 || httpStatus === 403 || httpStatus === 400;
    error.isRateLimited = httpStatus === 429;
    throw error;
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
  verifyPlayerWithToken,
  encodeTag,
};
