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

/** Official CoC API — used only for player-token ownership checks. */
const OFFICIAL_API_BASE = 'https://api.clashofclans.com/v1';

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
 * Prove ownership: call official API with the player's own API token.
 * Returns the player profile on success. Never log or store the token.
 */
async function verifyPlayerWithToken(tag, playerToken) {
  const clean = String(tag).replace(/^#/, '').toUpperCase();
  const token = String(playerToken || '').trim();
  if (!token || token.length < 20) {
    const err = new Error('Invalid player API token');
    err.isAuthError = true;
    throw err;
  }

  try {
    const res = await axios.get(`${OFFICIAL_API_BASE}/players/${encodeTag(clean)}`, {
      timeout: config.clashApiTimeoutMs || 15000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    const data = res.data;
    const returned = String(data?.tag || '')
      .replace(/^#/, '')
      .toUpperCase();
    if (returned !== clean) {
      const err = new Error('Token does not match this player tag');
      err.isAuthError = true;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.isAuthError) throw err;
    const status = err.response?.status;
    const message =
      err.response?.data?.message ||
      err.response?.data?.reason ||
      err.message;
    const error = new Error(`Player token verify failed: ${message}`);
    error.status = status;
    error.isNotFound = status === 404;
    error.isAuthError = status === 401 || status === 403;
    error.isRateLimited = status === 429;
    throw error;
  }
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
