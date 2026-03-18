/**
 * HMAC-SHA256 token generation for collab sessions.
 *
 * Mirrors the Rust implementation in src-tauri/src/collab/token.rs.
 * Token format: base64url(JSON payload).base64url(HMAC-SHA256 signature)
 */

interface CollabTokenPayload {
  scope_type: "page";
  scope_id: string;
  notebook_id: string;
  permissions: "rw" | "r";
  exp: number;
  room_id: string;
  page_id: string;
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate an HMAC-SHA256 signed collab token for a page session.
 *
 * @param notebookId - Cloud notebook ID
 * @param pageId - Page ID
 * @param secretHex - HMAC secret as hex string (same as collab Worker)
 * @param expiresInSeconds - Token validity (default: 24 hours)
 * @param permissions - "rw" or "r"
 */
export async function generateCollabToken(
  notebookId: string,
  pageId: string,
  secretHex: string,
  expiresInSeconds = 86400,
  permissions: "rw" | "r" = "rw",
): Promise<{ token: string; roomId: string }> {
  const roomId = `${notebookId}:${pageId}`;
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;

  const payload: CollabTokenPayload = {
    scope_type: "page",
    scope_id: pageId,
    notebook_id: notebookId,
    permissions,
    exp,
    room_id: roomId,
    page_id: pageId,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadB64 = base64UrlEncode(payloadBytes);

  // Import HMAC key from hex-encoded secret
  const keyData = hexDecode(secretHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // Sign the base64url-encoded payload (not the raw JSON)
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(payloadB64),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sigBytes));

  return {
    token: `${payloadB64}.${sigB64}`,
    roomId,
  };
}
