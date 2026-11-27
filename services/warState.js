const { query } = require('../database');
const { parseClashTime, normalizeTag } = require('../utils/helpers');
const { markSaveStateWrite, markSaveStateSkip } = require('./monitorStats');

/** Slot ids: 1 = regular war, 2 = CWL day */
function stateSlotId(isCwl) {
  return isCwl ? 2 : 1;
}

async function hasNotification(warKey, eventType) {
  const res = await query(
    `SELECT 1 FROM war_notifications WHERE war_key = $1 AND event_type = $2`,
    [warKey, eventType]
  );
  return res.rowCount > 0;
}

async function markNotification(warKey, eventType, payloadHash = null) {
  await query(
    `INSERT INTO war_notifications (war_key, event_type, payload_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (war_key, event_type) DO NOTHING`,
    [warKey, eventType, payloadHash]
  );
}

/**
 * Atomically claim a notification slot.
 * Returns true only for the first successful claim (prevents duplicate sends).
 */
async function claimNotification(warKey, eventType, payloadHash = null) {
  const res = await query(
    `INSERT INTO war_notifications (war_key, event_type, payload_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (war_key, event_type) DO NOTHING
     RETURNING war_key`,
    [warKey, eventType, payloadHash]
  );
  return res.rowCount > 0;
}

/** Release a claimed slot so a later retry can send (e.g. after total send failure). */
async function releaseNotification(warKey, eventType) {
  await query(
    `DELETE FROM war_notifications WHERE war_key = $1 AND event_type = $2`,
    [warKey, eventType]
  );
}

/**
 * @param {boolean} [isCwl=false] regular (id=1) vs CWL (id=2)
 */
async function getLastState(isCwl = false) {
  const id = stateSlotId(isCwl);
  const res = await query(`SELECT * FROM war_state WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

function numEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

function tsEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta === tb;
}

function tagEq(a, b) {
  const na = normalizeTag(a);
  const nb = normalizeTag(b);
  if (!na && !nb) return true;
  return na === nb;
}

/**
 * Fingerprint members + attacks so new attacks always force a save.
 * Used only for change detection; does not alter notify logic.
 */
function membersFingerprint(membersJson) {
  let members = membersJson;
  if (typeof members === 'string') {
    try {
      members = JSON.parse(members);
    } catch {
      members = [];
    }
  }
  if (!Array.isArray(members) || members.length === 0) return '';

  const parts = members.map((m) => {
    const tag = normalizeTag(m?.tag) || '';
    const attacks = Array.isArray(m?.attacks) ? m.attacks : [];
    const atkSig = attacks
      .map((a) => {
        const stars = a?.stars ?? 0;
        const dest = Number(a?.destructionPercentage);
        const destPart = Number.isFinite(dest) ? dest : 0;
        const def = normalizeTag(a?.defenderTag) || '';
        return `${stars}:${destPart}:${def}`;
      })
      .join(',');
    return `${tag}:${attacks.length}:${atkSig}`;
  });
  parts.sort();
  return parts.join('|');
}

/**
 * True when war_state row must be written for correct notify/diff behavior.
 * Compares status fields and full members/attacks fingerprint.
 */
function shouldSaveWarState(last, data) {
  if (!last) return true;
  if (!data || data.state == null) return true;

  if (String(last.state || '') !== String(data.state || '')) return true;
  if (Boolean(last.is_cwl) !== Boolean(data.isCwl)) return true;
  if (!tagEq(last.opponent_tag, data.opponentTag)) return true;
  if (!tagEq(last.war_tag, data.warTag)) return true;
  if (!numEq(last.team_size, data.teamSize)) return true;
  if (!numEq(last.our_stars, data.ourStars)) return true;
  if (!numEq(last.their_stars, data.theirStars)) return true;
  if (!numEq(last.our_destruction, data.ourDestruction)) return true;
  if (!numEq(last.their_destruction, data.theirDestruction)) return true;
  if (!tsEq(last.preparation_start, data.preparationStart)) return true;
  if (!tsEq(last.start_time, data.startTime)) return true;
  if (!tsEq(last.end_time, data.endTime)) return true;

  const prevFp = membersFingerprint(last.members_json);
  const nextFp = membersFingerprint(data.membersJson);
  if (prevFp !== nextFp) return true;

  return false;
}

async function saveState(data) {
  const id = stateSlotId(Boolean(data.isCwl));
  await query(
    `INSERT INTO war_state (
      id, state, war_tag, opponent_tag, team_size,
      preparation_start, start_time, end_time,
      our_stars, their_stars, our_destruction, their_destruction,
      members_json, attacks_json, is_cwl, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      state = EXCLUDED.state,
      war_tag = EXCLUDED.war_tag,
      opponent_tag = EXCLUDED.opponent_tag,
      team_size = EXCLUDED.team_size,
      preparation_start = EXCLUDED.preparation_start,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      our_stars = EXCLUDED.our_stars,
      their_stars = EXCLUDED.their_stars,
      our_destruction = EXCLUDED.our_destruction,
      their_destruction = EXCLUDED.their_destruction,
      members_json = EXCLUDED.members_json,
      attacks_json = EXCLUDED.attacks_json,
      is_cwl = EXCLUDED.is_cwl,
      updated_at = NOW()`,
    [
      id,
      data.state,
      data.warTag || null,
      data.opponentTag || null,
      data.teamSize || null,
      data.preparationStart || null,
      data.startTime || null,
      data.endTime || null,
      data.ourStars ?? null,
      data.theirStars ?? null,
      data.ourDestruction ?? null,
      data.theirDestruction ?? null,
      data.membersJson ? JSON.stringify(data.membersJson) : null,
      data.attacksJson ? JSON.stringify(data.attacksJson) : null,
      Boolean(data.isCwl),
    ]
  );
  markSaveStateWrite();
}

/**
 * Writes war_state only when meaningful fields (including attacks) changed.
 * @returns {Promise<boolean>} true if a DB write happened
 */
async function saveStateIfChanged(last, data) {
  if (!shouldSaveWarState(last, data)) {
    markSaveStateSkip();
    return false;
  }
  await saveState(data);
  return true;
}

function buildWarKey(war) {
  if (!war || war.state === 'notInWar') return 'notInWar';
  const opp = normalizeTag(war.opponent?.tag || 'unknown');
  const start =
    parseClashTime(war.preparationStartTime) || parseClashTime(war.startTime);
  const t = start ? start.getTime() : 0;
  return `${opp}_${t}`;
}

function buildWarKeyFromSaved(last) {
  if (!last || !last.opponent_tag) return null;
  const opp = normalizeTag(last.opponent_tag);
  const start = last.preparation_start || last.start_time;
  const t = start ? new Date(start).getTime() : 0;
  if (!opp || !t) return null;
  return `${opp}_${t}`;
}

module.exports = {
  hasNotification,
  markNotification,
  claimNotification,
  releaseNotification,
  getLastState,
  saveState,
  saveStateIfChanged,
  shouldSaveWarState,
  membersFingerprint,
  buildWarKey,
  buildWarKeyFromSaved,
  stateSlotId,
};
