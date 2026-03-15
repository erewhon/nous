-- Nous Cloud D1 Schema

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- PBKDF2 salt for master encryption key derivation (hex, set on first encryption setup)
  master_key_salt TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Refresh tokens (JWT refresh flow)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Cloud notebooks (registry of synced notebooks)
CREATE TABLE IF NOT EXISTS cloud_notebooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_notebook_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_at TEXT,
  -- Encrypted notebook key (wrapped with user's master key)
  -- Stored as base64 serialized EncryptedBlob
  encrypted_notebook_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloud_notebooks_user ON cloud_notebooks(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_notebooks_user_local
  ON cloud_notebooks(user_id, local_notebook_id);

-- Notebook shares (read-only sharing links)
CREATE TABLE IF NOT EXISTS notebook_shares (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES cloud_notebooks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'public' = key-in-URL-fragment, 'password' = password-protected
  mode TEXT NOT NULL CHECK (mode IN ('public', 'password')),
  -- For password mode: PBKDF2 salt (hex) used to derive the wrapping key
  password_salt TEXT,
  -- For password mode: notebook key wrapped with password-derived key (base64)
  wrapped_key TEXT,
  -- Optional label set by the owner (e.g. "For Alice")
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notebook_shares_notebook ON notebook_shares(notebook_id);
CREATE INDEX IF NOT EXISTS idx_notebook_shares_user ON notebook_shares(user_id);

-- Saved shares (shares bookmarked by recipient users)
CREATE TABLE IF NOT EXISTS saved_shares (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_id TEXT NOT NULL REFERENCES notebook_shares(id) ON DELETE CASCADE,
  -- Notebook key re-wrapped with this user's master key (base64)
  wrapped_notebook_key TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, share_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_shares_user ON saved_shares(user_id);
