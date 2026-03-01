import { routePartykitRequest } from "partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import { YServer } from "y-partyserver";

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

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  const sigBytes = base64UrlDecode(sigB64);
  const payloadBytes = encoder.encode(payloadB64);
  const valid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, payloadBytes);

  if (!valid) {
    throw new Error("Invalid signature");
  }

  const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
  const payload: TokenPayload = JSON.parse(payloadJson);

  if (Date.now() / 1000 > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface Env {
  COLLAB_HMAC_SECRET: string;
  CollabServer: DurableObjectNamespace;
}

export class CollabServer extends YServer {
  static options = {
    hibernate: true,
  };

  /**
   * Validate HMAC token on connect.
   * If invalid, close the connection immediately.
   */
  async onConnect(connection: Connection, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      connection.close(4001, "Missing token");
      return;
    }

    const env = (this as unknown as { env: Env }).env;
    const secret = env?.COLLAB_HMAC_SECRET;

    if (!secret) {
      console.error("COLLAB_HMAC_SECRET not configured");
      connection.close(4500, "Server misconfigured");
      return;
    }

    try {
      const payload = await verifyToken(token, secret);
      console.log(`Authenticated connection for room ${payload.room_id}`);
    } catch (err) {
      console.warn("Token verification failed:", (err as Error).message);
      connection.close(4003, "Invalid token");
      return;
    }

    // Token valid — proceed with Yjs sync
    super.onConnect(connection, ctx);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
