const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');
const {
  escapeHtml,
  parseClashTime,
  formatTag,
  normalizeTag,
  tgUserLink,
  formatWarTime,
} = require('../utils/helpers');
const { t } = require('../utils/i18n');
const { isNotifyEnabled } = require('./settingsService');
const {
  claimNotification,
  releaseNotification,
} = require('./warState');
const { getLinksForTags } = require('./linkService');
const { sendToGroup, groupLang } = require('./warNotify');

function buildRaidKey(season) {
  if (!season) return null;
  const start = parseClashTime(season.startTime);
  const t0 = start ? start.getTime() : 0;
  return `capital_raid_${t0}`;
}

function memberAttackCount(m) {
  if (!m) return 0;
  if (m.attacks != null) return Number(m.attacks) || 0;
  if (m.attackCount != null) return Number(m.attackCount) || 0;
  return 0;
}

function memberLoot(m) {
  if (!m) return 0;
  return Number(m.capitalResourcesLooted ?? m.loot ?? 0) || 0;
}

function sortMembersByLoot(members) {
  return [...(members || [])].sort((a, b) => {
    const lootDiff = memberLoot(b) - memberLoot(a);
    if (lootDiff !== 0) return lootDiff;
    return memberAttackCount(b) - memberAttackCount(a);
  });
}

async function groupCapitalEnabled(key) {
  if (!config.telegramGroupId) return true;
  try {
    return await isNotifyEnabled(config.telegramGroupId, 'capital', key);
  } catch {
    return true;
  }
}

async function sendClaimed(bot, html, lang, raidKey, event) {
  const sent = await sendToGroup(bot, html, lang);
  if (!sent) {
    try {
      await releaseNotification(raidKey, event);
    } catch (_) {}
  }
  return sent;
}

function stateLabel(state, lang) {
  if (state === 'ongoing') return t('capital.state_ongoing', { lng: lang });
  if (state === 'ended') return t('capital.state_ended', { lng: lang });
  return state || '—';
}

function buildSummaryHtml(season, title, lang, extra = '') {
  const loot = season.capitalTotalLoot ?? 0;
  const raids = season.raidsCompleted ?? 0;
  const attacks = season.totalAttacks ?? 0;
  const districts = season.enemyDistrictsDestroyed ?? 0;
  const off = season.offensiveReward ?? 0;
  const def = season.defensiveReward ?? 0;

  const start = parseClashTime(season.startTime);
  const end = parseClashTime(season.endTime);
  const startLine = start
    ? `<p>🕐 ${t('capital.start', { lng: lang })}: <b>${escapeHtml(
        formatWarTime(start, lang) || '—'
      )}</b></p>`
    : '';
  const endLine = end
    ? `<p>🏁 ${t('capital.end', { lng: lang })}: <b>${escapeHtml(
        formatWarTime(end, lang) || '—'
      )}</b></p>`
    : '';

  return `<h2>${title}</h2>
<p>📌 ${t('capital.state_line', {
    lng: lang,
    state: stateLabel(season.state, lang),
  })}</p>
${startLine}
${endLine}
<table bordered striped compact>
<tr><th>${t('clan.col_item', { lng: lang })}</th><th>${t('clan.col_value', { lng: lang })}</th></tr>
<tr><td>💰 ${t('capital.loot', { lng: lang })}</td><td><b>${loot}</b></td></tr>
<tr><td>🏕 ${t('capital.raids_completed', { lng: lang })}</td><td><b>${raids}</b></td></tr>
<tr><td>⚔️ ${t('capital.total_attacks', { lng: lang })}</td><td><b>${attacks}</b></td></tr>
<tr><td>🏛 ${t('capital.districts_destroyed', { lng: lang })}</td><td><b>${districts}</b></td></tr>
<tr><td>🎖 ${t('capital.off_reward', { lng: lang })}</td><td><b>${off}</b></td></tr>
<tr><td>🛡 ${t('capital.def_reward', { lng: lang })}</td><td><b>${def}</b></td></tr>
</table>
${extra}`.trim();
}

function linksForMember(linksMap, tag) {
  const key = normalizeTag(tag);
  if (!key) return [];
  return linksMap.get(key) || [];
}

async function buildTopMembersHtml(members, lang, limit = 8) {
  const sorted = sortMembersByLoot(members).slice(0, limit);
  if (sorted.length === 0) {
    return `<p>${t('capital.no_members', { lng: lang })}</p>`;
  }

  const tags = sorted.map((m) => normalizeTag(m.tag)).filter(Boolean);
  let linksMap = new Map();
  try {
    linksMap = await getLinksForTags(tags);
  } catch (_) {}

  const lines = sorted.map((m, i) => {
    let name = escapeHtml(m.name || formatTag(m.tag) || '—');
    const links = linksForMember(linksMap, m.tag);
    if (links.length > 0) {
      name = links
        .map((u) => tgUserLink(u.telegram_id, m.name || formatTag(m.tag)))
        .join(' / ');
    }
    const atk = memberAttackCount(m);
    const loot = memberLoot(m);
    return `<tr><td>${i + 1}</td><td>${name}</td><td>${atk}</td><td>${loot}</td></tr>`;
  });

  return `<h3>${t('capital.top_members', { lng: lang })}</h3>
<table bordered striped compact>
<tr><th>#</th><th>${t('common.player', { lng: lang })}</th><th>${t(
    'capital.col_attacks',
    { lng: lang }
  )}</th><th>${t('capital.col_loot', { lng: lang })}</th></tr>
${lines.join('\n')}
</table>`;
}

async function buildPendingHtml(members, lang) {
  const list = members || [];
  // Early raid weekend: API may return no member rows yet — do not claim "all attacked".
  if (list.length === 0) {
    return '';
  }

  const pending = list.filter((m) => memberAttackCount(m) <= 0);
  if (pending.length === 0) {
    return `<p>${t('capital.all_attacked', { lng: lang })}</p>`;
  }

  const tags = pending.map((m) => normalizeTag(m.tag)).filter(Boolean);
  let linksMap = new Map();
  try {
    linksMap = await getLinksForTags(tags);
  } catch (_) {}

  const names = pending.slice(0, 25).map((m) => {
    const links = linksForMember(linksMap, m.tag);
    if (links.length > 0) {
      return links
        .map((u) => tgUserLink(u.telegram_id, m.name || formatTag(m.tag)))
        .join(' / ');
    }
    return escapeHtml(m.name || formatTag(m.tag) || '—');
  });

  return `<h3>${t('capital.pending_title', { lng: lang })}</h3>
<p>${t('capital.pending_count', { lng: lang, count: pending.length })}</p>
<p>${names.join(' · ')}</p>`;
}

async function notifyRaidStart(bot, season) {
  if (!(await groupCapitalEnabled('raid_start'))) return;
  if (!season || season.state !== 'ongoing') return;

  const raidKey = buildRaidKey(season);
  if (!raidKey) return;
  const event = 'capital_raid_start';
  if (!(await claimNotification(raidKey, event))) return;

  const lang = await groupLang();
  const title = t('capital.notify_start', { lng: lang });
  const top = await buildTopMembersHtml(season.members || [], lang, 5);
  const html = buildSummaryHtml(season, title, lang, top);
  const sent = await sendClaimed(bot, html, lang, raidKey, event);
  if (sent) {
    await tgLog.info('Notification sent: capital raid start', null, {
      module: 'CapitalMonitor',
    });
  }
}

async function notifyRaidEnded(bot, season) {
  if (!(await groupCapitalEnabled('raid_ended'))) return;
  if (!season || season.state !== 'ended') return;

  const raidKey = buildRaidKey(season);
  if (!raidKey) return;
  const event = 'capital_raid_ended';
  if (!(await claimNotification(raidKey, event))) return;

  const lang = await groupLang();
  const title = t('capital.notify_ended', { lng: lang });
  const top = await buildTopMembersHtml(season.members || [], lang, 10);
  const html = buildSummaryHtml(season, title, lang, top);
  const sent = await sendClaimed(bot, html, lang, raidKey, event);
  if (sent) {
    await tgLog.info('Notification sent: capital raid ended', null, {
      module: 'CapitalMonitor',
    });
  }
}

/** Reminder once near the end of an ongoing raid for members with 0 attacks. */
async function notifyRaidReminder(bot, season) {
  if (!(await groupCapitalEnabled('reminder'))) return;
  if (!season || season.state !== 'ongoing') return;

  const end = parseClashTime(season.endTime);
  if (!end) return;
  const msLeft = end.getTime() - Date.now();
  // Between ~6h and ~18h left (weekend reminder window)
  if (msLeft < 6 * 60 * 60 * 1000 || msLeft > 18 * 60 * 60 * 1000) return;

  const raidKey = buildRaidKey(season);
  if (!raidKey) return;
  const event = 'capital_raid_reminder';
  if (!(await claimNotification(raidKey, event))) return;

  const lang = await groupLang();
  const pending = await buildPendingHtml(season.members || [], lang);
  const title = t('capital.notify_reminder', { lng: lang });
  const html = `<h2>${title}</h2>
<p>📌 ${t('capital.state_line', {
    lng: lang,
    state: stateLabel(season.state, lang),
  })}</p>
${pending}`.trim();

  const sent = await sendClaimed(bot, html, lang, raidKey, event);
  if (sent) {
    await tgLog.info('Notification sent: capital raid reminder', null, {
      module: 'CapitalMonitor',
    });
  }
}

module.exports = {
  buildRaidKey,
  buildSummaryHtml,
  buildTopMembersHtml,
  buildPendingHtml,
  notifyRaidStart,
  notifyRaidEnded,
  notifyRaidReminder,
  memberAttackCount,
  memberLoot,
  sortMembersByLoot,
  stateLabel,
};
