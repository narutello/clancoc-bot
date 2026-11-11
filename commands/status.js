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
  warStateLabel,
  formatWarTime,
} = require('../utils/helpers');
const { formatCwlDayLabel } = require('../services/cwlService');
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

function formatAgo(date, t) {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return t('status.ago_sec', { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t('status.ago_min', { n: min });
  const h = Math.floor(min / 60);
  return t('status.ago_hour', { n: h });
}

function buildWarKey(war) {
  if (!war || war.state === 'notInWar') return null;
  const opp = normalizeTag(war.opponent?.tag || 'unknown');
  const start =
    parseClashTime(war.preparationStartTime) || parseClashTime(war.startTime);
  const ts = start ? start.getTime() : 0;
  return `${opp}_${ts}`;
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
    return ctx.reply(ctx.t('status.owner_only'));
  }

  const t = ctx.t.bind(ctx);
  const lang = ctx.lang || 'fa';
  const loadingMsg = await sendLoading(ctx, t('status.loading'));

  try {
    const mon = getMonitorStats();
    const lines = [];
    lines.push(t('status.online'));
    lines.push(t('status.uptime', { uptime: formatUptime(process.uptime()) }));

    lines.push(
      t('status.poll_adaptive', {
        idle: Math.round(config.warPollIdleMs / 1000),
        active: Math.round(config.warPollActiveMs / 1000),
        near: Math.round(config.warPollNearMs / 1000),
      })
    );

    if (mon.nextPollMs != null) {
      lines.push(
        t('status.next_poll', {
          sec: Math.round(mon.nextPollMs / 1000),
          reason: mon.adaptiveReason || '—',
        })
      );
    }
    if (mon.lastPollAt) {
      lines.push(
        t('status.last_poll', {
          ago: formatAgo(mon.lastPollAt, t),
          ok: mon.lastPollOk === false ? '❌' : '✅',
        })
      );
    }

    let dbOk = false;
    let lastCheck = null;
    try {
      const res = await query(`SELECT updated_at FROM war_state WHERE id = 1`);
      dbOk = true;
      lastCheck = res.rows[0]?.updated_at || null;
    } catch (err) {
      lines.push(t('status.db_fail', { message: escapeHtml(err.message) }));
    }
    if (dbOk) {
      lines.push(t('status.db_ok'));
      lines.push(t('status.last_state', { ago: formatAgo(lastCheck, t) }));
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
        ? t('status.api_ok')
        : t('status.api_fail', { message: escapeHtml(apiErr || 'error') })
    );

    lines.push('');
    lines.push(t('status.section_war'));

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
          lines.push(
            t('status.war_fetch_err', { message: escapeHtml(err.message) })
          );
        }
      }
    }

    if (!activeWar) {
      lines.push(t('status.not_in_war'));
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
      const pending = members.filter((m) => (m.attacks || []).length < atkPer)
        .length;

      if (isCwl && cwlMeta) {
        lines.push(
          t('status.type_cwl', {
            day: formatCwlDayLabel(
              cwlMeta.cwlDay,
              cwlMeta.cwlTotalDays,
              lang
            ),
          })
        );
      } else {
        lines.push(t('status.type_regular'));
      }
      lines.push(
        t('status.state', {
          state: warStateLabel(activeWar.state, lang),
        })
      );
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
        const formatted = formatWarTime(start, lang);
        if (formatted) {
          lines.push(t('status.battle_starts', { time: formatted }));
        }
      } else if (activeWar.state === 'inWar') {
        const end = parseClashTime(activeWar.endTime);
        const formatted = formatWarTime(end, lang);
        if (formatted) {
          lines.push(t('status.war_ends', { time: formatted }));
        }
      }

      lines.push(t('status.attacks', { used, max: maxAtk }));
      lines.push(t('status.incomplete', { count: pending }));

      try {
        const tags = members.map((m) => m.tag).filter(Boolean);
        const map = await getLinksForTags(tags);
        let linked = 0;
        for (const x of tags) {
          if ((map.get(x) || []).length > 0) linked += 1;
        }
        lines.push(
          t('status.linked_members', { linked, total: tags.length })
        );
      } catch (_) {}

      lines.push('');
      lines.push(t('status.section_notif'));
      const warKey = buildWarKey(activeWar);
      if (isCwl) {
        const leagueKey = buildCwlLeagueKey(cwlMeta?.cwlSeason);
        const prep = await notificationMark(leagueKey, 'cwl_league_preparation');
        const start = await notificationMark(warKey, 'cwl_battle_start');
        const hour = await notificationMark(warKey, 'cwl_one_hour_left');
        const ended = await notificationMark(warKey, 'cwl_war_ended');
        lines.push(`${prep} ${t('status.n_league_prep')}`);
        lines.push(`${start} ${t('status.n_battle_start')}`);
        lines.push(`${hour} ${t('status.n_one_hour')}`);
        lines.push(`${ended} ${t('status.n_war_ended')}`);
      } else {
        const prep = await notificationMark(warKey, 'preparation');
        const start = await notificationMark(warKey, 'battle_start');
        const hour = await notificationMark(warKey, 'one_hour_left');
        const ended = await notificationMark(warKey, 'war_ended');
        lines.push(`${prep} ${t('status.n_prep')}`);
        lines.push(`${start} ${t('status.n_battle')}`);
        lines.push(`${hour} ${t('status.n_one_hour')}`);
        lines.push(`${ended} ${t('status.n_war_ended')}`);
      }
    }

    lines.push('');
    lines.push(t('status.section_links'));
    try {
      const users = await countRows(
        'SELECT COUNT(*)::int AS c FROM telegram_users'
      );
      const links = await countRows(
        'SELECT COUNT(*)::int AS c FROM user_accounts'
      );
      const accounts = await countRows(
        'SELECT COUNT(*)::int AS c FROM clash_accounts'
      );
      lines.push(t('status.tg_users', { n: users }));
      lines.push(t('status.clash_accounts', { n: accounts }));
      lines.push(t('status.user_links', { n: links }));
    } catch (err) {
      lines.push(
        t('status.links_fail', { message: escapeHtml(err.message) })
      );
    }

    lines.push('');
    lines.push(t('status.section_tech'));
    lines.push(
      config.telegramGroupId ? t('status.group_set') : t('status.group_missing')
    );
    lines.push(
      config.logTelegramId ? t('status.log_set') : t('status.log_missing')
    );
    lines.push(t('status.clan_tag', { tag: escapeHtml(config.clanTag) }));
    lines.push(
      t('status.rate_war', {
        limit: config.warCmdLimit,
        sec: Math.round(config.warCmdWindowMs / 1000),
      })
    );
    lines.push(
      t('status.rate_cwl', {
        limit: config.cwlCmdLimit,
        sec: Math.round(config.cwlCmdWindowMs / 1000),
      })
    );
    lines.push(t('status.cache_ttl', { ms: config.warCacheTtlMs }));
    lines.push(
      t('status.monitor_stats', {
        polls: mon.pollCount,
        errors: mon.errorCount,
      })
    );

    return replaceLoadingText(
      ctx,
      loadingMsg,
      lines.join(String.fromCharCode(10)),
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }
    );
  } catch (err) {
    console.error('[/status]', err.message);
    return replaceLoadingText(
      ctx,
      loadingMsg,
      t('status.failed', { message: err.message })
    );
  }
};
