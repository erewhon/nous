/**
 * HMAC-SHA256 publish tokens for Publish-Static-to-Nous.
 *
 * Mirrors the desktop signer in `src-tauri/src/share/publish_token.rs`:
 * token = `base64url(payloadJSON).base64url(HMAC-SHA256(payload_b64))`.
 * The secret is a 32-byte value shared with the desktop, provided to the Worker
 * hex-encoded (binding `PUBLISH_HMAC_SECRET`), so we hex-decode it before use.
 *
 * The token authenticates the sole publisher; `pub` becomes the owner id on
 * the static-share record.
 */

export interface PublishTokenPayload {
  pub: string;
  exp: number; // unix seconds
}

function bytesToB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlToBytes(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function importKey(secretHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    hexToBytes(secretHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Verify a publish token's HMAC and expiry. Returns the payload or null. */
export async function verifyPublishToken(
  token: string,
  secretHex: string,
): Promise<PublishTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const key = await importKey(secretHex);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;

  let payload: PublishTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (!payload.pub) return null;
  return payload;
}

/** Sign a publish token (used by the test suite; the desktop is the real signer). */
export async function signPublishToken(
  payload: PublishTokenPayload,
  secretHex: string,
): Promise<string> {
  const payloadB64 = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importKey(secretHex);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
  );
  return `${payloadB64}.${bytesToB64url(sig)}`;
}
