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

async function buildPendingAttackersHtml(members, attacksPerMember) {
  const pending = getPendingAttackers(members, attacksPerMember);
  if (pending.length === 0) {
    return '<p>✅ همه اعضا حمله‌های خود را انجام داده‌اند.</p>';
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
          'بازیکن';
        mentionParts.push(tgUserLink(id, label));
      }
    }
  }

  const mentionsLine =
    mentionParts.length > 0
      ? `<p>📣 منشن‌ها: ${mentionParts.join(' · ')}</p>`
      : '';

  return (
    `<p>⚠️ حمله باقی‌مانده: <b>${pending.length}</b> نفر</p>` +
    `<table bordered striped compact>` +
    `<tr><th>#</th><th>بازیکن</th><th>حمله</th></tr>` +
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

async function buildWarRichHtml(war, title, extraHtml = '', cwlMeta = null) {
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
    const formatted = formatWarTime(start);
    if (formatted) timeInfo = `<p>🕐 شروع نبرد: <b>${formatted}</b></p>`;
  } else if (war.state === 'inWar') {
    const end = parseClashTime(war.endTime);
    const formatted = formatWarTime(end);
    if (formatted) timeInfo = `<p>🕐 پایان وار: <b>${formatted}</b></p>`;
  }
  const isCwlWar =
    Boolean(cwlMeta && cwlMeta.cwlDay) || Boolean(war.__cwlMeta);
  const rows = await buildMembersTableRows(
    members,
    getAttacksPerMember(war, isCwlWar)
  );
  const dayLine =
    cwlMeta && cwlMeta.cwlDay
      ? `<p>📅 <b>${formatCwlDayLabel(cwlMeta.cwlDay, cwlMeta.cwlTotalDays)}</b> لیگ کلن‌ها</p>`
      : '';
  return `<h2>${title}</h2>
${dayLine}
<table bordered striped compact>
<tr><th>کلن</th><th>ستاره</th><th>تخریب</th></tr>
<tr><td>🏰 ${escapeHtml(ourName)}</td><td>${our.stars ?? 0} ⭐</td><td>${(our.destructionPercentage ?? 0).toFixed(1)}%</td></tr>
<tr><td>⚡ ${escapeHtml(oppName)}</td><td>${opp.stars ?? 0} ⭐</td><td>${(opp.destructionPercentage ?? 0).toFixed(1)}%</td></tr>
</table>
<p>👥 ${teamSize}v${teamSize}<br/>⏳ وضعیت: <b>${escapeHtml(warStateLabel(war.state))}</b></p>
${timeInfo}
${extraHtml}
<h3>📋 اعضای وار</h3>
<table bordered striped compact>
<tr><th>#</th><th>بازیکن</th><th>TH</th><th>حمله</th><th>ستاره</th><th>دفاع</th></tr>
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
