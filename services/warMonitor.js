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
  getAttacksPerMember,
} = require('../utils/helpers');
const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');
const {
  findOurCwlWar,
  formatCwlDayLabel,
  buildCwlLeagueKey,
} = require('./cwlService');
const { withTelegramRetry } = require('../utils/telegramSafe');

let lastLoggedWarState = null;

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
      state = $1, war_tag = $2, opponent_tag = $3, team_size = $4,
      preparation_start = $5, start_time = $6, end_time = $7,
      our_stars = $8, their_stars = $9, our_destruction = $10, their_destruction = $11,
      members_json = $12, attacks_json = $13, is_cwl = $14, updated_at = NOW()
     WHERE id = 1`,
    [
      data.state, data.warTag || null, data.opponentTag || null, data.teamSize || null,
      data.preparationStart || null, data.startTime || null, data.endTime || null,
      data.ourStars ?? null, data.theirStars ?? null, data.ourDestruction ?? null, data.theirDestruction ?? null,
      data.membersJson ? JSON.stringify(data.membersJson) : null,
      data.attacksJson ? JSON.stringify(data.attacksJson) : null,
      data.isCwl || false,
    ]
  );
}

function buildWarKey(war) {
  if (!war || war.state === 'notInWar') return 'notInWar';
  const opp = normalizeTag(war.opponent?.tag || 'unknown');
  const start = parseClashTime(war.preparationStartTime) || parseClashTime(war.startTime);
  const t = start ? start.getTime() : 0;
  return `${opp}_${t}`;
}

function buildWarKeyFromSaved(last) {
  if (!last || !last.opponent_tag) return null;
  const opp = normalizeTag(last.opponent_tag);
  const start = last.preparation_start || last.start_time;
  const t = start ? new Date(start).getTime() : 0;
  if (!opp || !t) return null;
  return `${opp}_${t}`;
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
  for (const m of members) used += (m.attacks || []).length;
  return used;
}

/** Members who still have unused attacks */
function getPendingAttackers(members, attacksPerMember) {
  const max = Math.max(1, Number(attacksPerMember) || 1);
  return (members || [])
    .filter((m) => (m.attacks || []).length < max)
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0));
}

/** Pending attackers table + unique Telegram mentions below (no per-row spam) */
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

  // Unique telegram users across all pending clash accounts
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
        mentionParts.push(tgUserLink(id, u.first_name || 'منشن'));
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
      if (links.length > 0) nameCell = links.map((u) => tgUserLink(u.telegram_id, m.name)).join(' / ');
      else nameCell = escapeHtml(m.name || formatTag(m.tag));
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
    const start = parseClashTime(war.startTime) || parseClashTime(war.preparationStartTime);
    const formatted = formatWarTime(start);
    if (formatted) timeInfo = `<p>🕐 شروع نبرد: <b>${formatted}</b></p>`;
  } else if (war.state === 'inWar') {
    const end = parseClashTime(war.endTime);
    const formatted = formatWarTime(end);
    if (formatted) timeInfo = `<p>🕐 پایان وار: <b>${formatted}</b></p>`;
  }
  const isCwlWar = Boolean(cwlMeta && cwlMeta.cwlDay) || Boolean(war.__cwlMeta);
  const rows = await buildMembersTableRows(members, getAttacksPerMember(war, isCwlWar));
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

async function sendToGroup(bot, html) {
  if (!config.telegramGroupId) {
    console.warn('[WarMonitor] TELEGRAM_GROUP_ID not set, skipping notification');
    await tgLog.warn('TELEGRAM_GROUP_ID not set; group notification skipped', null, { module: 'WarMonitor' });
    return;
  }
  try {
    await withTelegramRetry(
      () =>
        bot.telegram.callApi('sendRichMessage', {
          chat_id: config.telegramGroupId,
          rich_message: { html, is_rtl: true },
        }),
      { maxRetries: config.telegramMaxRetries }
    );
  } catch (err) {
    console.error('[WarMonitor] Failed to send rich message:', err.message);
    await tgLog.error('Failed to send rich message to group', err.message, { module: 'WarMonitor' });
    try {
      await withTelegramRetry(
        () =>
          bot.telegram.sendMessage(
            config.telegramGroupId,
            'War notice (client does not support Rich Message)',
            { disable_web_page_preview: true }
          ),
        { maxRetries: config.telegramMaxRetries }
      );
    } catch (e2) {
      console.error('[WarMonitor] Fallback also failed:', e2.message);
      await tgLog.error('Fallback group message also failed', e2.message, { module: 'WarMonitor' });
    }
  }
}

async function notifyPreparation(bot, war) {
  const warKey = buildWarKey(war);
  const event = 'preparation';
  if (await hasNotification(warKey, event)) return;
  const title = '⚔️ حریف پیدا شد — آماده‌سازی شروع شد!';
  const html = await buildWarRichHtml(war, title, '', null);
  await sendToGroup(bot, html);
  await tgLog.info('Notification sent: preparation started', null, { module: 'WarMonitor' });
  await markNotification(warKey, event);
}

async function notifyCwlLeagueStart(bot, war, meta) {
  if (!meta || meta.cwlDay !== 1) return;
  if (!war || war.state !== 'preparation') return;
  const leagueKey = buildCwlLeagueKey(meta.cwlSeason);
  const event = 'cwl_league_preparation';
  if (await hasNotification(leagueKey, event)) return;
  const title = '🏟 لیگ کلن‌ها شروع شد — آماده‌سازی روز اول';
  const html = await buildWarRichHtml(war, title, '', meta);
  await sendToGroup(bot, html);
  await tgLog.info('Notification sent: CWL league start (day 1 preparation)', null, { module: 'WarMonitor' });
  await markNotification(leagueKey, event);
}

async function notifyBattleStart(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_battle_start' : 'battle_start';
  if (await hasNotification(warKey, event)) return;
  const members = extractMembers(war);
  const attacksUsed = countAttacks(members);
  const maxAttacks = (war.teamSize || members.length) * getAttacksPerMember(war, isCwl);
  const extra = `<p>⚔️ حمله‌ها: <b>${attacksUsed}/${maxAttacks}</b></p>`;
  const title = `🔥 روز نبرد شروع شد!${isCwl ? ' (CWL)' : ''}`;
  const html = await buildWarRichHtml(war, title, extra, war.__cwlMeta || null);
  await sendToGroup(bot, html);
  await tgLog.info('Notification sent: battle started' + (isCwl ? ' (CWL)' : ''), null, { module: 'WarMonitor' });
  await markNotification(warKey, event);
}

async function notifyOneHourLeft(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_one_hour_left' : 'one_hour_left';
  if (await hasNotification(warKey, event)) return;

  const end = parseClashTime(war.endTime);
  if (!end) return;

  const msLeft = end.getTime() - Date.now();
  // 50–70 minutes left → send once
  if (msLeft < 50 * 60 * 1000 || msLeft > 70 * 60 * 1000) return;

  const our = war.clan || {};
  const their = war.opponent || {};
  const ourName = stripEmojis(our.name || '—') || '—';
  const oppName = stripEmojis(their.name || '—') || '—';
  const members = extractMembers(war);
  const atkPer = getAttacksPerMember(war, isCwl);
  const attacksUsed = countAttacks(members);
  const teamSize = war.teamSize || members.length || 0;
  const maxAttacks = teamSize * atkPer;
  const ourStars = our.stars ?? 0;
  const maxStars = teamSize * 3;

  // Regular war: if all stars already secured, pending attackers are irrelevant
  let pendingHtml;
  let pendingCount = 0;
  if (!isCwl && teamSize > 0 && ourStars >= maxStars) {
    pendingHtml = '<p>✅ همه ستاره‌ها گرفته شده است.</p>';
  } else {
    pendingHtml = await buildPendingAttackersHtml(members, atkPer);
    pendingCount = getPendingAttackers(members, atkPer).length;
  }

  const dayLine =
    war.__cwlMeta && war.__cwlMeta.cwlDay
      ? `<p>📅 ${formatCwlDayLabel(war.__cwlMeta.cwlDay, war.__cwlMeta.cwlTotalDays)} لیگ کلن‌ها</p>`
      : '';

  const footer =
    pendingCount > 0
      ? '<p>حمله‌هاتون رو فراموش نکنید.</p>'
      : '';

  const html = `<h2>⏰ ۱ ساعت تا پایان وار${isCwl ? ' (CWL)' : ''}</h2>
${dayLine}
<table bordered striped compact>
<tr><th>کلن</th><th>ستاره</th><th>تخریب</th></tr>
<tr><td>🏰 ${escapeHtml(ourName)}</td><td>${ourStars} ⭐</td><td>${(our.destructionPercentage ?? 0).toFixed(1)}%</td></tr>
<tr><td>⚡ ${escapeHtml(oppName)}</td><td>${their.stars ?? 0} ⭐</td><td>${(their.destructionPercentage ?? 0).toFixed(1)}%</td></tr>
</table>
<p>⚔️ حمله‌ها: <b>${attacksUsed}/${maxAttacks}</b></p>
${pendingHtml}
${footer}`.trim();

  await sendToGroup(bot, html);
  await tgLog.info(
    'Notification sent: 1 hour left' +
      (isCwl ? ' (CWL)' : '') +
      ` — pending attackers: ${pendingCount}`,
    null,
    { module: 'WarMonitor' }
  );
  await markNotification(warKey, event);
}

async function notifyWarEndedFromSaved(bot, last, isCwl = false) {
  if (!last || !last.opponent_tag) return;
  const warKey = buildWarKeyFromSaved(last);
  if (!warKey) return;
  const event = isCwl ? 'cwl_war_ended' : 'war_ended';
  if (await hasNotification(warKey, event)) return;
  const ourStars = last.our_stars ?? 0;
  const theirStars = last.their_stars ?? 0;
  const ourDest = Number(last.our_destruction ?? 0);
  const theirDest = Number(last.their_destruction ?? 0);
  let result = 'tie';
  if (ourStars > theirStars) result = 'win';
  else if (ourStars < theirStars) result = 'lose';
  else if (ourDest > theirDest) result = 'win';
  else if (ourDest < theirDest) result = 'lose';
  const html = `<h2>🏁 وار به پایان رسید!${isCwl ? ' (CWL)' : ''}</h2>
<p><i>ربات هنگام پایان آفلاین بود؛ نتیجه از آخرین وضعیت ذخیره‌شده:</i></p>
<table bordered striped compact>
<tr><th>کلن</th><th>ستاره</th><th>تخریب</th></tr>
<tr><td>🏰 کلن ما</td><td>${ourStars} ⭐</td><td>${ourDest.toFixed(1)}%</td></tr>
<tr><td>⚡ حریف</td><td>${theirStars} ⭐</td><td>${theirDest.toFixed(1)}%</td></tr>
</table>
<p>نتیجه: <b>${resultLabel(result)}</b></p>`.trim();
  await sendToGroup(bot, html);
  await tgLog.info('Notification sent: war ended (from saved state)' + (isCwl ? ' (CWL)' : ''), null, { module: 'WarMonitor' });
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
  const extra = `<p>نتیجه: <b>${resultLabel(result)}</b></p>`;
  const title = `🏁 وار به پایان رسید!${isCwl ? ' (CWL)' : ''}`;
  const html = await buildWarRichHtml(war, title, extra, war.__cwlMeta || null);
  await sendToGroup(bot, html);
  await tgLog.info('Notification sent: war ended' + (isCwl ? ' (CWL)' : ''), null, { module: 'WarMonitor' });
  await markNotification(warKey, event);
}

async function checkRegularWar(bot) {
  const last = await getLastState();
  let war;
  try {
    war = await getCurrentWar();
  } catch (err) {
    if (err.isNotFound) war = { state: 'notInWar' };
    else throw err;
  }
  if (!war || war.state === 'notInWar') {
    if (last && !last.is_cwl && last.state && last.state !== 'notInWar') {
      await notifyWarEndedFromSaved(bot, last, false);
    }
    await saveState({ state: 'notInWar', isCwl: false, opponentTag: null, warTag: null, membersJson: null });
    return { state: 'notInWar', isCwl: false };
  }
  const members = extractMembers(war);
  if (war.state === 'preparation') await notifyPreparation(bot, war);
  if (war.state === 'inWar') {
    await notifyBattleStart(bot, war, false);
    await notifyOneHourLeft(bot, war, false);
  }
  if (war.state === 'warEnded') await notifyWarEnded(bot, war, false);
  await saveState({
    state: war.state,
    warTag: war.tag || null,
    opponentTag: war.opponent?.tag,
    teamSize: war.teamSize,
    preparationStart: war.preparationStartTime ? parseClashTime(war.preparationStartTime) : null,
    startTime: war.startTime ? parseClashTime(war.startTime) : null,
    endTime: war.endTime ? parseClashTime(war.endTime) : null,
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
  let found;
  try {
    found = await findOurCwlWar();
  } catch (err) {
    console.warn('[WarMonitor] CWL lookup failed:', err.message);
    await tgLog.warn('CWL lookup failed', err.message, { module: 'WarMonitor' });
    return null;
  }
  if (!found || !found.war) return null;
  const war = found.war;
  const meta = { cwlDay: found.cwlDay, cwlTotalDays: found.cwlTotalDays, cwlSeason: found.cwlSeason };
  war.__cwlMeta = meta;
  if (war.state === 'preparation') await notifyCwlLeagueStart(bot, war, meta);
  if (war.state === 'inWar') {
    await notifyBattleStart(bot, war, true);
    await notifyOneHourLeft(bot, war, true);
  }
  if (war.state === 'warEnded') await notifyWarEnded(bot, war, true);
  await saveState({
    state: war.state,
    warTag: war.tag || null,
    opponentTag: war.opponent?.tag,
    teamSize: war.teamSize,
    isCwl: true,
    ourStars: war.clan?.stars,
    theirStars: war.opponent?.stars,
    ourDestruction: war.clan?.destructionPercentage,
    theirDestruction: war.opponent?.destructionPercentage,
  });
  return war;
}

async function checkWarStatus(bot) {
  try {
    const war = await checkRegularWar(bot);
    const state = war?.state || 'unknown';
    const opp = war?.opponent?.name || war?.opponent?.tag || '-';
    console.log(`[WarMonitor] Check done — state=${state} opponent=${opp}`);
    await tgLog.debug(`War poll OK — state=${state}`, { opponent: String(opp).slice(0, 80) }, { module: 'WarMonitor' });
    if (state !== lastLoggedWarState) {
      lastLoggedWarState = state;
      await tgLog.info(`War state changed → ${state}`, { opponent: String(opp).slice(0, 80) }, { module: 'WarMonitor' });
    }
    await checkCwl(bot);
  } catch (err) {
    console.error('[WarMonitor] Error during check:', err.message);
    console.error(err.stack);
    await tgLog.error('War check failed', err.stack || err.message, { module: 'WarMonitor' });
  }
}

function startWarMonitor(bot) {
  console.log(`[WarMonitor] Starting with interval ${config.warPollIntervalMs}ms`);
  tgLog.info(`War monitor started (interval ${config.warPollIntervalMs}ms)`, null, { module: 'WarMonitor' });
  setTimeout(() => checkWarStatus(bot), 5000);
  const interval = setInterval(() => checkWarStatus(bot), config.warPollIntervalMs);
  if (global.__warMonitorInterval) clearInterval(global.__warMonitorInterval);
  global.__warMonitorInterval = interval;
  return interval;
}

function formatMembersList(members) {
  return (members || [])
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0))
    .map((m, i) => `${i + 1}. ${m.name || m.tag}`)
    .join('\n');
}

module.exports = {
  startWarMonitor,
  checkWarStatus,
  formatMembersList,
};
