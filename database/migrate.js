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

-- Per-group settings (language, future options)
CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id TEXT PRIMARY KEY,
  language TEXT NOT NULL DEFAULT 'fa',
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user settings (private language, future options)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id BIGINT PRIMARY KEY,
  language TEXT NOT NULL DEFAULT 'fa',
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Monthly / historical war stats (compact rows)
CREATE TABLE IF NOT EXISTS recorded_wars (
  war_key TEXT PRIMARY KEY,
  month_key TEXT NOT NULL,
  is_cwl BOOLEAN NOT NULL DEFAULT FALSE,
  opponent_tag TEXT,
  opponent_name TEXT,
  team_size INTEGER,
  result TEXT NOT NULL,
  our_stars INTEGER NOT NULL DEFAULT 0,
  their_stars INTEGER NOT NULL DEFAULT 0,
  our_destruction REAL NOT NULL DEFAULT 0,
  their_destruction REAL NOT NULL DEFAULT 0,
  ended_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recorded_wars_month ON recorded_wars(month_key);
CREATE INDEX IF NOT EXISTS idx_recorded_wars_ended ON recorded_wars(ended_at);

CREATE TABLE IF NOT EXISTS war_player_stats (
  war_key TEXT NOT NULL REFERENCES recorded_wars(war_key) ON DELETE CASCADE,
  player_tag TEXT NOT NULL,
  player_name TEXT,
  map_position INTEGER,
  th_level INTEGER,
  attacks_used INTEGER NOT NULL DEFAULT 0,
  attacks_max INTEGER NOT NULL DEFAULT 2,
  stars INTEGER NOT NULL DEFAULT 0,
  attack_destruction REAL NOT NULL DEFAULT 0,
  defense_stars INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (war_key, player_tag)
);

CREATE INDEX IF NOT EXISTS idx_war_player_stats_player ON war_player_stats(player_tag);

CREATE TABLE IF NOT EXISTS member_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  month_key TEXT NOT NULL,
  player_tag TEXT NOT NULL,
  player_name TEXT,
  donations INTEGER NOT NULL DEFAULT 0,
  donations_received INTEGER NOT NULL DEFAULT 0,
  th_level INTEGER,
  trophies INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_member_snapshots_month ON member_snapshots(month_key);
CREATE INDEX IF NOT EXISTS idx_member_snapshots_at ON member_snapshots(snapshot_at);
CREATE INDEX IF NOT EXISTS idx_member_snapshots_player_at ON member_snapshots(player_tag, snapshot_at);
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
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  migrate({ closePool: true }).catch(() => process.exit(1));
}

module.exports = { migrate };
