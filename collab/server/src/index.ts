import { YServer } from "y-partyserver";
import type { Connection, WSMessage } from "partyserver";

/**
 * HMAC-SHA256 token verification for collab sessions.
 *
 * Token format: base64url(JSON payload).base64url(HMAC-SHA256 signature)
 * Payload: { room_id, page_id, permissions, exp }
 */

interface TokenPayload {
  room_id: string;
  page_id: string;
  permissions: string;
  exp: number;
}

async function verifyToken(
  token: string,
  secret: string
): Promise<TokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid token format");
  }

  const [payloadB64, sigB64] = parts;

  // Import the HMAC key
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  // Verify signature
  const sigBytes = base64UrlDecode(sigB64);
  const payloadBytes = encoder.encode(payloadB64);
  const valid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, payloadBytes);

  if (!valid) {
    throw new Error("Invalid signature");
  }

  // Decode payload
  const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
  const payload: TokenPayload = JSON.parse(payloadJson);

  // Check expiry
  if (Date.now() / 1000 > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}

function base64UrlDecode(str: string): Uint8Array {
  // Add padding if needed
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  // Convert base64url to base64
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default class CollabServer extends YServer {
  /**
   * Validate HMAC token before allowing WebSocket connection.
   * Called before the connection is established.
   */
  static async onBeforeConnect(request: Request) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response("Missing token", { status: 401 });
    }

    // Get the HMAC secret from environment
    const secret = (this as unknown as { env: Record<string, string> }).env
      ?.COLLAB_HMAC_SECRET;

    if (!secret) {
      console.error("COLLAB_HMAC_SECRET not configured");
      return new Response("Server misconfigured", { status: 500 });
    }

    try {
      const payload = await verifyToken(token, secret);
      // Optionally verify room_id matches the requested room
      // The room ID is in the URL path
      console.log(`Authenticated connection for room ${payload.room_id}`);
    } catch (err) {
      console.warn("Token verification failed:", (err as Error).message);
      return new Response("Invalid token", { status: 401 });
    }

    // Allow the connection
    return undefined;
  }

  // Enable WebSocket hibernation for cost efficiency on Cloudflare Workers.
  // Connections are hibernated when idle and woken on new messages.
  static options = {
    hibernate: true,
  };
}
