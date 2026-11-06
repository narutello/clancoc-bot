const {
  getCurrentWarLeagueGroup,
  getCwlWar,
} = require('../api/clash');
const { normalizeTag, stripEmojis } = require('../utils/helpers');
const config = require('../config');
const { getCache, setCache } = require('../utils/ttlCache');
const { singleflight } = require('../utils/singleflight');

async function fetchCwlWarSafe(warTag) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await getCwlWar(warTag);
    } catch (err) {
      lastErr = err;
      if (err && (err.isNotFound || err.status === 404)) throw err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
        continue;
      }
    }
  }
  throw lastErr;
}

/**
 * پیدا کردن وار فعال/آخرین وار CWL کلن + شماره روز
 * اولویت: preparation/inWar (روز جاری) ؛ فقط اگر هیچ وار فعالی نباشد → آخرین warEnded
 */
async function findOurCwlWar() {
  let group;
  try {
    group = await getCurrentWarLeagueGroup();
  } catch (err) {
    if (err.isNotFound || err.status === 404) return null;
    throw err;
  }

  const rounds = group?.rounds || [];
  if (!rounds.length) return null;

  const ourTag = normalizeTag(config.clanTag);
  const totalDays = rounds.length;
  const season =
    group.season != null
      ? String(group.season)
      : `clan_${ourTag}_${totalDays}`;

  let endedFallback = null;

  for (let i = 0; i < rounds.length; i++) {
    const day = i + 1;
    const warTags = rounds[i].warTags || [];

    for (const warTag of warTags) {
      if (!warTag || warTag === '#0') continue;

      try {
        const war = await fetchCwlWarSafe(warTag);
        const clanTag = normalizeTag(war.clan?.tag);
        const oppTag = normalizeTag(war.opponent?.tag);
        if (clanTag !== ourTag && oppTag !== ourTag) continue;

        // Normalize so our clan is always war.clan
        if (oppTag === ourTag) {
          const tmp = war.clan;
          war.clan = war.opponent;
          war.opponent = tmp;
        }

        if (!war.state || war.state === 'notInWar') continue;

        const result = {
          war,
          isCwl: true,
          cwlDay: day,
          cwlTotalDays: totalDays,
          cwlSeason: season,
          groupState: group.state || null,
        };

        // Active war wins immediately — never fall back to an older ended day
        if (war.state === 'preparation' || war.state === 'inWar') {
          return result;
        }

        // Keep the highest-day ended war as fallback only
        if (war.state === 'warEnded') {
          if (!endedFallback || day >= endedFallback.cwlDay) {
            endedFallback = result;
          }
        }
      } catch (_) {
        continue;
      }
    }
  }

  return endedFallback;
}

async function isInCwl() {
  try {
    const found = await findOurCwlWar();
    return Boolean(found && found.war);
  } catch {
    return false;
  }
}

function formatCwlDayLabel(cwlDay, cwlTotalDays) {
  if (!cwlDay || !cwlTotalDays) return '';
  return `روز ${cwlDay} از ${cwlTotalDays}`;
}

function buildCwlLeagueKey(season) {
  return `cwl_league_${normalizeTag(String(season || 'unknown'))}`;
}

function decideWarWinner(a, b) {
  const as = a.stars || 0;
  const bs = b.stars || 0;
  if (as > bs) return 'a';
  if (bs > as) return 'b';
  const ad = a.destructionPercentage || 0;
  const bd = b.destructionPercentage || 0;
  if (ad > bd) return 'a';
  if (bd > ad) return 'b';
  return null;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }

  const n = Math.max(1, Math.min(concurrency || 3, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

/**
 * جمع‌زدن ستاره‌های گروه لیگ از روی همهٔ وارها.
 * بهینه‌سازی: کش حافظه + singleflight + concurrency محدود.
 */
async function computeCwlStandings() {
  let group;
  try {
    group = await getCurrentWarLeagueGroup();
  } catch (err) {
    if (err.isNotFound || err.status === 404) return null;
    throw err;
  }

  const clans = group?.clans || [];
  const rounds = group?.rounds || [];
  if (!clans.length || !rounds.length) return null;

  const ourTag = normalizeTag(config.clanTag);
  const byTag = new Map();

  for (const c of clans) {
    const tag = normalizeTag(c.tag);
    if (!tag) continue;
    byTag.set(tag, {
      tag,
      name: stripEmojis(c.name || tag) || tag,
      stars: 0,
      attackStars: 0,
      bonusStars: 0,
      destruction: 0,
      wars: 0,
      wins: 0,
      isOurs: tag === ourTag,
    });
  }

  const warTags = [];
  const seen = new Set();
  for (const round of rounds) {
    for (const warTag of round.warTags || []) {
      if (!warTag || warTag === '#0') continue;
      const key = String(warTag);
      if (seen.has(key)) continue;
      seen.add(key);
      warTags.push(warTag);
    }
  }

  const concurrency = config.cwlStandingsConcurrency || 3;
  const wars = await mapPool(warTags, concurrency, async (warTag) => {
    try {
      return await fetchCwlWarSafe(warTag);
    } catch {
      return null;
    }
  });

  let warsCounted = 0;
  for (const war of wars) {
    if (!war || !war.state || war.state === 'notInWar') continue;
    // preparation: usually 0–0; still ok to count once battle stars appear
    const left = war.clan || {};
    const right = war.opponent || {};
    const leftTag = normalizeTag(left.tag);
    const rightTag = normalizeTag(right.tag);
    if (!leftTag || !rightTag) continue;

    const leftRow = byTag.get(leftTag);
    const rightRow = byTag.get(rightTag);
    if (!leftRow || !rightRow) continue;

    const ls = left.stars || 0;
    const rs = right.stars || 0;
    const ld = left.destructionPercentage || 0;
    const rd = right.destructionPercentage || 0;

    leftRow.attackStars += ls;
    rightRow.attackStars += rs;
    leftRow.destruction += ld;
    rightRow.destruction += rd;
    leftRow.wars += 1;
    rightRow.wars += 1;

    // +10 bonus only after war ends (same as in-game group table once decided)
    if (war.state === 'warEnded') {
      const winner = decideWarWinner(left, right);
      if (winner === 'a') {
        leftRow.bonusStars += 10;
        leftRow.wins += 1;
      } else if (winner === 'b') {
        rightRow.bonusStars += 10;
        rightRow.wins += 1;
      }
    }

    warsCounted += 1;
  }

  for (const row of byTag.values()) {
    row.stars = row.attackStars + row.bonusStars;
  }

  const standings = Array.from(byTag.values()).sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars;
    if (b.destruction !== a.destruction) return b.destruction - a.destruction;
    return a.name.localeCompare(b.name);
  });

  standings.forEach((row, i) => {
    row.rank = i + 1;
  });

  return {
    season: group.season != null ? String(group.season) : null,
    state: group.state || null,
    ourTag,
    warsFetched: warTags.length,
    warsCounted,
    standings,
    fetchedAt: Date.now(),
  };
}

async function getCwlStandings() {
  const cacheKey = `cwlStandings:${config.clanTag}`;
  const cached = getCache(cacheKey);
  if (cached !== null) return cached;

  return singleflight(cacheKey, async () => {
    const again = getCache(cacheKey);
    if (again !== null) return again;
    const result = await computeCwlStandings();
    const ttl = config.cwlStandingsCacheTtlMs || 10 * 60 * 1000;
    setCache(cacheKey, result, ttl);
    return result;
  });
}

module.exports = {
  findOurCwlWar,
  isInCwl,
  formatCwlDayLabel,
  buildCwlLeagueKey,
  getCwlStandings,
  computeCwlStandings,
};
