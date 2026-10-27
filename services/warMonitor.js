const { query } = require('../database');
const {
  getCurrentWar,
  getCurrentWarLeagueGroup,
  getCwlWar,
  getClan,
} = require('../api/clash');
const { getLinksForTags } = require('./linkService');
const {
  escapeHtml,
  tgUserLink,
  warStateLabel,
  resultLabel,
  parseClashTime,
  formatTag,
  normalizeTag,
} = require('../utils/helpers');
const config = require('../config');

async function hasNotification(warKey, eventType) {
  const res = await query(
    `SELECT 1 FROM war_notifications WHERE war_key = $1 AND event_type = $2`,
    [warKey, eventType]
  );
  return res.rowCount > 0;
}

async function markNotification(warKey, eventType, payloadHash = null) {
  await query(
    `INSERT INTO war_notifications (war_key, event_type, payload_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (war_key, event_type) DO NOTHING`,
    [warKey, eventType, payloadHash]
  );
}

async function getLastState() {
  const res = await query(`SELECT * FROM war_state WHERE id = 1`);
  return res.rows[0] || null;
}

async function saveState(data) {
  await query(
    `UPDATE war_state SET
      state = $1,
      war_tag = $2,
      opponent_tag = $3,
      team_size = $4,
      preparation_start = $5,
      start_time = $6,
      end_time = $7,
      our_stars = $8,
      their_stars = $9,
      our_destruction = $10,
      their_destruction = $11,
      members_json = $12,
      attacks_json = $13,
      is_cwl = $14,
      updated_at = NOW()
     WHERE id = 1`,
    [
      data.state,
      data.warTag || null,
      data.opponentTag || null,
      data.teamSize || null,
      data.preparationStart || null,
      data.startTime || null,
      data.endTime || null,
      data.ourStars ?? null,
      data.theirStars ?? null,
      data.ourDestruction ?? null,
      data.theirDestruction ?? null,
      data.membersJson ? JSON.stringify(data.membersJson) : null,
      data.attacksJson ? JSON.stringify(data.attacksJson) : null,
      data.isCwl || false,
    ]
  );
}

function buildWarKey(war) {
  if (!war || war.state === 'notInWar') return 'notInWar';
  const opp = war.opponent?.tag || 'unknown';
  const start = war.preparationStartTime || war.startTime || 'x';
  return `${normalizeTag(opp)}_${start}`;
}

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
  for (const m of members) {
    used += (m.attacks || []).length;
  }
  return used;
}

async function formatMembersList(members) {
  if (!members || members.length === 0) return '—';

  const tags = members.map((m) => m.tag);
  const linksMap = await getLinksForTags(tags);

  const lines = members
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0))
    .map((m, idx) => {
      const links = linksMap.get(m.tag) || [];
      const name = escapeHtml(m.name || formatTag(m.tag));

      if (links.length === 0) {
        return `${idx + 1}. ${name} — ⚠️ لینک نشده`;
      }

      const linkedNames = links
        .map((u) => tgUserLink(u.telegram_id, m.name))
        .join(' / ');

      return `${idx + 1}. ${linkedNames} — ✅ لینک شده`;
    });

  const linkedCount = members.filter((m) => (linksMap.get(m.tag) || []).length > 0).length;
  lines.push('');
  lines.push(`🔗 وضعیت لینک‌ها: ${linkedCount} از ${members.length} عضو لینک شده‌اند.`);

  return lines.join('\n');
}

async function sendToGroup(bot, text) {
  if (!config.telegramGroupId) {
    console.warn('[WarMonitor] TELEGRAM_GROUP_ID not set, skipping notification');
    return;
  }
  try {
    await bot.telegram.sendMessage(config.telegramGroupId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('[WarMonitor] Failed to send group message:', err.message);
  }
}

async function notifyOpponentFound(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_opponent_found' : 'opponent_found';
  if (await hasNotification(warKey, event)) return;

  const ourClan = war.clan || {};
  const opp = war.opponent || {};
  const members = extractMembers(war);
  const membersList = await formatMembersList(members);
  const teamSize = war.teamSize || members.length || '?';

  const text = `
⚔️ <b>حریف وار پیدا شد!</b>${isCwl ? ' (CWL)' : ''}

🏰 کلن ما: <b>${escapeHtml(ourClan.name || '—')}</b>
🆚 کلن حریف: <b>${escapeHtml(opp.name || '—')}</b> (${formatTag(opp.tag)})
👥 نوع وار: ${teamSize}v${teamSize}
⏳ وضعیت: ${warStateLabel(war.state)}

📋 <b>اعضای شرکت‌کننده در وار:</b>

${membersList}
`.trim();

  await sendToGroup(bot, text);
  await markNotification(warKey, event);
}

async function notifyPreparation(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_preparation' : 'preparation';
  if (await hasNotification(warKey, event)) return;

  const text = `
⏳ <b>مرحله آماده‌سازی وار شروع شد!</b>${isCwl ? ' (CWL)' : ''}

🏰 ${escapeHtml(war.clan?.name || '')} vs ${escapeHtml(war.opponent?.name || '')}
📅 شروع نبرد: ${war.startTime ? new Date(war.startTime).toLocaleString('fa-IR') : '—'}
`.trim();

  await sendToGroup(bot, text);
  await markNotification(warKey, event);
}

async function notifyBattleStart(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_battle_start' : 'battle_start';
  if (await hasNotification(warKey, event)) return;

  const our = war.clan || {};
  const their = war.opponent || {};
  const members = extractMembers(war);
  const attacksUsed = countAttacks(members);
  const maxAttacks = (war.teamSize || members.length) * (war.attacksPerMember || 2);
  const notAttacked = members.filter((m) => (m.attacks || []).length === 0);

  let notAttackedText = 'همه حمله کرده‌اند ✅';
  if (notAttacked.length > 0) {
    const linksMap = await getLinksForTags(notAttacked.map((m) => m.tag));
    notAttackedText = notAttacked
      .map((m) => {
        const links = linksMap.get(m.tag) || [];
        if (links.length > 0) {
          return links.map((u) => tgUserLink(u.telegram_id, m.name)).join(' / ');
        }
        return escapeHtml(m.name);
      })
      .join('، ');
  }

  const text = `
🔥 <b>روز نبرد شروع شد!</b>${isCwl ? ' (CWL)' : ''}

🏰 ${escapeHtml(our.name)}  ${our.stars ?? 0}⭐ (${(our.destructionPercentage ?? 0).toFixed(1)}%)
🆚 ${escapeHtml(their.name)}  ${their.stars ?? 0}⭐ (${(their.destructionPercentage ?? 0).toFixed(1)}%)

⚔️ حمله‌های استفاده‌شده: ${attacksUsed} / ${maxAttacks}
👥 هنوز حمله نکرده‌اند: ${notAttackedText}
`.trim();

  await sendToGroup(bot, text);
  await markNotification(warKey, event);
}

async function notifyWarEnded(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_war_ended' : 'war_ended';
  if (await hasNotification(warKey, event)) return;

  const our = war.clan || {};
  const their = war.opponent || {};
  let result = 'tie';
  if ((our.stars || 0) > (their.stars || 0)) result = 'win';
  else if ((our.stars || 0) < (their.stars || 0)) result = 'lose';
  else if ((our.destructionPercentage || 0) > (their.destructionPercentage || 0)) result = 'win';
  else if ((our.destructionPercentage || 0) < (their.destructionPercentage || 0)) result = 'lose';

  const text = `
🏁 <b>وار به پایان رسید!</b>${isCwl ? ' (CWL)' : ''}

🏰 ${escapeHtml(our.name)}  ${our.stars ?? 0}⭐ (${(our.destructionPercentage ?? 0).toFixed(1)}%)
🆚 ${escapeHtml(their.name)}  ${their.stars ?? 0}⭐ (${(their.destructionPercentage ?? 0).toFixed(1)}%)

نتیجه: ${resultLabel(result)}
`.trim();

  await sendToGroup(bot, text);
  await markNotification(warKey, event);
}

async function checkRegularWar(bot) {
  let war;
  try {
    war = await getCurrentWar();
  } catch (err) {
    if (err.isNotFound) {
      return null;
    }
    throw err;
  }

  if (!war || war.state === 'notInWar') {
    return { state: 'notInWar', isCwl: false };
  }

  const members = extractMembers(war);

  if (war.state === 'preparation') {
    await notifyOpponentFound(bot, war, false);
    await notifyPreparation(bot, war, false);
  }

  if (war.state === 'inWar') {
    await notifyOpponentFound(bot, war, false);
    await notifyBattleStart(bot, war, false);
  }

  if (war.state === 'warEnded') {
    await notifyWarEnded(bot, war, false);
  }

  await saveState({
    state: war.state,
    warTag: war.tag || null,
    opponentTag: war.opponent?.tag,
    teamSize: war.teamSize,
    preparationStart: war.preparationStartTime ? new Date(war.preparationStartTime) : null,
    startTime: war.startTime ? new Date(war.startTime) : null,
    endTime: war.endTime ? new Date(war.endTime) : null,
    ourStars: war.clan?.stars,
    theirStars: war.opponent?.stars,
    ourDestruction: war.clan?.destructionPercentage,
    theirDestruction: war.opponent?.destructionPercentage,
    membersJson: members,
    isCwl: false,
  });

  return war;
}

async function checkCwl(bot) {
  let group;
  try {
    group = await getCurrentWarLeagueGroup();
  } catch (err) {
    if (err.isNotFound || err.status === 404) {
      return null;
    }
    console.warn('[WarMonitor] CWL group fetch failed:', err.message);
    return null;
  }

  if (!group || !group.rounds) return null;

  const ourTag = normalizeTag(config.clanTag);

  for (const round of group.rounds || []) {
    for (const warTag of round.warTags || []) {
      if (warTag === '#0' || !warTag) continue;
      try {
        const war = await getCwlWar(warTag);
        const clan1 = war.clan || {};
        const clan2 = war.opponent || {};

        const isOurWar =
          normalizeTag(clan1.tag) === ourTag ||
          normalizeTag(clan2.tag) === ourTag ||
          normalizeTag(war.clan?.tag) === ourTag ||
          normalizeTag(war.opponent?.tag) === ourTag;

        if (!isOurWar) continue;

        if (normalizeTag(war.opponent?.tag) === ourTag) {
          const tmp = war.clan;
          war.clan = war.opponent;
          war.opponent = tmp;
        }

        if (war.state === 'preparation') {
          await notifyOpponentFound(bot, war, true);
          await notifyPreparation(bot, war, true);
        }
        if (war.state === 'inWar') {
          await notifyOpponentFound(bot, war, true);
          await notifyBattleStart(bot, war, true);
        }
        if (war.state === 'warEnded') {
          await notifyWarEnded(bot, war, true);
        }

        await saveState({
          state: war.state,
          warTag: warTag,
          opponentTag: war.opponent?.tag,
          teamSize: war.teamSize,
          isCwl: true,
          ourStars: war.clan?.stars,
          theirStars: war.opponent?.stars,
        });

        return war;
      } catch (e) {
        continue;
      }
    }
  }
  return null;
}

async function checkWarStatus(bot) {
  try {
    const regular = await checkRegularWar(bot);
    const cwl = await checkCwl(bot);

    if ((!regular || regular.state === 'notInWar') && !cwl) {
      // Idle
    }
  } catch (err) {
    console.error('[WarMonitor] Error during check:', err.message);
  }
}

function startWarMonitor(bot) {
  console.log(`[WarMonitor] Starting with interval ${config.warPollIntervalMs}ms`);

  setTimeout(() => checkWarStatus(bot), 5000);

  const interval = setInterval(() => checkWarStatus(bot), config.warPollIntervalMs);

  if (global.__warMonitorInterval) {
    clearInterval(global.__warMonitorInterval);
  }
  global.__warMonitorInterval = interval;

  return interval;
}

module.exports = {
  startWarMonitor,
  checkWarStatus,
  formatMembersList,
};
