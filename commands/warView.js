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

function keyboardOur(prefix) {
  const row = [{ text: '👁 Enemy', callback_data: `${prefix}:enemy` }];
  if (prefix === 'cwl') {
    row.push({ text: '🏆 جدول', callback_data: 'cwl:standings' });
  }
  return {
    inline_keyboard: [row],
  };
}

function keyboardEnemy(prefix) {
  return {
    inline_keyboard: [[{ text: '↩️ Back', callback_data: `${prefix}:home` }]],
  };
}

function keyboardStandings() {
  return {
    inline_keyboard: [[{ text: '↩️ Back', callback_data: 'cwl:home' }]],
  };
}

function sortMembers(list) {
  return (list || [])
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0));
}

function buildTimeAndAttacks(war, members, teamSize, isCwl = false) {
  const used = members.reduce((sum, m) => sum + (m.attacks || []).length, 0);
  const max = teamSize * getAttacksPerMember(war, isCwl);

  const attacksInfo =
    war.state === 'inWar' || war.state === 'warEnded'
      ? `<p>⚔️ حمله‌ها: <b>${used}/${max}</b></p>`
      : '';

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

function clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, title) {
  const our = war.clan || {};
  const opp = war.opponent || {};
  const ourName = stripEmojis(our.name || '—') || '—';
  const oppName = stripEmojis(opp.name || '—') || '—';
  const cwlBadge = isCwl ? ' (CWL)' : '';
  const dayLabel = isCwl ? formatCwlDayLabel(cwlDay, cwlTotalDays) : '';
  const dayLine = dayLabel
    ? `<p>📅 <b>${escapeHtml(dayLabel)}</b> لیگ کلن‌ها</p>`
    : '';

  return `
    <h2>${title}${cwlBadge}</h2>
    ${dayLine}
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
  `;
}

async function buildOurHtml(resolved, title = '⚔️ وضعیت وار') {
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
    isCwl
  );
  const rows = await buildMemberRows(members, atkPer);

  return `
    ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, title)}
    <p>
      👥 ${teamSize}v${teamSize}<br/>
      ⏳ وضعیت: <b>${escapeHtml(warStateLabel(war.state))}</b>
    </p>
    ${timeInfo}
    ${attacksInfo}
    <h3>📋 اعضای وار</h3>
    <table bordered striped compact>
      <tr>
        <th>#</th>
        <th>بازیکن</th>
        <th>TH</th>
        <th>حمله</th>
        <th>ستاره</th>
        <th>دفاع</th>
      </tr>
      ${rows}
    </table>
  `.trim();
}

async function buildEnemyHtml(resolved, title = '⚡ تیم حریف') {
  const { war, isCwl, cwlDay, cwlTotalDays } = resolved;
  const opp = war.opponent || {};
  const members = sortMembers(opp.members).map((m) => ({
    ...m,
    bestOpponentAttack: m.bestOpponentAttack || null,
  }));

  if (!members.length) {
    return `
      ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, title)}
      <p>اطلاعات اعضای حریف در دسترس نیست.</p>
    `.trim();
  }

  const teamSize = war.teamSize || members.length;
  const atkPer = getAttacksPerMember(war, isCwl);
  const { attacksInfo, timeInfo } = buildTimeAndAttacks(
    war,
    members,
    teamSize,
    isCwl
  );
  const rows = await buildMemberRows(members, atkPer);
  const oppName = stripEmojis(opp.name || '—') || '—';

  return `
    ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, title)}
    <p>
      🏷 <b>${escapeHtml(oppName)}</b><br/>
      👥 ${teamSize}v${teamSize}<br/>
      ⏳ وضعیت: <b>${escapeHtml(warStateLabel(war.state))}</b>
    </p>
    ${timeInfo}
    ${attacksInfo}
    <h3>📋 اعضای حریف</h3>
    <table bordered striped compact>
      <tr>
        <th>#</th>
        <th>بازیکن</th>
        <th>TH</th>
        <th>حمله</th>
        <th>ستاره</th>
        <th>دفاع</th>
      </tr>
      ${rows}
    </table>
  `.trim();
}

function buildStandingsHtml(data) {
  if (!data || !data.standings || !data.standings.length) {
    return '<h2>🏆 جدول لیگ</h2><p>اطلاعات جدول در دسترس نیست.</p>';
  }

  const rows = data.standings
    .map((row) => {
      const name = escapeHtml(row.name || row.tag);
      const mark = row.isOurs ? ' fort' : '';
      const label = row.isOurs ? `<b>🏰 ${name}</b>` : name;
      const starsLabel =
        row.bonusStars > 0
          ? `${row.stars} ⭐ <i>(${row.attackStars}+${row.bonusStars})</i>`
          : `${row.stars} ⭐`;
      return `<tr${mark}>
        <td>${row.rank}</td>
        <td>${label}</td>
        <td>${starsLabel}</td>
        <td>${(row.destruction || 0).toFixed(1)}%</td>
      </tr>`;
    })
    .join('');

  const seasonLine = data.season
    ? `<p>📅 فصل: <b>${escapeHtml(String(data.season))}</b></p>`
    : '';

  return `
    <h2>🏆 جدول لیگ کلن‌ها</h2>
    ${seasonLine}
    <p>رتبه‌بندی بر اساس ستاره (شامل +۱۰ برد)، سپس تخریب.</p>
    <table bordered striped compact>
      <tr>
        <th>#</th>
        <th>کلن</th>
        <th>ستاره</th>
        <th>تخریب</th>
      </tr>
      ${rows}
    </table>
    <p><i>کش تا حدود ۱۰ دقیقه — برای کم‌کردن فشار API.</i></p>
  `.trim();
}

async function sendRich(ctx, html, replyMarkup) {
  return withTelegramRetry(
    () =>
      ctx.telegram.callApi('sendRichMessage', {
        chat_id: ctx.chat.id,
        rich_message: { html, is_rtl: true },
        reply_markup: replyMarkup,
      }),
    { maxRetries: config.telegramMaxRetries }
  );
}

async function editRich(ctx, html, replyMarkup) {
  const msg = ctx.callbackQuery?.message;
  if (!msg) {
    return sendRich(ctx, html, replyMarkup);
  }

  try {
    await withTelegramRetry(
      () =>
        ctx.telegram.callApi('editRichMessage', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          rich_message: { html, is_rtl: true },
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
  return sendRich(ctx, html, replyMarkup);
}

function richMessageErrorReply(ctx, err, fallbackMsg) {
  if (
    err.description?.includes('sendRichMessage') ||
    err.message?.includes('sendRichMessage')
  ) {
    return ctx.reply(
      '⚠️ نسخه فعلی کلاینت تلگرام از Rich Message پشتیبانی نمی‌کند.\nلطفاً تلگرام را آپدیت کنید.'
    );
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
