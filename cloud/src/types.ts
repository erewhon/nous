/** Cloudflare Worker environment bindings. */
export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  JWT_SECRET: string;
}

/** Variables set by middleware on the Hono context. */
export interface Variables {
  userId: string;
  email: string;
}

/** D1 row types. */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  master_key_salt: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

export interface CloudNotebookRow {
  id: string;
  user_id: string;
  local_notebook_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  encrypted_notebook_key: string | null;
}

/** JWT payload. */
export interface JWTPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

/** API response types. */
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string };
}

export interface CloudNotebook {
  id: string;
  localNotebookId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt: string | null;
  encryptedNotebookKey: string | null;
}
