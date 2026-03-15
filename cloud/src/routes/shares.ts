import { Hono } from "hono";
import type { Env, NotebookShareRow } from "../types";
import {
  getShareById,
} from "../db/queries";
import {
  getPage,
  getMeta,
  listPageIds,
} from "../storage/r2";
import { notFound } from "../errors";

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
