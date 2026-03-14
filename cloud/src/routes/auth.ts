import { Hono } from "hono";
import type { Env, Variables, AuthResponse } from "../types";
import { hashPassword, verifyPassword } from "../crypto/password";
import { signJWT } from "../crypto/jwt";
import {
  createUser,
  getUserByEmail,
  getUserById,
  createRefreshToken,
  getRefreshTokenByHash,
  revokeRefreshToken,
  revokeAllUserTokens,
} from "../db/queries";
import { badRequest, unauthorized, conflict } from "../errors";

type AppEnv = { Bindings: Env; Variables: Variables };

const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes
const REFRESH_TOKEN_DAYS = 30;

const auth = new Hono<AppEnv>();

/** Generate a cryptographically random hex string. */
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hash of a string, returned as hex. */
async function sha256Hex(input: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
  );
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Issue access + refresh tokens. */
async function issueTokens(
  db: D1Database,
  jwtSecret: string,
  userId: string,
  email: string,
): Promise<AuthResponse> {
  const now = Math.floor(Date.now() / 1000);

  const accessToken = await signJWT(
    { sub: userId, email, iat: now, exp: now + ACCESS_TOKEN_TTL },
    jwtSecret,
  );

  const rawRefreshToken = randomId() + randomId();
  const refreshTokenId = randomId();
  const tokenHash = await sha256Hex(rawRefreshToken);
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await createRefreshToken(db, refreshTokenId, userId, tokenHash, expiresAt);

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
    user: { id: userId, email },
  };
}

// ─── POST /auth/register ────────────────────────────────────────────────────

auth.post("/register", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    throw badRequest("Email and password are required");
  }
  if (password.length < 8) {
    throw badRequest("Password must be at least 8 characters");
  }

  const existing = await getUserByEmail(c.env.DB, email);
  if (existing) {
    throw conflict("An account with this email already exists");
  }

  const userId = randomId();
  const passwordHash = await hashPassword(password);
  await createUser(c.env.DB, userId, email, passwordHash);

  const tokens = await issueTokens(c.env.DB, c.env.JWT_SECRET, userId, email);
  return c.json(tokens, 201);
});

// ─── POST /auth/login ────────────────────────────────────────────────────────

auth.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    throw badRequest("Email and password are required");
  }

  const user = await getUserByEmail(c.env.DB, email);
  if (!user) {
    throw unauthorized("Invalid email or password");
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw unauthorized("Invalid email or password");
  }

  const tokens = await issueTokens(
    c.env.DB,
    c.env.JWT_SECRET,
    user.id,
    user.email,
  );
  return c.json(tokens);
});

// ─── POST /auth/refresh ──────────────────────────────────────────────────────

auth.post("/refresh", async (c) => {
  const body = await c.req.json<{ refreshToken?: string }>();
  if (!body.refreshToken) {
    throw badRequest("refreshToken is required");
  }

  const tokenHash = await sha256Hex(body.refreshToken);
  const stored = await getRefreshTokenByHash(c.env.DB, tokenHash);

  if (!stored) {
    throw unauthorized("Invalid refresh token");
  }

  if (new Date(stored.expires_at) < new Date()) {
    await revokeRefreshToken(c.env.DB, stored.id);
    throw unauthorized("Refresh token expired");
  }

  // Rotate: revoke old, issue new
  await revokeRefreshToken(c.env.DB, stored.id);

  const user = await getUserById(c.env.DB, stored.user_id);
  if (!user) {
    throw unauthorized("User not found");
  }

  const tokens = await issueTokens(
    c.env.DB,
    c.env.JWT_SECRET,
    user.id,
    user.email,
  );
  return c.json(tokens);
});

// ─── POST /auth/logout ──────────────────────────────────────────────────────

auth.post("/logout", async (c) => {
  const body = await c.req.json<{ refreshToken?: string; all?: boolean }>();

  if (body.all && body.refreshToken) {
    // Decode refresh token to get userId, then revoke all
    const tokenHash = await sha256Hex(body.refreshToken);
    const stored = await getRefreshTokenByHash(c.env.DB, tokenHash);
    if (stored) {
      await revokeAllUserTokens(c.env.DB, stored.user_id);
    }
  } else if (body.refreshToken) {
    const tokenHash = await sha256Hex(body.refreshToken);
    const stored = await getRefreshTokenByHash(c.env.DB, tokenHash);
    if (stored) {
      await revokeRefreshToken(c.env.DB, stored.id);
    }
  }

  return c.json({ ok: true });
});

export { auth };
