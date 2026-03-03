import { routePartykitRequest } from "partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import { YServer } from "y-partyserver";
import { Doc, encodeStateAsUpdate, applyUpdate } from "yjs";

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

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
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

  // Secret is stored as hex — decode to raw bytes to match Rust's HMAC key
  const keyData = hexDecode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  const sigBytes = base64UrlDecode(sigB64);
  const payloadBytes = new TextEncoder().encode(payloadB64);
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

const STORAGE_KEY = "yjs-state";

/** Map of connection ID → permissions for enforcing read-only */
const connectionPermissions = new Map<string, string>();

export class CollabServer extends YServer {
  static options = {
    hibernate: true,
  };

  /**
   * Restore Yjs document from Durable Object storage on wake.
   * Called by YServer's onStart() when the DO initializes (or re-initializes
   * after hibernation eviction).
   */
  async onLoad(): Promise<Doc | void> {
    const ctx = (this as unknown as { ctx: DurableObjectState }).ctx;
    const stored = await ctx.storage.get<ArrayBuffer>(STORAGE_KEY);
    if (stored) {
      const doc = new Doc();
      applyUpdate(doc, new Uint8Array(stored));
      return doc;
    }
  }

  /**
   * Persist Yjs document to Durable Object storage.
   * Called by YServer on a debounced schedule after document updates.
   */
  async onSave(): Promise<void> {
    const ctx = (this as unknown as { ctx: DurableObjectState }).ctx;
    const state = encodeStateAsUpdate(this.document);
    await ctx.storage.put(STORAGE_KEY, state.buffer);
  }

  /**
   * Validate HMAC token on connect and store permissions.
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

    let payload: TokenPayload;
    try {
      payload = await verifyToken(token, secret);
    } catch (err) {
      console.warn("Token verification failed:", (err as Error).message);
      connection.close(4003, "Invalid token");
      return;
    }

    // Store permissions for this connection
    connectionPermissions.set(connection.id, payload.permissions);

    // Token valid — proceed with Yjs sync
    await super.onConnect(connection, ctx);
  }

  /**
   * Intercept messages to enforce read-only permissions.
   * Read-only connections can receive sync/awareness but cannot send document updates.
   */
  async onMessage(connection: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    const permissions = connectionPermissions.get(connection.id);

    // For read-only connections, filter out document update messages
    // Yjs protocol: message type 0 = sync, 1 = awareness
    // Sync sub-messages: 0 = step1 (request), 1 = step2 (response), 2 = update
    // Read-only should be allowed to receive sync responses and awareness,
    // but NOT allowed to send document updates (sync type 2)
    if (permissions === "r" && message instanceof ArrayBuffer) {
      const data = new Uint8Array(message);
      // Check if this is a sync message (type 0) with an update sub-type (2)
      if (data.length >= 2 && data[0] === 0 && data[1] === 2) {
        // Drop document update messages from read-only connections
        return;
      }
    } else if (permissions === "r" && ArrayBuffer.isView(message)) {
      const data = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
      if (data.length >= 2 && data[0] === 0 && data[1] === 2) {
        return;
      }
    }

    await super.onMessage(connection, message);
  }

  /**
   * Clean up permissions on disconnect.
   */
  async onClose(connection: Connection, code: number, reason: string) {
    connectionPermissions.delete(connection.id);
    await super.onClose(connection, code, reason);
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
