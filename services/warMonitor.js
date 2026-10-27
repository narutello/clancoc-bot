const { query } = require('../database');
const {
  getCurrentWar,
  getCurrentWarLeagueGroup,
  getCwlWar,
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
  stripEmojis,
  formatWarTime,
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

/** ساخت جدول اعضا برای Rich Message */
async function buildMembersTableRows(members) {
  if (!members || members.length === 0) return '';

  const tags = members.map((m) => m.tag);
  const linksMap = await getLinksForTags(tags);

  return members
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0))
    .map((m) => {
      const attacks = m.attacks || [];
      const stars = attacks.reduce((sum, a) => sum + (a.stars || 0), 0);
      const links = linksMap.get(m.tag) || [];

      let nameCell;
      if (links.length > 0) {
        nameCell = links
          .map((u) => tgUserLink(u.telegram_id, m.name))
          .join(' / ');
      } else {
        nameCell = escapeHtml(m.name || formatTag(m.tag));
      }

      return `
        <tr>
          <td>${m.mapPosition ?? '—'}</td>
          <td>${nameCell}</td>
          <td>${attacks.length}</td>
          <td>${stars} ⭐</td>
        </tr>
      `;
    })
    .join('');
}

/** ساخت HTML کامل وضعیت وار (مثل /war) */
async function buildWarRichHtml(war, title, extraHtml = '') {
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

  const rows = await buildMembersTableRows(members);

  return `
    <h2>${title}</h2>

    <table bordered striped compact>
      <tr>
        <th>کلن</th>
        <th>ستاره</th>
        <th>تخریب</th>
      </tr>
      <tr>
        <td>🏰 ${escapeHtml(ourName)}</td>
        <td>${our.stars ?? 0} ⭐</td>
        <td>${(our.destructionPercentage ?? 0).toFixed(1)}%</td>
      </tr>
      <tr>
        <td>⚡ ${escapeHtml(oppName)}</td>
        <td>${opp.stars ?? 0} ⭐</td>
        <td>${(opp.destructionPercentage ?? 0).toFixed(1)}%</td>
      </tr>
    </table>

    <p>
      👥 ${teamSize}v${teamSize}<br/>
      ⏳ وضعیت: <b>${escapeHtml(warStateLabel(war.state))}</b>
    </p>

    ${timeInfo}
    ${extraHtml}

    <h3>📋 اعضای وار</h3>

    <table bordered striped compact>
      <tr>
        <th>#</th>
        <th>بازیکن</th>
        <th>حمله</th>
        <th>ستاره</th>
      </tr>
      ${rows}
    </table>
  `.trim();
}

async function sendToGroup(bot, html) {
  if (!config.telegramGroupId) {
    console.warn('[WarMonitor] TELEGRAM_GROUP_ID not set, skipping notification');
    return;
  }
  try {
    await bot.telegram.callApi('sendRichMessage', {
      chat_id: config.telegramGroupId,
      rich_message: {
        html,
        is_rtl: true,
      },
    });
  } catch (err) {
    console.error('[WarMonitor] Failed to send rich message:', err.message);
    try {
      await bot.telegram.sendMessage(
        config.telegramGroupId,
        'اعلان وار (نسخه کلاینت از Rich Message پشتیبانی نمی‌کند)',
        { disable_web_page_preview: true }
      );
    } catch (e2) {
      console.error('[WarMonitor] Fallback also failed:', e2.message);
    }
  }
}

async function notifyOpponentFound(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_opponent_found' : 'opponent_found';
  if (await hasNotification(warKey, event)) return;

  const title = `⚔️ حریف وار پیدا شد!${isCwl ? ' (CWL)' : ''}`;
  const html = await buildWarRichHtml(war, title);
  await sendToGroup(bot, html);
  await markNotification(warKey, event);
}

async function notifyPreparation(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_preparation' : 'preparation';
  if (await hasNotification(warKey, event)) return;

  const title = `⏳ مرحله آماده‌سازی شروع شد!${isCwl ? ' (CWL)' : ''}`;
  const html = await buildWarRichHtml(war, title);
  await sendToGroup(bot, html);
  await markNotification(warKey, event);
}

async function notifyBattleStart(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_battle_start' : 'battle_start';
  if (await hasNotification(warKey, event)) return;

  const members = extractMembers(war);
  const attacksUsed = countAttacks(members);
  const maxAttacks =
    (war.teamSize || members.length) * (war.attacksPerMember || 2);

  const extra = `<p>⚔️ حمله‌ها: <b>${attacksUsed}/${maxAttacks}</b></p>`;
  const title = `🔥 روز نبرد شروع شد!${isCwl ? ' (CWL)' : ''}`;
  const html = await buildWarRichHtml(war, title, extra);
  await sendToGroup(bot, html);
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
  else if ((our.destructionPercentage || 0) > (their.destructionPercentage || 0))
    result = 'win';
  else if ((our.destructionPercentage || 0) < (their.destructionPercentage || 0))
    result = 'lose';

  const extra = `<p>نتیجه: <b>${resultLabel(result)}</b></p>`;
  const title = `🏁 وار به پایان رسید!${isCwl ? ' (CWL)' : ''}`;
  const html = await buildWarRichHtml(war, title, extra);
  await sendToGroup(bot, html);
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
    preparationStart: war.preparationStartTime
      ? new Date(war.preparationStartTime)
      : null,
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

        const isOurWar =
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
    await checkRegularWar(bot);
    await checkCwl(bot);
  } catch (err) {
    console.error('[WarMonitor] Error during check:', err.message);
  }
}

function startWarMonitor(bot) {
  console.log(`[WarMonitor] Starting with interval ${config.warPollIntervalMs}ms`);

  setTimeout(() => checkWarStatus(bot), 5000);

  const interval = setInterval(
    () => checkWarStatus(bot),
    config.warPollIntervalMs
  );

  if (global.__warMonitorInterval) {
    clearInterval(global.__warMonitorInterval);
  }
  global.__warMonitorInterval = interval;

  return interval;
}

async function formatMembersList(members) {
  if (!members || members.length === 0) return '—';
  const tags = members.map((m) => m.tag);
  const linksMap = await getLinksForTags(tags);
  return members
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0))
    .map((m, idx) => {
      const links = linksMap.get(m.tag) || [];
      const name = escapeHtml(m.name || formatTag(m.tag));
      if (links.length === 0) return `${idx + 1}. ${name}`;
      const linkedNames = links
        .map((u) => tgUserLink(u.telegram_id, m.name))
        .join(' / ');
      return `${idx + 1}. ${linkedNames} ✅`;
    })
    .join('\n');
}

module.exports = {
  startWarMonitor,
  checkWarStatus,
  formatMembersList,
};
