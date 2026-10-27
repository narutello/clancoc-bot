const axios = require('axios');
const config = require('../config');

const client = axios.create({
  baseURL: config.clashApiBaseUrl,
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${config.clashApiToken}`,
    Accept: 'application/json',
  },
});

function encodeTag(tag) {
  const clean = String(tag).replace(/^#/, '').toUpperCase();
  return `%23${clean}`;
}

async function request(path, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await client.get(path);
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isRetryable = !status || status >= 500 || status === 429 || status === 408;

      if (!isRetryable || attempt === retries) {
        break;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.warn(`[API] Retry ${attempt}/${retries} for ${path} after ${delay}ms (${status || err.message})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const status = lastError.response?.status;
  const message = lastError.response?.data?.message || lastError.message;
  const error = new Error(`Clash API error ${status || ''}: ${message}`);
  error.status = status;
  error.isNotFound = status === 404;
  error.isRateLimited = status === 429;
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
