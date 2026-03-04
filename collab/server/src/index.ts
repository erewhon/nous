import { routePartykitRequest } from "partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import { YServer } from "y-partyserver";
import { Doc, encodeStateAsUpdate, applyUpdate } from "yjs";

/**
 * HMAC-SHA256 token verification for collab sessions.
 *
 * Token format: base64url(JSON payload).base64url(HMAC-SHA256 signature)
 * Payload supports both legacy (room_id/page_id) and scoped (scope_type/scope_id/notebook_id) tokens.
 */

interface TokenPayload {
  // Scope-based fields (new)
  scope_type?: "page" | "section" | "notebook";
  scope_id?: string;
  notebook_id?: string;
  // Legacy fields
  room_id?: string;
  page_id?: string;
  // Common
  permissions: string;
  exp: number;
}

/** Manifest entry for a page in a scoped session */
interface ManifestPage {
  id: string;
  title: string;
  folderId?: string | null;
  folderName?: string | null;
  sectionId?: string | null;
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

/**
 * Validate that a token's scope authorizes access to a specific room.
 * Room ID format: {notebook_id}:{page_id}
 */
function validateRoomAccess(payload: TokenPayload, roomId: string): boolean {
  const scopeType = payload.scope_type;

  if (!scopeType) {
    // Legacy token: must have room_id matching exactly
    return payload.room_id === roomId;
  }

  switch (scopeType) {
    case "page": {
      // Room must equal {notebook_id}:{scope_id}
      const expected = `${payload.notebook_id}:${payload.scope_id}`;
      return roomId === expected;
    }
    case "section":
    case "notebook":
      // Room must belong to the same notebook
      return roomId.startsWith(`${payload.notebook_id}:`);
    default:
      return false;
  }
}

interface Env {
  COLLAB_HMAC_SECRET: string;
  CollabServer: DurableObjectNamespace;
  /** KV namespace for manifest storage */
  COLLAB_MANIFESTS?: KVNamespace;
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
   * Validate HMAC token on connect, check scope authorization, and store permissions.
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

    // Validate that the token's scope authorizes access to this room
    const roomId = this.name; // DO name = room ID
    if (!validateRoomAccess(payload, roomId)) {
      console.warn("Room access denied:", { roomId, scope_type: payload.scope_type, scope_id: payload.scope_id });
      connection.close(4003, "Token does not authorize access to this room");
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
  async onClose(connection: Connection, code: number, reason: string, wasClean: boolean) {
    connectionPermissions.delete(connection.id);
    await super.onClose(connection, code, reason, wasClean);
  }
}

/** In-memory manifest cache (TTL-based, falls back to KV if available) */
const manifestCache = new Map<string, { data: ManifestPage[]; expiresAt: number }>();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function corsJson(body: string | object, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function corsError(message: string, status: number): Response {
  return new Response(message, { status, headers: CORS_HEADERS });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight for all API routes
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Manifest API: store/retrieve page lists for scoped sessions
    if (url.pathname.startsWith("/api/manifest/")) {
      const sessionId = url.pathname.split("/api/manifest/")[1];
      if (!sessionId) {
        return corsError("Missing session ID", 400);
      }

      // Verify token for manifest access
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "") || url.searchParams.get("token");
      if (!token) {
        return corsError("Missing token", 401);
      }

      try {
        await verifyToken(token, env.COLLAB_HMAC_SECRET);
      } catch {
        return corsError("Invalid token", 403);
      }

      if (request.method === "POST") {
        // Store manifest
        const body = await request.json() as ManifestPage[];
        const ttl = 24 * 60 * 60; // 24h

        // In-memory cache
        manifestCache.set(sessionId, {
          data: body,
          expiresAt: Date.now() + ttl * 1000,
        });

        // Persist to KV if available
        if (env.COLLAB_MANIFESTS) {
          await env.COLLAB_MANIFESTS.put(
            `manifest:${sessionId}`,
            JSON.stringify(body),
            { expirationTtl: ttl }
          );
        }

        return corsJson({ ok: true });
      }

      if (request.method === "GET") {
        // Check in-memory cache first
        const cached = manifestCache.get(sessionId);
        if (cached && cached.expiresAt > Date.now()) {
          return corsJson(cached.data);
        }

        // Fall back to KV
        if (env.COLLAB_MANIFESTS) {
          const stored = await env.COLLAB_MANIFESTS.get(`manifest:${sessionId}`);
          if (stored) {
            // Repopulate in-memory cache
            const data = JSON.parse(stored);
            manifestCache.set(sessionId, {
              data,
              expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            });
            return corsJson(stored);
          }
        }

        return corsError("Not found", 404);
      }

      return corsError("Method not allowed", 405);
    }

    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
