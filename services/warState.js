const { query } = require('../database');
const { parseClashTime, normalizeTag } = require('../utils/helpers');

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

async function getLastState() {
  const res = await query(`SELECT * FROM war_state WHERE id = 1`);
  return res.rows[0] || null;
}

async function saveState(data) {
  await query(
    `UPDATE war_state SET
      state = $1, war_tag = $2, opponent_tag = $3, team_size = $4,
      preparation_start = $5, start_time = $6, end_time = $7,
      our_stars = $8, their_stars = $9, our_destruction = $10, their_destruction = $11,
      members_json = $12, attacks_json = $13, is_cwl = $14, updated_at = NOW()
     WHERE id = 1`,
    [
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
      data.isCwl || false,
    ]
  );
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
  getLastState,
  saveState,
  buildWarKey,
  buildWarKeyFromSaved,
};
