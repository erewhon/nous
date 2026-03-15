import type {
  UserRow,
  RefreshTokenRow,
  CloudNotebookRow,
  NotebookShareRow,
  SavedShareRow,
} from "../types";

// ─── Users ──────────────────────────────────────────────────────────────────

export async function createUser(
  db: D1Database,
  id: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)")
    .bind(id, email, passwordHash)
    .run();
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
}

export async function setMasterKeySalt(
  db: D1Database,
  userId: string,
  salt: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET master_key_salt = ?, updated_at = datetime('now') WHERE id = ? AND master_key_salt IS NULL",
    )
    .bind(salt, userId)
    .run();
}

export async function getMasterKeySalt(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT master_key_salt FROM users WHERE id = ?")
    .bind(userId)
    .first<{ master_key_salt: string | null }>();
  return row?.master_key_salt ?? null;
}

// ─── Refresh Tokens ─────────────────────────────────────────────────────────

export async function createRefreshToken(
  db: D1Database,
  id: string,
  userId: string,
  tokenHash: string,
  expiresAt: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id, userId, tokenHash, expiresAt)
    .run();
}

export async function getRefreshTokenByHash(
  db: D1Database,
  tokenHash: string,
): Promise<RefreshTokenRow | null> {
  return db
    .prepare(
      "SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL",
    )
    .bind(tokenHash)
    .first<RefreshTokenRow>();
}

export async function revokeRefreshToken(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
}

export async function revokeAllUserTokens(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL",
    )
    .bind(userId)
    .run();
}

// ─── Cloud Notebooks ────────────────────────────────────────────────────────

export async function listNotebooks(
  db: D1Database,
  userId: string,
): Promise<CloudNotebookRow[]> {
  const result = await db
    .prepare("SELECT * FROM cloud_notebooks WHERE user_id = ? ORDER BY name")
    .bind(userId)
    .all<CloudNotebookRow>();
  return result.results;
}

export async function getNotebook(
  db: D1Database,
  id: string,
  userId: string,
): Promise<CloudNotebookRow | null> {
  return db
    .prepare("SELECT * FROM cloud_notebooks WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<CloudNotebookRow>();
}

export async function createNotebook(
  db: D1Database,
  id: string,
  userId: string,
  localNotebookId: string | null,
  name: string,
  encryptedNotebookKey: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cloud_notebooks (id, user_id, local_notebook_id, name, encrypted_notebook_key)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, localNotebookId, name, encryptedNotebookKey)
    .run();
}

export async function deleteNotebook(
  db: D1Database,
  id: string,
  userId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM cloud_notebooks WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
}

export async function updateNotebookSyncTime(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE cloud_notebooks SET last_sync_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .run();
}

// ─── Notebook Shares ─────────────────────────────────────────────────────────

export async function createShare(
  db: D1Database,
  id: string,
  notebookId: string,
  userId: string,
  mode: "public" | "password",
  permissions: "r" | "rw",
  passwordSalt: string | null,
  wrappedKey: string | null,
  label: string | null,
  expiresAt: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notebook_shares (id, notebook_id, user_id, mode, permissions, password_salt, wrapped_key, label, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, notebookId, userId, mode, permissions, passwordSalt, wrappedKey, label, expiresAt)
    .run();
}

export async function getShareById(
  db: D1Database,
  id: string,
): Promise<NotebookShareRow | null> {
  return db
    .prepare(
      "SELECT * FROM notebook_shares WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(id)
    .first<NotebookShareRow>();
}

export async function listSharesForNotebook(
  db: D1Database,
  notebookId: string,
  userId: string,
): Promise<NotebookShareRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM notebook_shares WHERE notebook_id = ? AND user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
    )
    .bind(notebookId, userId)
    .all<NotebookShareRow>();
  return result.results;
}

export async function revokeShare(
  db: D1Database,
  id: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE notebook_shares SET revoked_at = datetime('now') WHERE id = ? AND user_id = ?",
    )
    .bind(id, userId)
    .run();
}

// ─── Saved Shares ────────────────────────────────────────────────────────────

export async function saveShare(
  db: D1Database,
  userId: string,
  shareId: string,
  wrappedNotebookKey: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO saved_shares (user_id, share_id, wrapped_notebook_key)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, share_id) DO UPDATE SET wrapped_notebook_key = excluded.wrapped_notebook_key`,
    )
    .bind(userId, shareId, wrappedNotebookKey)
    .run();
}

export async function listSavedShares(
  db: D1Database,
  userId: string,
): Promise<
  Array<
    SavedShareRow & { notebook_name: string; share_mode: string; owner_email: string }
  >
> {
  const result = await db
    .prepare(
      `SELECT ss.*, cn.name AS notebook_name, ns.mode AS share_mode, u.email AS owner_email
       FROM saved_shares ss
       JOIN notebook_shares ns ON ns.id = ss.share_id AND ns.revoked_at IS NULL
       JOIN cloud_notebooks cn ON cn.id = ns.notebook_id
       JOIN users u ON u.id = ns.user_id
       WHERE ss.user_id = ?
       AND (ns.expires_at IS NULL OR ns.expires_at > datetime('now'))
       ORDER BY ss.saved_at DESC`,
    )
    .bind(userId)
    .all<
      SavedShareRow & { notebook_name: string; share_mode: string; owner_email: string }
    >();
  return result.results;
}

export async function removeSavedShare(
  db: D1Database,
  userId: string,
  shareId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM saved_shares WHERE user_id = ? AND share_id = ?")
    .bind(userId, shareId)
    .run();
}
