const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');
const { withTelegramRetry } = require('../utils/telegramSafe');
const {
  escapeHtml,
  resultLabel,
  parseClashTime,
  stripEmojis,
  getAttacksPerMember,
} = require('../utils/helpers');
const { formatCwlDayLabel, buildCwlLeagueKey } = require('./cwlService');
const {
  hasNotification,
  markNotification,
  buildWarKey,
  buildWarKeyFromSaved,
} = require('./warState');
const {
  extractMembers,
  countAttacks,
  getPendingAttackers,
  buildPendingAttackersHtml,
  buildWarRichHtml,
} = require('./warHtml');

async function sendToGroup(bot, html) {
  if (!config.telegramGroupId) {
    console.warn('[WarMonitor] TELEGRAM_GROUP_ID not set, skipping notification');
    await tgLog.warn(
      'TELEGRAM_GROUP_ID not set; group notification skipped',
      null,
      { module: 'WarMonitor' }
    );
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
    await tgLog.error('Failed to send rich message to group', err.message, {
      module: 'WarMonitor',
    });
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
      await tgLog.error('Fallback group message also failed', e2.message, {
        module: 'WarMonitor',
      });
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
  await tgLog.info('Notification sent: preparation started', null, {
    module: 'WarMonitor',
  });
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
  await tgLog.info(
    'Notification sent: CWL league start (day 1 preparation)',
    null,
    { module: 'WarMonitor' }
  );
  await markNotification(leagueKey, event);
}

async function notifyBattleStart(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_battle_start' : 'battle_start';
  if (await hasNotification(warKey, event)) return;
  const members = extractMembers(war);
  const attacksUsed = countAttacks(members);
  const maxAttacks =
    (war.teamSize || members.length) * getAttacksPerMember(war, isCwl);
  const extra = `<p>⚔️ حمله‌ها: <b>${attacksUsed}/${maxAttacks}</b></p>`;
  const title = `🔥 روز نبرد شروع شد!${isCwl ? ' (CWL)' : ''}`;
  const html = await buildWarRichHtml(war, title, extra, war.__cwlMeta || null);
  await sendToGroup(bot, html);
  await tgLog.info(
    'Notification sent: battle started' + (isCwl ? ' (CWL)' : ''),
    null,
    { module: 'WarMonitor' }
  );
  await markNotification(warKey, event);
}

async function notifyOneHourLeft(bot, war, isCwl = false) {
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_one_hour_left' : 'one_hour_left';
  if (await hasNotification(warKey, event)) return;

  const end = parseClashTime(war.endTime);
  if (!end) return;

  const msLeft = end.getTime() - Date.now();
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
    pendingCount > 0 ? '<p>حمله‌هاتون رو فراموش نکنید.</p>' : '';

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
  await tgLog.info(
    'Notification sent: war ended (from saved state)' + (isCwl ? ' (CWL)' : ''),
    null,
    { module: 'WarMonitor' }
  );
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
  const html = await buildWarRichHtml(war, title, extra, war.__cwlMeta || null);
  await sendToGroup(bot, html);
  await tgLog.info(
    'Notification sent: war ended' + (isCwl ? ' (CWL)' : ''),
    null,
    { module: 'WarMonitor' }
  );
  await markNotification(warKey, event);
}

module.exports = {
  sendToGroup,
  notifyPreparation,
  notifyCwlLeagueStart,
  notifyBattleStart,
  notifyOneHourLeft,
  notifyWarEndedFromSaved,
  notifyWarEnded,
};
