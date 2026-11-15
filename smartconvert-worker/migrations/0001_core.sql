-- SmartConvert AI - core schema (Phase 2).
-- Timestamps are unix seconds (UTC). IDs are opaque text.
-- Later phases add their own migration files; never edit this file after it is applied.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  INTEGER NOT NULL
);

CREATE TABLE sites (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'wordpress',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  created_at  INTEGER NOT NULL,
  UNIQUE (user_id, domain)
);
CREATE INDEX idx_sites_user ON sites (user_id);

-- One site can have several credentials at once (old + new during key rotation).
-- secret_enc is AES-GCM ciphertext; the plain secret is never stored.
CREATE TABLE site_credentials (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  secret_enc  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at  INTEGER NOT NULL,
  rotated_at  INTEGER
);
CREATE INDEX idx_credentials_site ON site_credentials (site_id);

CREATE TABLE subscriptions (
  user_id      TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  plan         TEXT NOT NULL DEFAULT 'free',
  limits_json  TEXT NOT NULL DEFAULT '{}',
  updated_at   INTEGER NOT NULL
);

-- Day is 'YYYY-MM-DD' in UTC. Counters are updated with atomic conditional UPDATEs.
CREATE TABLE usage_daily (
  site_id      TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  analyses     INTEGER NOT NULL DEFAULT 0,
  rewrites     INTEGER NOT NULL DEFAULT 0,
  ai_requests  INTEGER NOT NULL DEFAULT 0,
  tokens       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day)
) WITHOUT ROWID;

-- Every authenticated, costly request writes one row. UNIQUE(site_id, nonce) is the replay guard.
CREATE TABLE ai_requests (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  nonce       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  provider    TEXT,
  status      TEXT NOT NULL DEFAULT 'received',
  tokens      INTEGER NOT NULL DEFAULT 0,
  latency_ms  INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (site_id, nonce)
);
CREATE INDEX idx_ai_requests_site_time ON ai_requests (site_id, created_at);

-- No foreign key on purpose: audit rows must outlive the site. Never store page content here.
CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     TEXT,
  action      TEXT NOT NULL,
  meta_json   TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_site_time ON audit_logs (site_id, created_at);
