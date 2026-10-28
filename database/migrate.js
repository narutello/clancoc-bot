const { pool, query } = require('./index');

const SCHEMA = `
-- Telegram users
CREATE TABLE IF NOT EXISTS telegram_users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Known Clash accounts
CREATE TABLE IF NOT EXISTS clash_accounts (
  tag TEXT PRIMARY KEY,
  name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-Many links
CREATE TABLE IF NOT EXISTS user_accounts (
  telegram_id BIGINT NOT NULL REFERENCES telegram_users(telegram_id) ON DELETE CASCADE,
  clash_tag TEXT NOT NULL REFERENCES clash_accounts(tag) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_id, clash_tag)
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_clash_tag ON user_accounts(clash_tag);
CREATE INDEX IF NOT EXISTS idx_user_accounts_telegram_id ON user_accounts(telegram_id);

-- Track sent notifications to prevent duplicates
CREATE TABLE IF NOT EXISTS war_notifications (
  id SERIAL PRIMARY KEY,
  war_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (war_key, event_type)
);

CREATE INDEX IF NOT EXISTS idx_war_notifications_war_key ON war_notifications(war_key);

-- Last known war state for comparison
CREATE TABLE IF NOT EXISTS war_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state TEXT,
  war_tag TEXT,
  opponent_tag TEXT,
  team_size INTEGER,
  preparation_start TIMESTAMPTZ,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  our_stars INTEGER,
  their_stars INTEGER,
  our_destruction REAL,
  their_destruction REAL,
  members_json JSONB,
  attacks_json JSONB,
  is_cwl BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO war_state (id, state) VALUES (1, 'unknown')
ON CONFLICT (id) DO NOTHING;
`;

async function migrate({ closePool = false } = {}) {
  console.log('[DB] Running migrations...');
  try {
    await query(SCHEMA);
    console.log('[DB] Migrations completed successfully.');
  } catch (err) {
    console.error('[DB] Migration failed:', err.message);
    throw err;
  } finally {
    // فقط وقتی مستقیم با CLI اجرا شود pool را ببند
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  migrate({ closePool: true }).catch(() => process.exit(1));
}

module.exports = { migrate };
