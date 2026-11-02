const {
  getCurrentWarLeagueGroup,
  getCwlWar,
} = require('../api/clash');
const { normalizeTag } = require('../utils/helpers');
const config = require('../config');

/**
 * پیدا کردن وار فعال/آخرین وار CWL کلن + شماره روز
 * @returns {Promise<null | { war: object, isCwl: true, cwlDay: number, cwlTotalDays: number }>}
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

  let endedFallback = null;

  for (let i = 0; i < rounds.length; i++) {
    const day = i + 1;
    const warTags = rounds[i].warTags || [];

    for (const warTag of warTags) {
      if (!warTag || warTag === '#0') continue;

      try {
        const war = await getCwlWar(warTag);
        const clanTag = normalizeTag(war.clan?.tag);
        const oppTag = normalizeTag(war.opponent?.tag);
        if (clanTag !== ourTag && oppTag !== ourTag) continue;

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
        };

        if (war.state === 'preparation' || war.state === 'inWar') {
          return result;
        }

        if (war.state === 'warEnded') {
          endedFallback = result;
        }
      } catch (_) {
        continue;
      }
    }
  }

  return endedFallback;
}

function formatCwlDayLabel(cwlDay, cwlTotalDays) {
  if (!cwlDay || !cwlTotalDays) return '';
  return `روز ${cwlDay} از ${cwlTotalDays}`;
}

module.exports = {
  findOurCwlWar,
  formatCwlDayLabel,
};
