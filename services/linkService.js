const { query } = require('../database');
const { getPlayer } = require('../api/clash');
const { normalizeTag, isValidTag, formatTag } = require('../utils/helpers');

async function upsertTelegramUser(user) {
  await query(
    `INSERT INTO telegram_users (telegram_id, username, first_name, last_name, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       updated_at = NOW()`,
    [user.id, user.username || null, user.first_name || null, user.last_name || null]
  );
}

async function upsertClashAccount(tag, name) {
  const clean = normalizeTag(tag);
  await query(
    `INSERT INTO clash_accounts (tag, name, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (tag) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, clash_accounts.name),
       updated_at = NOW()`,
    [clean, name || null]
  );
  return clean;
}

async function linkAccount(telegramId, clashTag, fetchName = true) {
  const clean = normalizeTag(clashTag);
  if (!isValidTag(clean)) {
    throw new Error('تگ کلش نامعتبر است. مثال صحیح: #ABC123XYZ');
  }

  let name = null;
  if (fetchName) {
    try {
      const player = await getPlayer(clean);
      name = player.name;
    } catch (err) {
      if (err.isNotFound) {
        throw new Error('اکانت کلش با این تگ پیدا نشد.');
      }
      console.warn('[Link] Could not fetch player name:', err.message);
    }
  }

  await upsertClashAccount(clean, name);

  await query(
    `INSERT INTO telegram_users (telegram_id, updated_at)
     VALUES ($1, NOW())
     ON CONFLICT (telegram_id) DO NOTHING`,
    [telegramId]
  );

  const existing = await query(
    `SELECT 1 FROM user_accounts WHERE telegram_id = $1 AND clash_tag = $2`,
    [telegramId, clean]
  );

  if (existing.rowCount > 0) {
    return { alreadyLinked: true, tag: clean, name };
  }

  await query(
    `INSERT INTO user_accounts (telegram_id, clash_tag) VALUES ($1, $2)`,
    [telegramId, clean]
  );

  return { alreadyLinked: false, tag: clean, name };
}

async function unlinkAccount(telegramId, clashTag) {
  const clean = normalizeTag(clashTag);
  const res = await query(
    `DELETE FROM user_accounts WHERE telegram_id = $1 AND clash_tag = $2 RETURNING clash_tag`,
    [telegramId, clean]
  );
  return res.rowCount > 0;
}

async function unlinkAll(telegramId) {
  const res = await query(
    `DELETE FROM user_accounts WHERE telegram_id = $1 RETURNING clash_tag`,
    [telegramId]
  );
  return res.rows.map((r) => r.clash_tag);
}

async function getUserAccounts(telegramId) {
  const res = await query(
    `SELECT ca.tag, ca.name, ua.linked_at
     FROM user_accounts ua
     JOIN clash_accounts ca ON ca.tag = ua.clash_tag
     WHERE ua.telegram_id = $1
     ORDER BY ua.linked_at DESC`,
    [telegramId]
  );
  return res.rows;
}

async function getLinkedTelegramUsers(clashTag) {
  const clean = normalizeTag(clashTag);
  const res = await query(
    `SELECT tu.telegram_id, tu.username, tu.first_name, tu.last_name
     FROM user_accounts ua
     JOIN telegram_users tu ON tu.telegram_id = ua.telegram_id
     WHERE ua.clash_tag = $1`,
    [clean]
  );
  return res.rows;
}

async function getLinksForTags(tags) {
  if (!tags || tags.length === 0) return new Map();
  const cleaned = tags.map(normalizeTag).filter(Boolean);
  const res = await query(
    `SELECT ua.clash_tag, tu.telegram_id, tu.username, tu.first_name
     FROM user_accounts ua
     JOIN telegram_users tu ON tu.telegram_id = ua.telegram_id
     WHERE ua.clash_tag = ANY($1)`,
    [cleaned]
  );

  const map = new Map();
  for (const row of res.rows) {
    if (!map.has(row.clash_tag)) map.set(row.clash_tag, []);
    map.get(row.clash_tag).push(row);
  }
  return map;
}

module.exports = {
  upsertTelegramUser,
  linkAccount,
  unlinkAccount,
  unlinkAll,
  getUserAccounts,
  getLinkedTelegramUsers,
  getLinksForTags,
  normalizeTag,
  formatTag,
};
