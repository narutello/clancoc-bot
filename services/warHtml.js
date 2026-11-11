const { getLinksForTags } = require('./linkService');
const { formatCwlDayLabel } = require('./cwlService');
const {
  escapeHtml,
  tgUserLink,
  warStateLabel,
  parseClashTime,
  formatTag,
  normalizeTag,
  stripEmojis,
  formatWarTime,
  getAttacksPerMember,
} = require('../utils/helpers');
const { t, DEFAULT_LANG } = require('../utils/i18n');

function extractMembers(war) {
  const clan = war.clan || {};
  return (clan.members || []).map((m) => ({
    tag: normalizeTag(m.tag),
    name: m.name,
    mapPosition: m.mapPosition,
    townhallLevel: m.townhallLevel,
    attacks: m.attacks || [],
    opponentAttacks: m.opponentAttacks || 0,
    bestOpponentAttack: m.bestOpponentAttack || null,
  }));
}

function countAttacks(members) {
  let used = 0;
  for (const m of members) used += (m.attacks || []).length;
  return used;
}

function getPendingAttackers(members, attacksPerMember) {
  const max = Math.max(1, Number(attacksPerMember) || 1);
  return (members || [])
    .filter((m) => (m.attacks || []).length < max)
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0));
}

async function buildPendingAttackersHtml(
  members,
  attacksPerMember,
  lang = DEFAULT_LANG
) {
  const pending = getPendingAttackers(members, attacksPerMember);
  if (pending.length === 0) {
    return `<p>${t('notify.pending_all_done', { lng: lang })}</p>`;
  }

  const tags = pending.map((m) => m.tag);
  const linksMap = await getLinksForTags(tags);
  const max = Math.max(1, Number(attacksPerMember) || 1);

  const rows = pending
    .map((m, index) => {
      const used = (m.attacks || []).length;
      const nameCell = escapeHtml(m.name || formatTag(m.tag));
      return (
        `<tr>` +
        `<td>${index + 1}</td>` +
        `<td>${nameCell}</td>` +
        `<td>${used}/${max}</td>` +
        `</tr>`
      );
    })
    .join('');

  const seenIds = new Set();
  const mentionParts = [];
  for (const m of pending) {
    const links = linksMap.get(m.tag) || [];
    for (const u of links) {
      const id = u.telegram_id;
      if (id == null || seenIds.has(id)) continue;
      seenIds.add(id);
      if (u.username) {
        mentionParts.push(
          `<a href="tg://user?id=${id}">@${escapeHtml(u.username)}</a>`
        );
      } else {
        const label =
          (u.first_name && String(u.first_name).trim()) ||
          (m.name && String(m.name).trim()) ||
          t('common.player_fallback', { lng: lang });
        mentionParts.push(tgUserLink(id, label));
      }
    }
  }

  const mentionsLine =
    mentionParts.length > 0
      ? `<p>${t('notify.mentions', {
          lng: lang,
          list: mentionParts.join(' · '),
        })}</p>`
      : '';

  return (
    `<p>${t('notify.pending_count', {
      lng: lang,
      count: pending.length,
    })}</p>` +
    `<table bordered striped compact>` +
    `<tr><th>${t('common.rank', { lng: lang })}</th><th>${t('common.player', {
      lng: lang,
    })}</th><th>${t('common.attack', { lng: lang })}</th></tr>` +
    rows +
    `</table>` +
    mentionsLine
  );
}

async function buildMembersTableRows(members, attacksPerMember = 2) {
  if (!members || members.length === 0) return '';
  const tags = members.map((m) => m.tag);
  const linksMap = await getLinksForTags(tags);
  return members
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0))
    .map((m, index) => {
      const attacks = m.attacks || [];
      const stars = attacks.reduce((sum, a) => sum + (a.stars || 0), 0);
      const defStars = m.bestOpponentAttack?.stars ?? 0;
      const links = linksMap.get(m.tag) || [];
      let nameCell;
      if (links.length > 0) {
        nameCell = links
          .map((u) => tgUserLink(u.telegram_id, m.name))
          .join(' / ');
      } else {
        nameCell = escapeHtml(m.name || formatTag(m.tag));
      }
      const th = m.townhallLevel ?? m.townHallLevel ?? '—';
      const rowNum = index + 1;
      return `<tr><td>${rowNum}</td><td>${nameCell}</td><td>${th}</td><td>${attacks.length}/${attacksPerMember}</td><td>${stars} ⭐</td><td>${defStars} ⭐</td></tr>`;
    })
    .join('');
}

async function buildWarRichHtml(
  war,
  title,
  extraHtml = '',
  cwlMeta = null,
  lang = DEFAULT_LANG
) {
  const our = war.clan || {};
  const opp = war.opponent || {};
  const members = extractMembers(war);
  const teamSize = war.teamSize || members.length || '?';
  const ourName = stripEmojis(our.name || '—') || '—';
  const oppName = stripEmojis(opp.name || '—') || '—';
  let timeInfo = '';
  if (war.state === 'preparation') {
    const start =
      parseClashTime(war.startTime) || parseClashTime(war.preparationStartTime);
    const formatted = formatWarTime(start, lang);
    if (formatted) {
      timeInfo = `<p>${t('war.start_time', { lng: lang, time: formatted })}</p>`;
    }
  } else if (war.state === 'inWar') {
    const end = parseClashTime(war.endTime);
    const formatted = formatWarTime(end, lang);
    if (formatted) {
      timeInfo = `<p>${t('war.end_time', { lng: lang, time: formatted })}</p>`;
    }
  }
  const isCwlWar =
    Boolean(cwlMeta && cwlMeta.cwlDay) || Boolean(war.__cwlMeta);
  const rows = await buildMembersTableRows(
    members,
    getAttacksPerMember(war, isCwlWar)
  );
  const dayLine =
    cwlMeta && cwlMeta.cwlDay
      ? `<p>${t('cwl.day_line', {
          lng: lang,
          dayLabel: formatCwlDayLabel(
            cwlMeta.cwlDay,
            cwlMeta.cwlTotalDays,
            lang
          ),
        })}</p>`
      : '';
  return `<h2>${title}</h2>
${dayLine}
<table bordered striped compact>
<tr><th>${t('common.clan', { lng: lang })}</th><th>${t('common.stars', {
    lng: lang,
  })}</th><th>${t('common.destruction', { lng: lang })}</th></tr>
<tr><td>🏰 ${escapeHtml(ourName)}</td><td>${our.stars ?? 0} ⭐</td><td>${(our.destructionPercentage ?? 0).toFixed(1)}%</td></tr>
<tr><td>⚡ ${escapeHtml(oppName)}</td><td>${opp.stars ?? 0} ⭐</td><td>${(opp.destructionPercentage ?? 0).toFixed(1)}%</td></tr>
</table>
<p>${t('war.team_size', { lng: lang, size: teamSize })}<br/>${t(
    'war.state_line',
    { lng: lang, state: warStateLabel(war.state, lang) }
  )}</p>
${timeInfo}
${extraHtml}
<h3>${t('war.members_heading', { lng: lang })}</h3>
<table bordered striped compact>
<tr><th>${t('common.rank', { lng: lang })}</th><th>${t('common.player', {
    lng: lang,
  })}</th><th>${t('common.th', { lng: lang })}</th><th>${t('common.attack', {
    lng: lang,
  })}</th><th>${t('common.stars', { lng: lang })}</th><th>${t(
    'common.defense',
    { lng: lang }
  )}</th></tr>
${rows}
</table>`.trim();
}

module.exports = {
  extractMembers,
  countAttacks,
  getPendingAttackers,
  buildPendingAttackersHtml,
  buildMembersTableRows,
  buildWarRichHtml,
};
