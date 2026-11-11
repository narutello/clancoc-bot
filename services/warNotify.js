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
const { t, isRtl } = require('../utils/i18n');
const { getChatLanguage } = require('./settingsService');
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

async function groupLang() {
  if (!config.telegramGroupId) return 'fa';
  try {
    return await getChatLanguage(config.telegramGroupId);
  } catch {
    return 'fa';
  }
}

async function sendToGroup(bot, html, lang = 'fa') {
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
          rich_message: { html, is_rtl: isRtl(lang) },
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
            t('notify.fallback_plain', { lng: lang }),
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
  const lang = await groupLang();
  const title = t('notify.prep_title', { lng: lang });
  const html = await buildWarRichHtml(war, title, '', null, lang);
  await sendToGroup(bot, html, lang);
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
  const lang = await groupLang();
  const title = t('notify.cwl_league_start', { lng: lang });
  const html = await buildWarRichHtml(war, title, '', meta, lang);
  await sendToGroup(bot, html, lang);
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
  const lang = await groupLang();
  const members = extractMembers(war);
  const attacksUsed = countAttacks(members);
  const maxAttacks =
    (war.teamSize || members.length) * getAttacksPerMember(war, isCwl);
  const extra = `<p>${t('war.attacks_line', {
    lng: lang,
    used: attacksUsed,
    max: maxAttacks,
  })}</p>`;
  const title = isCwl
    ? t('notify.battle_start_cwl', { lng: lang })
    : t('notify.battle_start', { lng: lang });
  const html = await buildWarRichHtml(
    war,
    title,
    extra,
    war.__cwlMeta || null,
    lang
  );
  await sendToGroup(bot, html, lang);
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

  const lang = await groupLang();
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
    pendingHtml = `<p>${t('notify.pending_all_stars', { lng: lang })}</p>`;
  } else {
    pendingHtml = await buildPendingAttackersHtml(members, atkPer, lang);
    pendingCount = getPendingAttackers(members, atkPer).length;
  }

  const dayLine =
    war.__cwlMeta && war.__cwlMeta.cwlDay
      ? `<p>📅 ${formatCwlDayLabel(
          war.__cwlMeta.cwlDay,
          war.__cwlMeta.cwlTotalDays,
          lang
        )} CWL</p>`
      : '';

  const footer =
    pendingCount > 0
      ? `<p>${t('notify.pending_footer', { lng: lang })}</p>`
      : '';

  const title = isCwl
    ? t('notify.one_hour_cwl', { lng: lang })
    : t('notify.one_hour', { lng: lang });

  const html = `<h2>${title}</h2>
${dayLine}
<table bordered striped compact>
<tr><th>${t('common.clan', { lng: lang })}</th><th>${t('common.stars', { lng: lang })}</th><th>${t('common.destruction', { lng: lang })}</th></tr>
<tr><td>🏰 ${escapeHtml(ourName)}</td><td>${ourStars} ⭐</td><td>${(our.destructionPercentage ?? 0).toFixed(1)}%</td></tr>
<tr><td>⚡ ${escapeHtml(oppName)}</td><td>${their.stars ?? 0} ⭐</td><td>${(their.destructionPercentage ?? 0).toFixed(1)}%</td></tr>
</table>
<p>${t('war.attacks_line', { lng: lang, used: attacksUsed, max: maxAttacks })}</p>
${pendingHtml}
${footer}`.trim();

  await sendToGroup(bot, html, lang);
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
  const lang = await groupLang();
  const ourStars = last.our_stars ?? 0;
  const theirStars = last.their_stars ?? 0;
  const ourDest = Number(last.our_destruction ?? 0);
  const theirDest = Number(last.their_destruction ?? 0);
  let result = 'tie';
  if (ourStars > theirStars) result = 'win';
  else if (ourStars < theirStars) result = 'lose';
  else if (ourDest > theirDest) result = 'win';
  else if (ourDest < theirDest) result = 'lose';
  const title = isCwl
    ? t('notify.war_ended_cwl', { lng: lang })
    : t('notify.war_ended', { lng: lang });
  const html = `<h2>${title}</h2>
<p><i>${t('notify.offline_note', { lng: lang })}</i></p>
<table bordered striped compact>
<tr><th>${t('common.clan', { lng: lang })}</th><th>${t('common.stars', { lng: lang })}</th><th>${t('common.destruction', { lng: lang })}</th></tr>
<tr><td>🏰 ${t('common.our_clan', { lng: lang })}</td><td>${ourStars} ⭐</td><td>${ourDest.toFixed(1)}%</td></tr>
<tr><td>⚡ ${t('common.opponent', { lng: lang })}</td><td>${theirStars} ⭐</td><td>${theirDest.toFixed(1)}%</td></tr>
</table>
<p>${t('notify.result_line', {
    lng: lang,
    result: resultLabel(result, lang),
  })}</p>`.trim();
  await sendToGroup(bot, html, lang);
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
  const lang = await groupLang();
  const our = war.clan || {};
  const their = war.opponent || {};
  let result = 'tie';
  if ((our.stars || 0) > (their.stars || 0)) result = 'win';
  else if ((our.stars || 0) < (their.stars || 0)) result = 'lose';
  else if ((our.destructionPercentage || 0) > (their.destructionPercentage || 0))
    result = 'win';
  else if ((our.destructionPercentage || 0) < (their.destructionPercentage || 0))
    result = 'lose';
  const extra = `<p>${t('notify.result_line', {
    lng: lang,
    result: resultLabel(result, lang),
  })}</p>`;
  const title = isCwl
    ? t('notify.war_ended_cwl', { lng: lang })
    : t('notify.war_ended', { lng: lang });
  const html = await buildWarRichHtml(
    war,
    title,
    extra,
    war.__cwlMeta || null,
    lang
  );
  await sendToGroup(bot, html, lang);
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
  groupLang,
};
