const {
  getCurrentWarLeagueGroup,
  getCwlWar,
} = require('../api/clash');
const { normalizeTag } = require('../utils/helpers');
const config = require('../config');

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

module.exports = {
  findOurCwlWar,
  isInCwl,
  formatCwlDayLabel,
  buildCwlLeagueKey,
};
