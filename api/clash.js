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

module.exports = {
  getClan,
  getCurrentWar,
  getCurrentWarLeagueGroup,
  getCwlWar,
  getPlayer,
  encodeTag,
};
