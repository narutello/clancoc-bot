const { getLinksForTags } = require('../services/linkService');
const { formatCwlDayLabel } = require('../services/cwlService');
const {
  escapeHtml,
  warStateLabel,
  normalizeTag,
  tgUserLink,
  stripEmojis,
  formatWarTime,
  parseClashTime,
  getAttacksPerMember,
} = require('../utils/helpers');
const config = require('../config');
const { withTelegramRetry } = require('../utils/telegramSafe');
const { t, isRtl, DEFAULT_LANG } = require('../utils/i18n');

function keyboardOur(prefix, lang = DEFAULT_LANG) {
  const row = [
    { text: t('war.btn_enemy', { lng: lang }), callback_data: `${prefix}:enemy` },
  ];
  if (prefix === 'cwl') {
    row.push({
      text: t('war.btn_standings', { lng: lang }),
      callback_data: 'cwl:standings',
    });
  }
  return { inline_keyboard: [row] };
}

function keyboardEnemy(prefix, lang = DEFAULT_LANG) {
  return {
    inline_keyboard: [
      [{ text: t('war.btn_back', { lng: lang }), callback_data: `${prefix}:home` }],
    ],
  };
}

function keyboardStandings(lang = DEFAULT_LANG) {
  return {
    inline_keyboard: [
      [{ text: t('war.btn_back', { lng: lang }), callback_data: 'cwl:home' }],
    ],
  };
}

function sortMembers(list) {
  return (list || [])
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0));
}

function buildTimeAndAttacks(war, members, teamSize, isCwl = false, lang = DEFAULT_LANG) {
  const used = members.reduce((sum, m) => sum + (m.attacks || []).length, 0);
  const max = teamSize * getAttacksPerMember(war, isCwl);

  const attacksInfo =
    war.state === 'inWar' || war.state === 'warEnded'
      ? `<p>${t('war.attacks_line', { lng: lang, used, max })}</p>`
      : '';

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

  return { attacksInfo, timeInfo };
}

async function buildMemberRows(members, attacksPerMember) {
  const tags = members.map((m) => normalizeTag(m.tag));
  const linksMap = await getLinksForTags(tags);
  const atkMax = attacksPerMember || 2;

  return members
    .map((member, index) => {
      const attacks = member.attacks || [];
      const stars = attacks.reduce((sum, a) => sum + (a.stars || 0), 0);
      const defStars = member.bestOpponentAttack?.stars ?? 0;
      const tag = normalizeTag(member.tag);
      const links = linksMap.get(tag) || [];

      let nameCell;
      if (links.length > 0) {
        nameCell = links
          .map((u) => tgUserLink(u.telegram_id, member.name))
          .join(' / ');
      } else {
        nameCell = escapeHtml(member.name || '—');
      }

      const th = member.townhallLevel ?? member.townHallLevel ?? '—';
      const rowNum = index + 1;
      return `
        <tr>
          <td>${rowNum}</td>
          <td>${nameCell}</td>
          <td>${th}</td>
          <td>${attacks.length}/${atkMax}</td>
          <td>${stars} ⭐</td>
          <td>${defStars} ⭐</td>
        </tr>
      `;
    })
    .join('');
}

function clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, title, lang = DEFAULT_LANG) {
  const our = war.clan || {};
  const opp = war.opponent || {};
  const ourName = stripEmojis(our.name || '—') || '—';
  const oppName = stripEmojis(opp.name || '—') || '—';
  const cwlBadge = isCwl ? ' (CWL)' : '';
  const dayLabel = isCwl ? formatCwlDayLabel(cwlDay, cwlTotalDays, lang) : '';
  const dayLine = dayLabel
    ? `<p>${t('cwl.day_line', { lng: lang, dayLabel })}</p>`
    : '';

  return `
    <h2>${title}${cwlBadge}</h2>
    ${dayLine}
    <table bordered striped compact>
      <tr>
        <th>${t('common.clan', { lng: lang })}</th>
        <th>${t('common.stars', { lng: lang })}</th>
        <th>${t('common.destruction', { lng: lang })}</th>
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
  `;
}

async function buildOurHtml(resolved, title, lang = DEFAULT_LANG) {
  const heading = title || t('war.title', { lng: lang });
  const { war, isCwl, cwlDay, cwlTotalDays } = resolved;
  const our = war.clan || {};
  const members = sortMembers(our.members).map((m) => ({
    ...m,
    bestOpponentAttack: m.bestOpponentAttack || null,
  }));
  const teamSize = war.teamSize || members.length;
  const atkPer = getAttacksPerMember(war, isCwl);
  const { attacksInfo, timeInfo } = buildTimeAndAttacks(
    war,
    members,
    teamSize,
    isCwl,
    lang
  );
  const rows = await buildMemberRows(members, atkPer);

  return `
    ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, heading, lang)}
    <p>
      ${t('war.team_size', { lng: lang, size: teamSize })}<br/>
      ${t('war.state_line', {
        lng: lang,
        state: warStateLabel(war.state, lang),
      })}
    </p>
    ${timeInfo}
    ${attacksInfo}
    <h3>${t('war.members_heading', { lng: lang })}</h3>
    <table bordered striped compact>
      <tr>
        <th>${t('common.rank', { lng: lang })}</th>
        <th>${t('common.player', { lng: lang })}</th>
        <th>${t('common.th', { lng: lang })}</th>
        <th>${t('common.attack', { lng: lang })}</th>
        <th>${t('common.stars', { lng: lang })}</th>
        <th>${t('common.defense', { lng: lang })}</th>
      </tr>
      ${rows}
    </table>
  `.trim();
}

async function buildEnemyHtml(resolved, title, lang = DEFAULT_LANG) {
  const heading = title || t('war.enemy_title', { lng: lang });
  const { war, isCwl, cwlDay, cwlTotalDays } = resolved;
  const opp = war.opponent || {};
  const members = sortMembers(opp.members).map((m) => ({
    ...m,
    bestOpponentAttack: m.bestOpponentAttack || null,
  }));

  if (!members.length) {
    return `
      ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, heading, lang)}
      <p>${t('war.enemy_missing', { lng: lang })}</p>
    `.trim();
  }

  const teamSize = war.teamSize || members.length;
  const atkPer = getAttacksPerMember(war, isCwl);
  const { attacksInfo, timeInfo } = buildTimeAndAttacks(
    war,
    members,
    teamSize,
    isCwl,
    lang
  );
  const rows = await buildMemberRows(members, atkPer);
  const oppName = stripEmojis(opp.name || '—') || '—';

  return `
    ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, heading, lang)}
    <p>
      🏷 <b>${escapeHtml(oppName)}</b><br/>
      ${t('war.team_size', { lng: lang, size: teamSize })}<br/>
      ${t('war.state_line', {
        lng: lang,
        state: warStateLabel(war.state, lang),
      })}
    </p>
    ${timeInfo}
    ${attacksInfo}
    <h3>${t('war.enemy_heading', { lng: lang })}</h3>
    <table bordered striped compact>
      <tr>
        <th>${t('common.rank', { lng: lang })}</th>
        <th>${t('common.player', { lng: lang })}</th>
        <th>${t('common.th', { lng: lang })}</th>
        <th>${t('common.attack', { lng: lang })}</th>
        <th>${t('common.stars', { lng: lang })}</th>
        <th>${t('common.defense', { lng: lang })}</th>
      </tr>
      ${rows}
    </table>
  `.trim();
}

function buildStandingsHtml(data, lang = DEFAULT_LANG) {
  if (!data || !data.standings || !data.standings.length) {
    return `<h2>${t('cwl.standings_title', { lng: lang })}</h2><p>${t(
      'cwl.standings_empty',
      { lng: lang }
    )}</p>`;
  }

  const rows = data.standings
    .map((row) => {
      const name = escapeHtml(row.name || row.tag);
      const label = row.isOurs ? `<b>🏰 ${name}</b>` : name;
      const starsLabel =
        row.bonusStars > 0
          ? `${row.stars} ⭐ <i>(${row.attackStars}+${row.bonusStars})</i>`
          : `${row.stars} ⭐`;
      return `<tr>
        <td>${row.rank}</td>
        <td>${label}</td>
        <td>${starsLabel}</td>
        <td>${(row.destruction || 0).toFixed(1)}%</td>
      </tr>`;
    })
    .join('');

  const seasonLine = data.season
    ? `<p>${t('cwl.season', {
        lng: lang,
        season: escapeHtml(String(data.season)),
      })}</p>`
    : '';

  return `
    <h2>${t('cwl.standings_title', { lng: lang })}</h2>
    ${seasonLine}
    <p>${t('cwl.standings_note', { lng: lang })}</p>
    <table bordered striped compact>
      <tr>
        <th>${t('common.rank', { lng: lang })}</th>
        <th>${t('common.clan', { lng: lang })}</th>
        <th>${t('common.stars', { lng: lang })}</th>
        <th>${t('common.destruction', { lng: lang })}</th>
      </tr>
      ${rows}
    </table>
    <p><i>${t('cwl.standings_cache', { lng: lang })}</i></p>
  `.trim();
}

async function sendRich(ctx, html, replyMarkup, lang = DEFAULT_LANG) {
  return withTelegramRetry(
    () =>
      ctx.telegram.callApi('sendRichMessage', {
        chat_id: ctx.chat.id,
        rich_message: { html, is_rtl: isRtl(lang) },
        reply_markup: replyMarkup,
      }),
    { maxRetries: config.telegramMaxRetries }
  );
}

async function editRich(ctx, html, replyMarkup, lang = DEFAULT_LANG) {
  const msg = ctx.callbackQuery?.message;
  if (!msg) {
    return sendRich(ctx, html, replyMarkup, lang);
  }

  try {
    await withTelegramRetry(
      () =>
        ctx.telegram.callApi('editRichMessage', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          rich_message: { html, is_rtl: isRtl(lang) },
          reply_markup: replyMarkup,
        }),
      { maxRetries: config.telegramMaxRetries }
    );
    return;
  } catch (err) {
    console.warn('[warView] editRichMessage failed:', err.message);
  }

  try {
    await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id);
  } catch (_) {}
  return sendRich(ctx, html, replyMarkup, lang);
}

function richMessageErrorReply(ctx, err, fallbackMsg) {
  if (
    err.description?.includes('sendRichMessage') ||
    err.message?.includes('sendRichMessage')
  ) {
    return ctx.reply(ctx.t ? ctx.t('war.rich_unsupported') : fallbackMsg);
  }
  return ctx.reply(fallbackMsg);
}

module.exports = {
  keyboardOur,
  keyboardEnemy,
  keyboardStandings,
  buildOurHtml,
  buildEnemyHtml,
  buildStandingsHtml,
  sendRich,
  editRich,
  richMessageErrorReply,
};
