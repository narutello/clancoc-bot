const { getCurrentWar } = require('../api/clash');
const { getLinksForTags } = require('../services/linkService');
const { findOurCwlWar, formatCwlDayLabel } = require('../services/cwlService');
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
const { checkCommandLimit } = require('../utils/commandRateLimit');
const { singleflight } = require('../utils/singleflight');
const { getCache, setCache } = require('../utils/ttlCache');
const { withTelegramRetry } = require('../utils/telegramSafe');

async function fetchActiveWar() {
  try {
    const war = await getCurrentWar();
    if (war && war.state && war.state !== 'notInWar') {
      return { war, isCwl: false, cwlDay: null, cwlTotalDays: null };
    }
  } catch (err) {
    if (!err.isNotFound) throw err;
  }

  try {
    return await findOurCwlWar();
  } catch (err) {
    if (!err.isNotFound) {
      console.warn('[/war] CWL lookup failed:', err.message);
    }
  }

  return null;
}

/** کش کوتاه + singleflight برای جلوگیری از درخواست تکراری/هم‌زمان */
async function resolveActiveWar() {
  const cacheKey = `activeWar:${config.clanTag}`;
  const cached = getCache(cacheKey);
  if (cached !== null) return cached;

  return singleflight(cacheKey, async () => {
    const again = getCache(cacheKey);
    if (again !== null) return again;
    const result = await fetchActiveWar();
    setCache(cacheKey, result, config.warCacheTtlMs);
    return result;
  });
}

function keyboardOur() {
  return {
    inline_keyboard: [[{ text: '👁 Enemy', callback_data: 'war:enemy' }]],
  };
}

function keyboardEnemy() {
  return {
    inline_keyboard: [[{ text: '↩️ Back', callback_data: 'war:home' }]],
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

async function buildOurHtml(resolved) {
  const { war, isCwl, cwlDay, cwlTotalDays } = resolved;
  const our = war.clan || {};
  const members = sortMembers(our.members).map((m) => ({
    ...m,
    bestOpponentAttack: m.bestOpponentAttack || null,
  }));
  const teamSize = war.teamSize || members.length;
  const atkPer = getAttacksPerMember(war, isCwl);
  const { attacksInfo, timeInfo } = buildTimeAndAttacks(war, members, teamSize, isCwl);
  const rows = await buildMemberRows(members, atkPer);

  return `
    ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, '⚔️ وضعیت وار')}
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

async function buildEnemyHtml(resolved) {
  const { war, isCwl, cwlDay, cwlTotalDays } = resolved;
  const opp = war.opponent || {};
  const members = sortMembers(opp.members).map((m) => ({
    ...m,
    bestOpponentAttack: m.bestOpponentAttack || null,
  }));

  if (!members.length) {
    return `
      ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, '⚡ تیم حریف')}
      <p>اطلاعات اعضای حریف در دسترس نیست.</p>
    `.trim();
  }

  const teamSize = war.teamSize || members.length;
  const atkPer = getAttacksPerMember(war, isCwl);
  const { attacksInfo, timeInfo } = buildTimeAndAttacks(war, members, teamSize, isCwl);
  const rows = await buildMemberRows(members, atkPer);
  const oppName = stripEmojis(opp.name || '—') || '—';

  return `
    ${clanHeaderHtml(war, isCwl, cwlDay, cwlTotalDays, '⚡ تیم حریف')}
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
    console.warn('[/war] editRichMessage failed:', err.message);
  }

  try {
    await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id);
  } catch (_) {}
  return sendRich(ctx, html, replyMarkup);
}

async function warCommand(ctx) {
  try {
    const userId = ctx.from?.id;
    const isOwner = userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'war', {
      limit: config.warCmdLimit,
      windowMs: config.warCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.reply(
        `⏳ تعداد درخواست‌های /war زیاد است.\n` +
          `لطفاً حدود <b>${limit.retryAfterSec}</b> ثانیه دیگر دوباره تلاش کنید.`,
        { parse_mode: 'HTML' }
      );
    }

    const resolved = await resolveActiveWar();
    if (!resolved || !resolved.war) {
      return ctx.reply('در حال حاضر کلن در وار نیست.');
    }

    const html = await buildOurHtml(resolved);
    return sendRich(ctx, html, keyboardOur());
  } catch (err) {
    console.error('[/war]', err.message);
    if (
      err.description?.includes('sendRichMessage') ||
      err.message?.includes('sendRichMessage')
    ) {
      return ctx.reply(
        '⚠️ نسخه فعلی کلاینت تلگرام از Rich Message پشتیبانی نمی‌کند.\nلطفاً تلگرام را آپدیت کنید.'
      );
    }
    return ctx.reply(`❌ خطا در دریافت اطلاعات وار: ${err.message}`);
  }
}

async function warEnemyAction(ctx) {
  try {
    const resolved = await resolveActiveWar();
    if (!resolved || !resolved.war) {
      return ctx.answerCbQuery('در حال حاضر کلن در وار نیست.', {
        show_alert: true,
      });
    }
    await ctx.answerCbQuery();
    const html = await buildEnemyHtml(resolved);
    return editRich(ctx, html, keyboardEnemy());
  } catch (err) {
    console.error('[war:enemy]', err.message);
    try {
      await ctx.answerCbQuery('خطا در دریافت اطلاعات حریف', { show_alert: true });
    } catch (_) {}
  }
}

async function warHomeAction(ctx) {
  try {
    const resolved = await resolveActiveWar();
    if (!resolved || !resolved.war) {
      return ctx.answerCbQuery('در حال حاضر کلن در وار نیست.', {
        show_alert: true,
      });
    }
    await ctx.answerCbQuery();
    const html = await buildOurHtml(resolved);
    return editRich(ctx, html, keyboardOur());
  } catch (err) {
    console.error('[war:home]', err.message);
    try {
      await ctx.answerCbQuery('خطا در بازگشت', { show_alert: true });
    } catch (_) {}
  }
}

module.exports = warCommand;
module.exports.warEnemyAction = warEnemyAction;
module.exports.warHomeAction = warHomeAction;
