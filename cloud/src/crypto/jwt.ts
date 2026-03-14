import type { JWTPayload } from "../types";

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function encodeJSON(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Create a signed JWT.
 */
export async function signJWT(
  payload: JWTPayload,
  secret: string,
): Promise<string> {
  const header = encodeJSON({ alg: "HS256", typ: "JWT" });
  const body = encodeJSON(payload);
  const message = `${header}.${body}`;

  const key = await getSigningKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );

  return `${message}.${base64url(signature)}`;
}

/**
 * Verify and decode a JWT. Returns null if invalid or expired.
 */
export async function verifyJWT(
  token: string,
  secret: string,
): Promise<JWTPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const message = `${header}.${body}`;

  const key = await getSigningKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecode(sig),
    new TextEncoder().encode(message),
  );

  if (!valid) return null;

  const payload: JWTPayload = JSON.parse(
    new TextDecoder().decode(base64urlDecode(body)),
  );

  // Check expiry
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}
