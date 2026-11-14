const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');
const { withTelegramRetry } = require('../utils/telegramSafe');
const {
  escapeHtml,
  resultLabel,
  parseClashTime,
  stripEmojis,
  getAttacksPerMember,
  formatTag,
  tgUserLink,
} = require('../utils/helpers');
const { t, isRtl } = require('../utils/i18n');
const { getChatLanguage, isNotifyEnabled } = require('./settingsService');
const { formatCwlDayLabel, buildCwlLeagueKey } = require('./cwlService');
const {
  claimNotification,
  releaseNotification,
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
const { getLinksForTags } = require('./linkService');

async function groupLang() {
  if (!config.telegramGroupId) return 'fa';
  try {
    return await getChatLanguage(config.telegramGroupId);
  } catch {
    return 'fa';
  }
}

async function groupNotifyEnabled(scope, key) {
  if (!config.telegramGroupId) return true;
  try {
    return await isNotifyEnabled(config.telegramGroupId, scope, key);
  } catch {
    return true;
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
    return false;
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
    return true;
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
      return true;
    } catch (e2) {
      console.error('[WarMonitor] Fallback also failed:', e2.message);
      await tgLog.error('Fallback group message also failed', e2.message, {
        module: 'WarMonitor',
      });
      return false;
    }
  }
}

async function sendClaimed(bot, html, lang, warKey, event) {
  const sent = await sendToGroup(bot, html, lang);
  if (!sent) {
    try {
      await releaseNotification(warKey, event);
      console.warn(
        `[WarMonitor] Released claim after send failure: ${event} (${warKey})`
      );
    } catch (err) {
      console.warn('[WarMonitor] releaseNotification failed:', err.message);
    }
  }
  return sent;
}

async function notifyPreparation(bot, war) {
  if (!(await groupNotifyEnabled('war', 'preparation'))) return;
  const warKey = buildWarKey(war);
  const event = 'preparation';
  if (!(await claimNotification(warKey, event))) return;
  const lang = await groupLang();
  const title = t('notify.prep_title', { lng: lang });
  const html = await buildWarRichHtml(war, title, '', null, lang);
  const sent = await sendClaimed(bot, html, lang, warKey, event);
  if (sent) {
    await tgLog.info('Notification sent: preparation started', null, {
      module: 'WarMonitor',
    });
  }
}

async function notifyCwlLeagueStart(bot, war, meta) {
  if (!meta || meta.cwlDay !== 1) return;
  if (!war || war.state !== 'preparation') return;
  if (!(await groupNotifyEnabled('cwl', 'preparation'))) return;
  const leagueKey = buildCwlLeagueKey(meta.cwlSeason);
  const event = 'cwl_league_preparation';
  if (!(await claimNotification(leagueKey, event))) return;
  const lang = await groupLang();
  const title = t('notify.cwl_league_start', { lng: lang });
  const html = await buildWarRichHtml(war, title, '', meta, lang);
  const sent = await sendClaimed(bot, html, lang, leagueKey, event);
  if (sent) {
    await tgLog.info(
      'Notification sent: CWL league start (day 1 preparation)',
      null,
      { module: 'WarMonitor' }
    );
  }
}

async function notifyBattleStart(bot, war, isCwl = false) {
  const scope = isCwl ? 'cwl' : 'war';
  if (!(await groupNotifyEnabled(scope, 'battle_start'))) return;
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_battle_start' : 'battle_start';
  if (!(await claimNotification(warKey, event))) return;
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
  const sent = await sendClaimed(bot, html, lang, warKey, event);
  if (sent) {
    await tgLog.info(
      'Notification sent: battle started' + (isCwl ? ' (CWL)' : ''),
      null,
      { module: 'WarMonitor' }
    );
  }
}

async function notifyOneHourLeft(bot, war, isCwl = false) {
  const scope = isCwl ? 'cwl' : 'war';
  if (!(await groupNotifyEnabled(scope, 'one_hour_left'))) return;
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_one_hour_left' : 'one_hour_left';

  const end = parseClashTime(war.endTime);
  if (!end) return;

  const msLeft = end.getTime() - Date.now();
  if (msLeft < 50 * 60 * 1000 || msLeft > 70 * 60 * 1000) return;

  if (!(await claimNotification(warKey, event))) return;

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

  const sent = await sendClaimed(bot, html, lang, warKey, event);
  if (sent) {
    await tgLog.info(
      'Notification sent: 1 hour left' +
        (isCwl ? ' (CWL)' : '') +
        ` — pending attackers: ${pendingCount}`,
      null,
      { module: 'WarMonitor' }
    );
  }
}

async function notifyWarEndedFromSaved(bot, last, isCwl = false) {
  if (!last || !last.opponent_tag) return;
  const scope = isCwl ? 'cwl' : 'war';
  if (!(await groupNotifyEnabled(scope, 'war_ended'))) return;
  const warKey = buildWarKeyFromSaved(last);
  if (!warKey) return;
  const event = isCwl ? 'cwl_war_ended' : 'war_ended';
  if (!(await claimNotification(warKey, event))) return;
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
  const sent = await sendClaimed(bot, html, lang, warKey, event);
  if (sent) {
    await tgLog.info(
      'Notification sent: war ended (from saved state)' + (isCwl ? ' (CWL)' : ''),
      null,
      { module: 'WarMonitor' }
    );
  }
}

async function notifyWarEnded(bot, war, isCwl = false) {
  const scope = isCwl ? 'cwl' : 'war';
  if (!(await groupNotifyEnabled(scope, 'war_ended'))) return;
  const warKey = buildWarKey(war);
  const event = isCwl ? 'cwl_war_ended' : 'war_ended';
  if (!(await claimNotification(warKey, event))) return;
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
  const sent = await sendClaimed(bot, html, lang, warKey, event);
  if (sent) {
    await tgLog.info(
      'Notification sent: war ended' + (isCwl ? ' (CWL)' : ''),
      null,
      { module: 'WarMonitor' }
    );
  }
}

/** Diff previous vs current members to find newly landed attacks. */
function findNewAttacks(prevMembers, nextMembers) {
  const prevMap = new Map();
  for (const m of prevMembers || []) {
    if (!m?.tag) continue;
    prevMap.set(m.tag, (m.attacks || []).length);
  }
  const found = [];
  for (const m of nextMembers || []) {
    if (!m?.tag) continue;
    const prevCount = prevMap.get(m.tag) || 0;
    const attacks = m.attacks || [];
    const nowCount = attacks.length;
    if (nowCount <= prevCount) continue;
    for (let i = prevCount; i < nowCount; i++) {
      found.push({
        member: m,
        attack: attacks[i] || {},
        attackIndex: i + 1,
      });
    }
  }
  return found;
}

async function notifyNewAttacks(bot, war, prevMembers, isCwl = false) {
  const scope = isCwl ? 'cwl' : 'war';
  if (!(await groupNotifyEnabled(scope, 'attack'))) return;
  if (!war || war.state !== 'inWar') return;

  const nextMembers = extractMembers(war);
  const news = findNewAttacks(prevMembers, nextMembers);
  if (news.length === 0) return;

  const warKey = buildWarKey(war);
  const lang = await groupLang();
  const tags = news.map((n) => n.member.tag).filter(Boolean);
  let linksMap = new Map();
  try {
    linksMap = await getLinksForTags(tags);
  } catch (_) {}

  for (const item of news) {
    const tag = item.member.tag;
    const event = `attack:${tag}:${item.attackIndex}`;
    if (!(await claimNotification(warKey, event))) continue;

    const name = escapeHtml(item.member.name || formatTag(tag));
    const stars = item.attack.stars ?? 0;
    const dest =
      item.attack.destructionPercentage != null
        ? Number(item.attack.destructionPercentage).toFixed(1)
        : '—';
    const th = item.member.townhallLevel ?? item.member.townHallLevel ?? '—';

    let who = name;
    const links = linksMap.get(tag) || [];
    if (links.length > 0) {
      who = links
        .map((u) =>
          tgUserLink(
            u.telegram_id,
            item.member.name || formatTag(tag)
          )
        )
        .join(' / ');
    }

    const title = isCwl
      ? t('notify.attack_title_cwl', { lng: lang })
      : t('notify.attack_title', { lng: lang });

    const html = `<h2>${title}</h2>
<p>⚔️ ${who}</p>
<p>🏠 TH ${th} · ⭐ ${stars} · 💥 ${dest}%</p>
<p><code>${formatTag(tag)}</code></p>`.trim();

    const sent = await sendClaimed(bot, html, lang, warKey, event);
    if (sent) {
      await tgLog.info(
        `Notification sent: attack by ${tag}` + (isCwl ? ' (CWL)' : ''),
        null,
        { module: 'WarMonitor' }
      );
    }
  }
}

module.exports = {
  sendToGroup,
  notifyPreparation,
  notifyCwlLeagueStart,
  notifyBattleStart,
  notifyOneHourLeft,
  notifyWarEndedFromSaved,
  notifyWarEnded,
  notifyNewAttacks,
  findNewAttacks,
  groupLang,
};
