// Browser login for the daemon-served web bundle: OIDC authorization-code +
// PKCE against Zitadel, ending in the daemon's HttpOnly session cookie.
// Ported from Astra's src/lib/auth-web.ts.
//
// The SPA never keeps tokens: the ID token exists only for the one POST to
// /api/session, then everything is the cookie. Issuer and client id come
// from the daemon (/api/session/config), so nothing is hardcoded and the
// localhost dev server works against the same flow.
//
// Session auth is strictly same-origin (the daemon serves the bundle at
// /app and the cookie is SameSite), hence the relative fetch URLs. A
// cross-origin daemon (vite dev against localhost:7667) uses the
// localStorage API-key path instead — see WebAuthGate.
//
// The registered redirect URI is `{origin}/auth/callback` — outside the
// /app base path on purpose; main.tsx handles that path before the app
// mounts, and the daemon serves index.html there.

const PKCE_KEY = "nous:pkce";

/** Dispatched by the daemon client on a 401 in cookie-session mode so the
 * auth gate can swap the app for the sign-in screen. */
export const SESSION_EXPIRED_EVENT = "nous:session-expired";

export interface SessionUser {
  userId: string;
  username: string | null;
  displayName: string | null;
  role: string;
  status: string;
}

interface PkceState {
  verifier: string;
  state: string;
  tokenEndpoint: string;
  clientId: string;
}

// Whether the current page is authenticated by a daemon session cookie
// (set by WebAuthGate once fetchMe succeeds). Gates the sign-out command.
let sessionAuth = false;

export function markSessionAuth(active: boolean): void {
  sessionAuth = active;
}

export function isSessionAuth(): boolean {
  return sessionAuth;
}

/**
 * Probe the session. Three outcomes:
 * - a SessionUser: cookie session is live;
 * - null: the daemon wants a session but there isn't one (show sign-in);
 * - "unavailable": no multi-user daemon behind this origin (legacy daemon
 *   404s /api/me; a vite dev origin has no such route at all) — the gate
 *   passes straight through.
 */
export async function fetchMe(): Promise<SessionUser | null | "unavailable"> {
  let resp: Response;
  try {
    resp = await fetch("/api/me", { credentials: "same-origin" });
  } catch {
    return "unavailable";
  }
  if (resp.status === 401) return null;
  if (!resp.ok) return "unavailable";
  try {
    const body = (await resp.json()) as SessionUser;
    // A non-JSON or shape-less 200 (e.g. a dev server serving index.html
    // for unknown paths) is not a session.
    return typeof body?.userId === "string" ? body : "unavailable";
  } catch {
    return "unavailable";
  }
}

interface OidcEndpoints {
  clientId: string;
  authorization: string;
  token: string;
  endSession: string | undefined;
}

async function oidcEndpoints(): Promise<OidcEndpoints> {
  const configResp = await fetch("/api/session/config", {
    credentials: "same-origin",
  });
  if (!configResp.ok) {
    throw new Error(
      "Sign-in is unavailable: this server has no identity provider configured."
    );
  }
  const { issuer, clientId } = (await configResp.json()) as {
    issuer: string;
    clientId: string;
  };
  const discovery = (await (
    await fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`)
  ).json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
    end_session_endpoint?: string;
  };
  return {
    clientId,
    authorization: discovery.authorization_endpoint,
    token: discovery.token_endpoint,
    endSession: discovery.end_session_endpoint,
  };
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)). Exported for tests. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    )
  );
}

function redirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

/** Stash the PKCE verifier and hand the browser to Zitadel. */
export async function beginLogin(): Promise<void> {
  const endpoints = await oidcEndpoints();
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await pkceChallenge(verifier);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

  const stash: PkceState = {
    verifier,
    state,
    tokenEndpoint: endpoints.token,
    clientId: endpoints.clientId,
  };
  sessionStorage.setItem(PKCE_KEY, JSON.stringify(stash));

  const url = new URL(endpoints.authorization);
  url.searchParams.set("client_id", endpoints.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
}

/**
 * Validate the provider's callback query against the stashed state and
 * return the authorization code. Pure — exported for tests.
 */
export function parseCallback(search: string, expectedState: string | undefined): string {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error) {
    throw new Error(params.get("error_description") ?? `Sign-in failed (${error})`);
  }
  const code = params.get("code");
  if (!code || !expectedState) {
    throw new Error("Sign-in state was lost — please start over.");
  }
  if (params.get("state") !== expectedState) {
    throw new Error("Sign-in state mismatch — please start over.");
  }
  return code;
}

/**
 * Back from Zitadel on /auth/callback: exchange the code (SPA-side, PKCE),
 * trade the ID token for the session cookie, drop the tokens.
 */
export async function completeLogin(): Promise<void> {
  const raw = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  const stash = raw ? (JSON.parse(raw) as PkceState) : null;

  const code = parseCallback(window.location.search, stash?.state);
  // parseCallback throws when the stash is missing; it is non-null here.
  const { tokenEndpoint, clientId, verifier } = stash as PkceState;

  const tokenResp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  if (!tokenResp.ok) {
    throw new Error(`Token exchange failed (${tokenResp.status})`);
  }
  const tokens = (await tokenResp.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new Error("Identity provider returned no ID token.");
  }

  const sessionResp = await fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: tokens.id_token }),
  });
  if (sessionResp.status === 403) {
    const body = (await sessionResp.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(
      body?.message ?? body?.error ?? "This account isn't invited to this Nous server."
    );
  }
  if (!sessionResp.ok) {
    throw new Error(`Session creation failed (${sessionResp.status})`);
  }
  // Cookie set; the ID token goes out of scope here and is never stored.
}

/**
 * Clear the daemon session, then end the Zitadel session too. The
 * post-logout URI is the origin root (registered in Zitadel); landing
 * back on /app shows the sign-in screen.
 */
export async function signOut(): Promise<void> {
  await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
  markSessionAuth(false);
  try {
    const endpoints = await oidcEndpoints();
    if (endpoints.endSession) {
      const url = new URL(endpoints.endSession);
      url.searchParams.set("client_id", endpoints.clientId);
      url.searchParams.set("post_logout_redirect_uri", `${window.location.origin}/`);
      window.location.assign(url.toString());
      return;
    }
  } catch {
    // fall through to the local redirect
  }
  window.location.assign("/app");
}
