const config = require('../config');
const { query } = require('../database');
const { getCurrentWar, getClan } = require('../api/clash');
const { findOurCwlWar, buildCwlLeagueKey } = require('../services/cwlService');
const { getLinksForTags } = require('../services/linkService');
const { getMonitorStats } = require('../services/monitorStats');
const {
  escapeHtml,
  stripEmojis,
  parseClashTime,
  getAttacksPerMember,
  normalizeTag,
} = require('../utils/helpers');
const {
  sendLoading,
  replaceLoadingText,
} = require('../utils/loading');

function isOwner(ctx) {
  const id = ctx.from?.id;
  return id != null && Number(id) === Number(config.ownerTelegramId);
}

function formatUptime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function formatAgo(date) {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h ago`;
}

function warStateEn(state) {
  const map = {
    notInWar: 'Not in war',
    preparation: 'Preparation',
    inWar: 'In war',
    warEnded: 'War ended',
    ended: 'Ended',
  };
  return map[state] || String(state || 'unknown');
}

function cwlDayEn(day, total) {
  if (!day) return 'CWL';
  if (total) return `Day ${day}/${total}`;
  return `Day ${day}`;
}

function formatTimeEn(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
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
    return ctx.reply('⛔️ This command is owner-only.');
  }

  const loadingMsg = await sendLoading(ctx, '⏳ Loading status...');

  try {
    const mon = getMonitorStats();
    const lines = [];
    lines.push('🟢 <b>Bot online</b>');
    lines.push(`⏱ Uptime: ~${escapeHtml(formatUptime(process.uptime()))}`);

    const nextSec =
      mon.nextPollMs != null ? Math.round(mon.nextPollMs / 1000) : null;
    lines.push(
      `📡 Adaptive poll: idle ${Math.round(config.warPollIdleMs / 1000)}s · active ${Math.round(config.warPollActiveMs / 1000)}s · near ${Math.round(config.warPollNearMs / 1000)}s`
    );
    if (nextSec != null) {
      lines.push(
        `⏭ Next poll: ~${nextSec}s (<code>${escapeHtml(mon.adaptiveReason || '—')}</code>)`
      );
    }
    if (mon.lastPollAt) {
      lines.push(
        `🔄 Last poll: ${escapeHtml(formatAgo(mon.lastPollAt))} ${mon.lastPollOk === false ? '❌' : '✅'}`
      );
    }

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
      lines.push(`🔄 Last state update: ${escapeHtml(formatAgo(lastCheck))}`);
    }

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
    lines.push('── <b>War</b> ──');

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
          lines.push(`⚠️ War fetch error: ${escapeHtml(err.message)}`);
        }
      }
    }

    if (!activeWar) {
      lines.push('Clan is not in war right now.');
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
          `⚔️ Type: <b>CWL</b> · ${escapeHtml(
            cwlDayEn(cwlMeta.cwlDay, cwlMeta.cwlTotalDays)
          )}`
        );
      } else {
        lines.push('⚔️ Type: <b>Regular war</b>');
      }
      lines.push(`⏳ State: <b>${escapeHtml(warStateEn(activeWar.state))}</b>`);
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
        const formatted = formatTimeEn(start);
        if (formatted) lines.push(`🕐 Battle starts: ${escapeHtml(formatted)} (Tehran)`);
      } else if (activeWar.state === 'inWar') {
        const end = parseClashTime(activeWar.endTime);
        const formatted = formatTimeEn(end);
        if (formatted) lines.push(`🕐 War ends: ${escapeHtml(formatted)} (Tehran)`);
      }

      lines.push(`⚔️ Attacks: <b>${used}/${maxAtk}</b>`);
      lines.push(`⚠️ Incomplete attacks: <b>${pending}</b> player(s)`);

      try {
        const tags = members.map((m) => m.tag).filter(Boolean);
        const map = await getLinksForTags(tags);
        let linked = 0;
        for (const t of tags) {
          if ((map.get(t) || []).length > 0) linked += 1;
        }
        lines.push(`📋 Linked war members: <b>${linked}/${tags.length}</b>`);
      } catch (_) {}

      lines.push('');
      lines.push('── <b>Notifications (this war)</b> ──');
      const warKey = buildWarKey(activeWar);
      if (isCwl) {
        const leagueKey = buildCwlLeagueKey(cwlMeta?.cwlSeason);
        const prep = await notificationMark(leagueKey, 'cwl_league_preparation');
        const start = await notificationMark(warKey, 'cwl_battle_start');
        const hour = await notificationMark(warKey, 'cwl_one_hour_left');
        const ended = await notificationMark(warKey, 'cwl_war_ended');
        lines.push(`${prep} League preparation (day 1)`);
        lines.push(`${start} Battle start (this day)`);
        lines.push(`${hour} 1 hour left`);
        lines.push(`${ended} War ended`);
      } else {
        const prep = await notificationMark(warKey, 'preparation');
        const start = await notificationMark(warKey, 'battle_start');
        const hour = await notificationMark(warKey, 'one_hour_left');
        const ended = await notificationMark(warKey, 'war_ended');
        lines.push(`${prep} Preparation / opponent found`);
        lines.push(`${start} Battle start`);
        lines.push(`${hour} 1 hour left`);
        lines.push(`${ended} War ended`);
      }
    }

    lines.push('');
    lines.push('── <b>Links</b> ──');
    try {
      const users = await countRows('SELECT COUNT(*)::int AS c FROM telegram_users');
      const links = await countRows('SELECT COUNT(*)::int AS c FROM user_accounts');
      const accounts = await countRows('SELECT COUNT(*)::int AS c FROM clash_accounts');
      lines.push(`👤 Telegram users: <b>${users}</b>`);
      lines.push(`🎮 Clash accounts: <b>${accounts}</b>`);
      lines.push(`🔗 User↔account links: <b>${links}</b>`);
    } catch (err) {
      lines.push(`⚠️ Link counts failed: ${escapeHtml(err.message)}`);
    }

    lines.push('');
    lines.push('── <b>Technical (Owner)</b> ──');
    lines.push(
      `📣 TELEGRAM_GROUP_ID: ${config.telegramGroupId ? 'set' : '❌ not set'}`
    );
    lines.push(
      `📝 LOG_TELEGRAM_ID: ${config.logTelegramId ? 'set' : '❌ not set'}`
    );
    lines.push(`🏷 CLAN_TAG: <code>#${escapeHtml(config.clanTag)}</code>`);
    lines.push(
      `🧠 Rate /war: ${config.warCmdLimit} per ${Math.round(config.warCmdWindowMs / 1000)}s`
    );
    lines.push(
      `🧠 Rate /cwl: ${config.cwlCmdLimit} per ${Math.round(config.cwlCmdWindowMs / 1000)}s`
    );
    lines.push(`💾 War cache TTL: ${config.warCacheTtlMs}ms`);
    lines.push(`📊 Monitor polls: ${mon.pollCount} · errors: ${mon.errorCount}`);

    return replaceLoadingText(ctx, loadingMsg, lines.join(String.fromCharCode(10)), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('[/status]', err.message);
    return replaceLoadingText(
      ctx,
      loadingMsg,
      `❌ Status failed: ${err.message}`
    );
  }
};
