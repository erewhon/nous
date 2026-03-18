import { Hono } from "hono";
import type { Env, NotebookShareRow } from "../types";
import {
  getShareById,
} from "../db/queries";
import {
  getPage,
  getMeta,
  putPage,
  putMeta,
  listPageIds,
} from "../storage/r2";
import { notFound, forbidden, badRequest, preconditionFailed } from "../errors";
import { generateCollabToken } from "../crypto/collab-token";

/**
 * Public share endpoints (no auth required).
 * Mounted on /shares in index.ts.
 */
export const sharesPublic = new Hono<{ Bindings: Env }>();

async function requireValidShare(db: D1Database, shareId: string): Promise<NotebookShareRow> {
  const share = await getShareById(db, shareId);
  if (!share) throw notFound("Share not found");
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    throw notFound("Share has expired");
  }
  return share;
}

async function requireWritableShare(db: D1Database, shareId: string): Promise<NotebookShareRow> {
  const share = await requireValidShare(db, shareId);
  if (share.permissions !== "rw") {
    throw forbidden("This share is read-only");
  }
  return share;
}

// GET /shares/:shareId — get share info
sharesPublic.get("/:shareId", async (c) => {
  const share = await requireValidShare(c.env.DB, c.req.param("shareId"));

  const notebook = await c.env.DB
    .prepare("SELECT name FROM cloud_notebooks WHERE id = ?")
    .bind(share.notebook_id)
    .first<{ name: string }>();

  return c.json({
    id: share.id,
    notebookId: share.notebook_id,
    notebookName: notebook?.name ?? "Shared Notebook",
    mode: share.mode,
    permissions: share.permissions,
    passwordSalt: share.mode === "password" ? share.password_salt : null,
    wrappedKey: share.mode === "password" ? share.wrapped_key : null,
  });
});

// GET /shares/:shareId/meta — download encrypted notebook metadata
sharesPublic.get("/:shareId/meta", async (c) => {
  const share = await requireValidShare(c.env.DB, c.req.param("shareId"));
  const result = await getMeta(c.env.STORAGE, share.user_id, share.notebook_id);
  if (!result) throw notFound("Metadata not found");
  return new Response(result.data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "ETag": result.etag,
    },
  });
});

// PUT /shares/:shareId/meta — upload encrypted metadata (writable shares only)
sharesPublic.put("/:shareId/meta", async (c) => {
  const share = await requireWritableShare(c.env.DB, c.req.param("shareId"));
  const data = await c.req.arrayBuffer();
  if (data.byteLength === 0) throw badRequest("Request body is empty");

  const ifMatch = c.req.header("If-Match");
  const result = await putMeta(c.env.STORAGE, share.user_id, share.notebook_id, data, ifMatch);
  if (!result) {
    throw preconditionFailed("Metadata was modified by another client");
  }

  return c.json({ ok: true }, 200, { "ETag": result.etag });
});

// GET /shares/:shareId/pages — list page IDs
sharesPublic.get("/:shareId/pages", async (c) => {
  const share = await requireValidShare(c.env.DB, c.req.param("shareId"));
  const ids = await listPageIds(c.env.STORAGE, share.user_id, share.notebook_id);
  return c.json({ pageIds: ids });
});

// GET /shares/:shareId/pages/:pageId — download encrypted page
sharesPublic.get("/:shareId/pages/:pageId", async (c) => {
  const share = await requireValidShare(c.env.DB, c.req.param("shareId"));
  const result = await getPage(
    c.env.STORAGE,
    share.user_id,
    share.notebook_id,
    c.req.param("pageId"),
  );
  if (!result) throw notFound("Page not found");
  return new Response(result.data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "ETag": result.etag,
    },
  });
});

// PUT /shares/:shareId/pages/:pageId — upload encrypted page (writable shares only)
sharesPublic.put("/:shareId/pages/:pageId", async (c) => {
  const share = await requireWritableShare(c.env.DB, c.req.param("shareId"));
  const data = await c.req.arrayBuffer();
  if (data.byteLength === 0) throw badRequest("Request body is empty");

  const ifMatch = c.req.header("If-Match");
  const result = await putPage(
    c.env.STORAGE,
    share.user_id,
    share.notebook_id,
    c.req.param("pageId"),
    data,
    ifMatch,
  );
  if (!result) {
    throw preconditionFailed("Page was modified by another client");
  }

  return c.json({ ok: true }, 200, { "ETag": result.etag });
});

// POST /shares/:shareId/collab-session — create a collab session token via share
sharesPublic.post("/:shareId/collab-session", async (c) => {
  const share = await requireValidShare(c.env.DB, c.req.param("shareId"));

  const body = await c.req.json<{ pageId: string }>();
  if (!body.pageId) throw badRequest("pageId is required");

  if (!c.env.COLLAB_HMAC_SECRET) {
    throw badRequest("Collaboration not configured on this server");
  }

  const permissions = share.permissions === "rw" ? "rw" as const : "r" as const;

  const { token, roomId } = await generateCollabToken(
    share.notebook_id,
    body.pageId,
    c.env.COLLAB_HMAC_SECRET,
    86400,
    permissions,
  );

  return c.json({
    token,
    roomId,
    partykitHost: "party.nous.page",
    party: "collab-server",
    permissions,
  });
});
