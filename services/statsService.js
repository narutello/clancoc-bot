const { query } = require('../database');
const config = require('../config');
const { getClan } = require('../api/clash');
const {
  normalizeTag,
  parseClashTime,
  getAttacksPerMember,
  stripEmojis,
  escapeHtml,
} = require('../utils/helpers');
const {
  buildWarKey,
  buildWarKeyFromSaved,
  hasNotification,
  markNotification,
} = require('./warState');
const { t, DEFAULT_LANG } = require('../utils/i18n');
const { formatReportText } = require('./reportFormat');
const { tgLog } = require('../utils/telegramLogger');

const SNAPSHOT_MIN_GAP_MS = 20 * 60 * 60 * 1000;
const RETENTION_MIN_GAP_MS = 24 * 60 * 60 * 1000;

let lastSnapshotAt = 0;
let lastRetentionAt = 0;

function tehranParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
  };
}

function monthKeyFromDate(date = new Date()) {
  const p = tehranParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function previousMonthKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return null;
  const d = new Date(Date.UTC(y, m - 2, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function parseMonthArg(raw) {
  if (!raw) return monthKeyFromDate();
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const [y, m] = s.split('-').map(Number);
  if (m < 1 || m > 12) return null;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function warResult(ourStars, theirStars, ourDest, theirDest) {
  const os = Number(ourStars) || 0;
  const ts = Number(theirStars) || 0;
  const od = Number(ourDest) || 0;
  const td = Number(theirDest) || 0;
  if (os > ts) return 'win';
  if (os < ts) return 'lose';
  if (od > td) return 'win';
  if (od < td) return 'lose';
  return 'tie';
}

function playerRowsFromWar(war, isCwl) {
  const members = war?.clan?.members || [];
  const atkMax = getAttacksPerMember(war, Boolean(isCwl));
  return members.map((m) => {
    const attacks = m.attacks || [];
    const stars = attacks.reduce((s, a) => s + (a.stars || 0), 0);
    const destruction = attacks.reduce(
      (s, a) => s + (Number(a.destructionPercentage) || 0),
      0
    );
    const defStars = m.bestOpponentAttack?.stars ?? 0;
    return {
      playerTag: normalizeTag(m.tag),
      playerName: m.name || null,
      mapPosition: m.mapPosition ?? null,
      thLevel: m.townhallLevel ?? m.townHallLevel ?? null,
      attacksUsed: attacks.length,
      attacksMax: atkMax,
      stars,
      attackDestruction: destruction,
      defenseStars: defStars,
    };
  });
}

function playerRowsFromSaved(last) {
  let members = last?.members_json;
  if (typeof members === 'string') {
    try {
      members = JSON.parse(members);
    } catch {
      members = null;
    }
  }
  if (!Array.isArray(members) || !members.length) return [];
  const isCwl = Boolean(last.is_cwl);
  const atkMax = isCwl ? 1 : 2;
  return members.map((m) => {
    const attacks = m.attacks || [];
    const stars = attacks.reduce((s, a) => s + (a.stars || 0), 0);
    const destruction = attacks.reduce(
      (s, a) => s + (Number(a.destructionPercentage) || 0),
      0
    );
    const defStars = m.bestOpponentAttack?.stars ?? 0;
    return {
      playerTag: normalizeTag(m.tag),
      playerName: m.name || null,
      mapPosition: m.mapPosition ?? null,
      thLevel: m.townhallLevel ?? null,
      attacksUsed: attacks.length,
      attacksMax: atkMax,
      stars,
      attackDestruction: destruction,
      defenseStars: defStars,
    };
  });
}

async function insertWarRecord(row, players) {
  const existing = await query(
    `SELECT 1 FROM recorded_wars WHERE war_key = $1`,
    [row.warKey]
  );
  if (existing.rowCount > 0) {
    return { inserted: false, warKey: row.warKey };
  }

  await query(
    `INSERT INTO recorded_wars (
      war_key, month_key, is_cwl, opponent_tag, opponent_name, team_size,
      result, our_stars, their_stars, our_destruction, their_destruction, ended_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (war_key) DO NOTHING`,
    [
      row.warKey,
      row.monthKey,
      row.isCwl,
      row.opponentTag,
      row.opponentName,
      row.teamSize,
      row.result,
      row.ourStars,
      row.theirStars,
      row.ourDestruction,
      row.theirDestruction,
      row.endedAt,
    ]
  );

  for (const p of players) {
    if (!p.playerTag) continue;
    await query(
      `INSERT INTO war_player_stats (
        war_key, player_tag, player_name, map_position, th_level,
        attacks_used, attacks_max, stars, attack_destruction, defense_stars
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (war_key, player_tag) DO NOTHING`,
      [
        row.warKey,
        p.playerTag,
        p.playerName,
        p.mapPosition,
        p.thLevel,
        p.attacksUsed,
        p.attacksMax,
        p.stars,
        p.attackDestruction,
        p.defenseStars,
      ]
    );
  }

  return { inserted: true, warKey: row.warKey };
}

async function recordFinishedWar(war, { isCwl = false } = {}) {
  if (!war || war.state !== 'warEnded') return { inserted: false };
  const warKey = buildWarKey(war);
  if (!warKey || warKey === 'notInWar') return { inserted: false };

  const end =
    parseClashTime(war.endTime) || parseClashTime(war.startTime) || new Date();
  const our = war.clan || {};
  const opp = war.opponent || {};
  const row = {
    warKey,
    monthKey: monthKeyFromDate(end),
    isCwl: Boolean(isCwl),
    opponentTag: normalizeTag(opp.tag) || null,
    opponentName: stripEmojis(opp.name || '') || opp.name || null,
    teamSize: war.teamSize || (our.members || []).length || null,
    result: warResult(
      our.stars,
      opp.stars,
      our.destructionPercentage,
      opp.destructionPercentage
    ),
    ourStars: our.stars ?? 0,
    theirStars: opp.stars ?? 0,
    ourDestruction: Number(our.destructionPercentage) || 0,
    theirDestruction: Number(opp.destructionPercentage) || 0,
    endedAt: end,
  };
  const players = playerRowsFromWar(war, isCwl);
  try {
    const res = await insertWarRecord(row, players);
    if (res.inserted) {
      console.log(
        `[Stats] Recorded war ${warKey} (${row.monthKey}) players=${players.length}`
      );
      await tgLog.info(
        `Stats: recorded war ${row.result} vs ${row.opponentName || row.opponentTag}`,
        { warKey, monthKey: row.monthKey, isCwl: row.isCwl },
        { module: 'Stats' }
      );
    }
    return res;
  } catch (err) {
    console.error('[Stats] recordFinishedWar failed:', err.message);
    await tgLog.warn('Stats recordFinishedWar failed', err.message, {
      module: 'Stats',
    });
    return { inserted: false, error: err.message };
  }
}

async function recordFinishedWarFromSaved(last, isCwl = false) {
  if (!last || !last.opponent_tag) return { inserted: false };
  const warKey = buildWarKeyFromSaved(last);
  if (!warKey) return { inserted: false };

  const end = last.end_time ? new Date(last.end_time) : new Date();
  const row = {
    warKey,
    monthKey: monthKeyFromDate(end),
    isCwl: Boolean(isCwl || last.is_cwl),
    opponentTag: normalizeTag(last.opponent_tag),
    opponentName: null,
    teamSize: last.team_size || null,
    result: warResult(
      last.our_stars,
      last.their_stars,
      last.our_destruction,
      last.their_destruction
    ),
    ourStars: last.our_stars ?? 0,
    theirStars: last.their_stars ?? 0,
    ourDestruction: Number(last.our_destruction) || 0,
    theirDestruction: Number(last.their_destruction) || 0,
    endedAt: end,
  };
  const players = playerRowsFromSaved(last);
  try {
    return await insertWarRecord(row, players);
  } catch (err) {
    console.error('[Stats] recordFinishedWarFromSaved failed:', err.message);
    return { inserted: false, error: err.message };
  }
}

async function maybeSnapshotMembers() {
  const now = Date.now();
  if (lastSnapshotAt && now - lastSnapshotAt < SNAPSHOT_MIN_GAP_MS) {
    return { skipped: true, reason: 'gap' };
  }

  try {
    const recent = await query(
      `SELECT snapshot_at FROM member_snapshots ORDER BY snapshot_at DESC LIMIT 1`
    );
    if (recent.rows[0]?.snapshot_at) {
      const age = now - new Date(recent.rows[0].snapshot_at).getTime();
      if (age < SNAPSHOT_MIN_GAP_MS) {
        lastSnapshotAt = now;
        return { skipped: true, reason: 'db_gap' };
      }
    }

    const clan = await getClan();
    const members = clan.memberList || clan.members || [];
    if (!Array.isArray(members) || !members.length) {
      return { skipped: true, reason: 'no_members' };
    }

    const monthKey = monthKeyFromDate();
    let n = 0;
    for (const m of members) {
      const tag = normalizeTag(m.tag);
      if (!tag) continue;
      await query(
        `INSERT INTO member_snapshots (
          month_key, player_tag, player_name, donations, donations_received, th_level, trophies
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          monthKey,
          tag,
          m.name || null,
          m.donations ?? 0,
          m.donationsReceived ?? 0,
          m.townHallLevel ?? m.townhallLevel ?? null,
          m.trophies ?? 0,
        ]
      );
      n += 1;
    }
    lastSnapshotAt = now;
    console.log(`[Stats] Member snapshot saved (${n} players)`);
    return { skipped: false, count: n };
  } catch (err) {
    console.error('[Stats] snapshot failed:', err.message);
    return { skipped: true, error: err.message };
  }
}

async function getDonationLeaders(monthKey, limit = 5) {
  const res = await query(
    `SELECT player_tag, player_name, donations, donations_received, snapshot_at
     FROM member_snapshots
     WHERE month_key = $1
     ORDER BY snapshot_at ASC`,
    [monthKey]
  );
  const byTag = new Map();
  for (const row of res.rows) {
    const tag = row.player_tag;
    if (!byTag.has(tag)) {
      byTag.set(tag, {
        tag,
        name: row.player_name,
        firstDon: Number(row.donations) || 0,
        lastDon: Number(row.donations) || 0,
        firstRec: Number(row.donations_received) || 0,
        lastRec: Number(row.donations_received) || 0,
      });
    } else {
      const e = byTag.get(tag);
      e.name = row.player_name || e.name;
      e.lastDon = Number(row.donations) || 0;
      e.lastRec = Number(row.donations_received) || 0;
    }
  }

  const list = [];
  for (const e of byTag.values()) {
    let donated = e.lastDon - e.firstDon;
    let received = e.lastRec - e.firstRec;
    if (donated < 0) donated = e.lastDon;
    if (received < 0) received = e.lastRec;
    list.push({
      tag: e.tag,
      name: e.name || e.tag,
      donated,
      received,
    });
  }

  const byDonated = [...list].sort((a, b) => b.donated - a.donated).slice(0, limit);
  const byReceived = [...list]
    .sort((a, b) => b.received - a.received)
    .slice(0, limit);
  return { byDonated, byReceived, samplePlayers: byTag.size };
}

async function buildMonthlyReport(monthKey) {
  const wars = await query(
    `SELECT * FROM recorded_wars WHERE month_key = $1 ORDER BY ended_at ASC NULLS LAST`,
    [monthKey]
  );
  const warRows = wars.rows;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let cwlCount = 0;
  let starsFor = 0;
  let starsAgainst = 0;

  for (const w of warRows) {
    if (w.result === 'win') wins += 1;
    else if (w.result === 'lose') losses += 1;
    else ties += 1;
    if (w.is_cwl) cwlCount += 1;
    starsFor += Number(w.our_stars) || 0;
    starsAgainst += Number(w.their_stars) || 0;
  }

  const players = await query(
    `SELECT
       player_tag,
       MAX(player_name) AS player_name,
       COUNT(*)::int AS wars,
       COALESCE(SUM(stars),0)::int AS stars,
       COALESCE(SUM(attacks_used),0)::int AS attacks,
       COALESCE(SUM(defense_stars),0)::int AS defense_stars
     FROM war_player_stats wps
     JOIN recorded_wars rw ON rw.war_key = wps.war_key
     WHERE rw.month_key = $1
     GROUP BY player_tag
     ORDER BY stars DESC, attacks DESC`,
    [monthKey]
  );

  const topStars = players.rows.slice(0, 5);
  const topAttacks = [...players.rows]
    .sort((a, b) => b.attacks - a.attacks || b.stars - a.stars)
    .slice(0, 5);

  const donations = await getDonationLeaders(monthKey, 5);

  return {
    monthKey,
    wars: warRows.length,
    wins,
    losses,
    ties,
    cwlCount,
    starsFor,
    starsAgainst,
    topStars,
    topAttacks,
    donations,
    warRows,
  };
}

async function runRetention() {
  const now = Date.now();
  if (lastRetentionAt && now - lastRetentionAt < RETENTION_MIN_GAP_MS) {
    return { skipped: true };
  }
  const months = Math.max(1, Number(config.statsRetentionMonths) || 6);
  try {
    const wars = await query(
      `DELETE FROM recorded_wars
       WHERE month_key < to_char(
         (NOW() AT TIME ZONE 'Asia/Tehran') - make_interval(months => $1),
         'YYYY-MM'
       )
       RETURNING war_key`,
      [months]
    );
    const snaps = await query(
      `DELETE FROM member_snapshots
       WHERE snapshot_at < (NOW() AT TIME ZONE 'Asia/Tehran') - make_interval(months => $1)
       RETURNING id`,
      [months]
    );
    lastRetentionAt = now;
    const w = wars.rowCount || 0;
    const s = snaps.rowCount || 0;
    if (w || s) {
      console.log(`[Stats] Retention removed wars=${w} snapshots=${s}`);
    }
    return { skipped: false, wars: w, snapshots: s };
  } catch (err) {
    console.error('[Stats] retention failed:', err.message);
    return { skipped: true, error: err.message };
  }
}

async function maybeAnnouncePreviousMonth(bot, sendToGroup) {
  const parts = tehranParts();
  if (parts.day > 2) return { skipped: true, reason: 'not_first_days' };

  const current = monthKeyFromDate();
  const prev = previousMonthKey(current);
  if (!prev) return { skipped: true };

  const event = 'monthly_report';
  const key = `month:${prev}`;
  if (await hasNotification(key, event)) {
    return { skipped: true, reason: 'already' };
  }

  const report = await buildMonthlyReport(prev);
  if (!report.wars && report.donations.samplePlayers === 0) {
    await markNotification(key, event);
    return { skipped: true, reason: 'empty' };
  }

  const { groupLang } = require('./warNotify');
  const lang = await groupLang();
  const text = formatReportText(report, lang);
  const html = `<h2>${t('report.auto_title', {
    lng: lang,
    month: prev,
  })}</h2><p>${text.replace(/\n/g, '<br/>')}</p>`;

  try {
    if (typeof sendToGroup === 'function') {
      await sendToGroup(bot, html, lang);
    }
    await markNotification(key, event);
    await tgLog.info(`Monthly report sent for ${prev}`, null, {
      module: 'Stats',
    });
    return { skipped: false, monthKey: prev };
  } catch (err) {
    console.error('[Stats] monthly announce failed:', err.message);
    return { skipped: true, error: err.message };
  }
}

async function runStatsMaintenance(bot) {
  await maybeSnapshotMembers();
  await runRetention();
  try {
    const { sendToGroup } = require('./warNotify');
    await maybeAnnouncePreviousMonth(bot, sendToGroup);
  } catch (err) {
    console.error('[Stats] maintenance announce:', err.message);
  }
}

module.exports = {
  monthKeyFromDate,
  parseMonthArg,
  recordFinishedWar,
  recordFinishedWarFromSaved,
  maybeSnapshotMembers,
  buildMonthlyReport,
  formatReportText,
  runRetention,
  maybeAnnouncePreviousMonth,
  runStatsMaintenance,
};
