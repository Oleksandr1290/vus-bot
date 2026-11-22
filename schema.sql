-- ВУС bot — database schema (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,      -- Telegram user ID
  username    TEXT,
  first_name  TEXT,
  lang        TEXT,                     -- ua | ru | en
  banned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  user_id     INTEGER PRIMARY KEY,
  state       TEXT,
  data        TEXT,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  country         TEXT NOT NULL,         -- country name in Ukrainian (for hashtags)
  city            TEXT NOT NULL,         -- city name in Ukrainian or as typed
  category        TEXT NOT NULL,         -- category key
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  price           TEXT NOT NULL,
  photos          TEXT NOT NULL DEFAULT '[]',  -- JSON array of file_id
  contact         TEXT NOT NULL,
  on_site         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL,         -- pending | published | rejected | expired | deleted
  channel_msg_ids TEXT NOT NULL DEFAULT '[]',
  channel_kind    TEXT,                  -- text | photo | album
  admin_msg_id    INTEGER,
  reject_reason   TEXT,
  moderated_by    INTEGER,
  created_at      INTEGER NOT NULL,
  published_at    INTEGER,
  expires_at      INTEGER,
  reminded        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ads_user    ON ads(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ads_status  ON ads(status, expires_at);
