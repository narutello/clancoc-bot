const config = require('../config');
const { query } = require('../database');
const { getCurrentWar, getClan } = require('../api/clash');
const { findOurCwlWar, formatCwlDayLabel, buildCwlLeagueKey } = require('../services/cwlService');
const { getLinksForTags } = require('../services/linkService');
const {
  escapeHtml,
  stripEmojis,
  warStateLabel,
  parseClashTime,
  formatWarTime,
  getAttacksPerMember,
  normalizeTag,
} = require('../utils/helpers');

function isOwner(ctx) {
  const id = ctx.from?.id;
  return id != null && Number(id) === Number(config.ownerTelegramId);
}

function formatUptime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}س ${m}د`;
  if (m > 0) return `${m}د ${r}ث`;
  return `${r}ث`;
}

function formatAgo(date) {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}ث پیش`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}د پیش`;
  const h = Math.floor(min / 60);
  return `${h}س پیش`;
}

function buildWarKey(war) {
  if (!war || war.state === 'notInWar') return null;
  const opp = normalizeTag(war.opponent?.tag || 'unknown');
  const start =
    parseClashTime(war.preparationStartTime) || parseClashTime(war.startTime);
  const t = start ? start.getTime() : 0;
  return `${opp}_${t}`;
}

async function notificationMark(warKey, eventType) {
  if (!warKey) return '—';
  const res = await query(
    `SELECT 1 FROM war_notifications WHERE war_key = $1 AND event_type = $2 LIMIT 1`,
    [warKey, eventType]
  );
  return res.rowCount > 0 ? '✅' : '❌';
}

async function countRows(sql) {
  const res = await query(sql);
  return Number(res.rows[0]?.c || 0);
}

module.exports = async function statusCommand(ctx) {
  if (!isOwner(ctx)) {
    return ctx.reply('⛔️ این دستور فقط برای Owner در دسترس است.');
  }

  const lines = [];
  lines.push('🟢 <b>ربات آنلاین</b>');
  lines.push(`⏱ Uptime: حدود ${escapeHtml(formatUptime(process.uptime()))}`);
  lines.push(`📡 Polling: هر ${Math.round(config.warPollIntervalMs / 1000)} ثانیه`);

  // DB health + last war_state update
  let dbOk = false;
  let lastCheck = null;
  try {
    const res = await query(`SELECT updated_at FROM war_state WHERE id = 1`);
    dbOk = true;
    lastCheck = res.rows[0]?.updated_at || null;
  } catch (err) {
    dbOk = false;
    lines.push(`🗄 Database: ❌ ${escapeHtml(err.message)}`);
  }
  if (dbOk) {
    lines.push('🗄 Database: OK');
    lines.push(`🔄 آخرین به‌روزرسانی state: ${escapeHtml(formatAgo(lastCheck))}`);
  }

  // Clash API probe
  let apiOk = false;
  let apiErr = null;
  try {
    await getClan();
    apiOk = true;
  } catch (err) {
    apiErr = err.message;
  }
  lines.push(
    apiOk
      ? '🎮 Clash API: OK'
      : `🎮 Clash API: ❌ ${escapeHtml(apiErr || 'error')}`
  );

  lines.push('');
  lines.push('── <b>وار</b> ──');

  let activeWar = null;
  let isCwl = false;
  let cwlMeta = null;

  try {
    const cwl = await findOurCwlWar();
    if (cwl && cwl.war && cwl.war.state && cwl.war.state !== 'notInWar') {
      activeWar = cwl.war;
      isCwl = true;
      cwlMeta = {
        cwlDay: cwl.cwlDay,
        cwlTotalDays: cwl.cwlTotalDays,
        cwlSeason: cwl.cwlSeason,
      };
    }
  } catch (_) {}

  if (!activeWar) {
    try {
      const war = await getCurrentWar();
      if (war && war.state && war.state !== 'notInWar') {
        activeWar = war;
        isCwl = false;
      }
    } catch (err) {
      if (!err.isNotFound) {
        lines.push(`⚠️ خطا در دریافت وار: ${escapeHtml(err.message)}`);
      }
    }
  }

  if (!activeWar) {
    lines.push('در حال حاضر کلن در وار نیست.');
  } else {
    const our = activeWar.clan || {};
    const opp = activeWar.opponent || {};
    const ourName = stripEmojis(our.name || '—') || '—';
    const oppName = stripEmojis(opp.name || '—') || '—';
    const members = (our.members || []).map((m) => ({
      tag: normalizeTag(m.tag),
      attacks: m.attacks || [],
      mapPosition: m.mapPosition,
    }));
    const atkPer = getAttacksPerMember(activeWar, isCwl);
    const used = members.reduce((s, m) => s + (m.attacks || []).length, 0);
    const maxAtk = (activeWar.teamSize || members.length) * atkPer;
    const pending = members.filter((m) => (m.attacks || []).length < atkPer).length;

    if (isCwl && cwlMeta) {
      lines.push(
        `⚔️ نوع: <b>CWL</b> · ${escapeHtml(
          formatCwlDayLabel(cwlMeta.cwlDay, cwlMeta.cwlTotalDays)
        )}`
      );
    } else {
      lines.push('⚔️ نوع: <b>وار معمولی</b>');
    }
    lines.push(`⏳ وضعیت: <b>${escapeHtml(warStateLabel(activeWar.state))}</b>`);
    lines.push(
      `🏰 ${escapeHtml(ourName)} · ${our.stars ?? 0}⭐ · ${(our.destructionPercentage ?? 0).toFixed(1)}%`
    );
    lines.push(
      `⚡ ${escapeHtml(oppName)} · ${opp.stars ?? 0}⭐ · ${(opp.destructionPercentage ?? 0).toFixed(1)}%`
    );

    if (activeWar.state === 'preparation') {
      const start =
        parseClashTime(activeWar.startTime) ||
        parseClashTime(activeWar.preparationStartTime);
      const formatted = formatWarTime(start);
      if (formatted) lines.push(`🕐 شروع نبرد: ${escapeHtml(formatted)}`);
    } else if (activeWar.state === 'inWar') {
      const end = parseClashTime(activeWar.endTime);
      const formatted = formatWarTime(end);
      if (formatted) lines.push(`🕐 پایان وار: ${escapeHtml(formatted)}`);
    }

    lines.push(`⚔️ حمله‌ها: <b>${used}/${maxAtk}</b>`);
    lines.push(`⚠️ بدون حمله کامل: <b>${pending}</b> نفر`);

    // Linked war members
    try {
      const tags = members.map((m) => m.tag).filter(Boolean);
      const map = await getLinksForTags(tags);
      let linked = 0;
      for (const t of tags) {
        if ((map.get(t) || []).length > 0) linked += 1;
      }
      lines.push(`📋 اعضای وار لینک‌شده: <b>${linked}/${tags.length}</b>`);
    } catch (_) {}

    lines.push('');
    lines.push('── <b>اعلان‌های این وار</b> ──');
    const warKey = buildWarKey(activeWar);
    if (isCwl) {
      const leagueKey = buildCwlLeagueKey(cwlMeta?.cwlSeason);
      const prep = await notificationMark(leagueKey, 'cwl_league_preparation');
      const start = await notificationMark(warKey, 'cwl_battle_start');
      const hour = await notificationMark(warKey, 'cwl_one_hour_left');
      const ended = await notificationMark(warKey, 'cwl_war_ended');
      lines.push(`${prep} آماده‌سازی لیگ (روز۱)`);
      lines.push(`${start} شروع نبرد این روز`);
      lines.push(`${hour} ۱ ساعت مانده`);
      lines.push(`${ended} پایان وار`);
    } else {
      const prep = await notificationMark(warKey, 'preparation');
      const start = await notificationMark(warKey, 'battle_start');
      const hour = await notificationMark(warKey, 'one_hour_left');
      const ended = await notificationMark(warKey, 'war_ended');
      lines.push(`${prep} آماده‌سازی / پیدا شدن حریف`);
      lines.push(`${start} شروع نبرد`);
      lines.push(`${hour} ۱ ساعت مانده`);
      lines.push(`${ended} پایان وار`);
    }
  }

  lines.push('');
  lines.push('── <b>لینک‌ها</b> ──');
  try {
    const users = await countRows('SELECT COUNT(*)::int AS c FROM telegram_users');
    const links = await countRows('SELECT COUNT(*)::int AS c FROM user_accounts');
    const accounts = await countRows('SELECT COUNT(*)::int AS c FROM clash_accounts');
    lines.push(`👤 کاربران تلگرام: <b>${users}</b>`);
    lines.push(`🎮 اکانت کلش ثبت‌شده: <b>${accounts}</b>`);
    lines.push(`🔗 لینک کاربر↔اکانت: <b>${links}</b>`);
  } catch (err) {
    lines.push(`⚠️ شمارش لینک‌ها ناموفق: ${escapeHtml(err.message)}`);
  }

  lines.push('');
  lines.push('── <b>فنی (Owner)</b> ──');
  lines.push(
    `📣 TELEGRAM_GROUP_ID: ${config.telegramGroupId ? 'ست شده' : '❌ ست نشده'}`
  );
  lines.push(
    `📝 LOG_TELEGRAM_ID: ${config.logTelegramId ? 'ست شده' : '❌ ست نشده'}`
  );
  lines.push(`🏷 CLAN_TAG: <code>#${escapeHtml(config.clanTag)}</code>`);
  lines.push(
    `🧠 Rate /war: ${config.warCmdLimit} در ${Math.round(config.warCmdWindowMs / 1000)}ث`
  );
  lines.push(
    `🧠 Rate /cwl: ${config.cwlCmdLimit} در ${Math.round(config.cwlCmdWindowMs / 1000)}ث`
  );
  lines.push(`💾 War cache TTL: ${config.warCacheTtlMs}ms`);

  return ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
};
