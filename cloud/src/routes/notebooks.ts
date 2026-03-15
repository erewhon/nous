import { Hono } from "hono";
import type { Env, Variables, CloudNotebook } from "../types";
import {
  listNotebooks,
  getNotebook,
  createNotebook,
  deleteNotebook,
  updateNotebookSyncTime,
  createShare,
  listSharesForNotebook,
  revokeShare,
} from "../db/queries";
import {
  putPage,
  getPage,
  deletePage,
  putMeta,
  getMeta,
  listPageIds,
  deleteAllNotebookData,
} from "../storage/r2";
import { badRequest, notFound, forbidden, preconditionFailed } from "../errors";

type AppEnv = { Bindings: Env; Variables: Variables };

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toApi(row: {
  id: string;
  local_notebook_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  encrypted_notebook_key: string | null;
}): CloudNotebook {
  return {
    id: row.id,
    localNotebookId: row.local_notebook_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSyncAt: row.last_sync_at,
    encryptedNotebookKey: row.encrypted_notebook_key,
  };
}

const notebooks = new Hono<AppEnv>();

// ─── GET /notebooks ──────────────────────────────────────────────────────────

notebooks.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await listNotebooks(c.env.DB, userId);
  return c.json(rows.map(toApi));
});

// ─── POST /notebooks ─────────────────────────────────────────────────────────

notebooks.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    name?: string;
    localNotebookId?: string;
    encryptedNotebookKey?: string;
  }>();

  if (!body.name?.trim()) {
    throw badRequest("name is required");
  }

  const id = randomId();
  await createNotebook(
    c.env.DB,
    id,
    userId,
    body.localNotebookId ?? null,
    body.name.trim(),
    body.encryptedNotebookKey ?? null,
  );

  const row = await getNotebook(c.env.DB, id, userId);
  return c.json(toApi(row!), 201);
});

// ─── GET /notebooks/:id ──────────────────────────────────────────────────────

notebooks.get("/:id", async (c) => {
  const userId = c.get("userId");
  const row = await getNotebook(c.env.DB, c.req.param("id"), userId);
  if (!row) throw notFound("Notebook not found");
  return c.json(toApi(row));
});

// ─── DELETE /notebooks/:id ───────────────────────────────────────────────────

notebooks.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");

  const row = await getNotebook(c.env.DB, notebookId, userId);
  if (!row) throw notFound("Notebook not found");

  // Delete all R2 data, then the DB row
  await deleteAllNotebookData(c.env.STORAGE, userId, notebookId);
  await deleteNotebook(c.env.DB, notebookId, userId);

  return c.json({ ok: true });
});

// ─── Notebook pages (encrypted blobs) ────────────────────────────────────────

/** Verify notebook ownership, return 404 if not found. */
async function requireNotebook(
  db: D1Database,
  notebookId: string,
  userId: string,
) {
  const row = await getNotebook(db, notebookId, userId);
  if (!row) throw notFound("Notebook not found");
  return row;
}

// GET /notebooks/:id/pages — list page IDs
notebooks.get("/:id/pages", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");
  await requireNotebook(c.env.DB, notebookId, userId);

  const ids = await listPageIds(c.env.STORAGE, userId, notebookId);
  return c.json({ pageIds: ids });
});

// PUT /notebooks/:id/pages/:pageId — upload encrypted page
// Supports If-Match header for optimistic concurrency control.
notebooks.put("/:id/pages/:pageId", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");
  const pageId = c.req.param("pageId");
  await requireNotebook(c.env.DB, notebookId, userId);

  const data = await c.req.arrayBuffer();
  if (data.byteLength === 0) {
    throw badRequest("Request body is empty");
  }

  const ifMatch = c.req.header("If-Match");
  const result = await putPage(c.env.STORAGE, userId, notebookId, pageId, data, ifMatch);
  if (!result) {
    throw preconditionFailed("Page was modified by another client");
  }

  await updateNotebookSyncTime(c.env.DB, notebookId);

  return c.json({ ok: true }, 200, { "ETag": result.etag });
});

// GET /notebooks/:id/pages/:pageId — download encrypted page
notebooks.get("/:id/pages/:pageId", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");
  const pageId = c.req.param("pageId");
  await requireNotebook(c.env.DB, notebookId, userId);

  const result = await getPage(c.env.STORAGE, userId, notebookId, pageId);
  if (!result) throw notFound("Page not found");

  return new Response(result.data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "ETag": result.etag,
    },
  });
});

// DELETE /notebooks/:id/pages/:pageId — delete encrypted page
notebooks.delete("/:id/pages/:pageId", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");
  const pageId = c.req.param("pageId");
  await requireNotebook(c.env.DB, notebookId, userId);

  await deletePage(c.env.STORAGE, userId, notebookId, pageId);
  return c.json({ ok: true });
});

// ─── Notebook meta (encrypted blob) ─────────────────────────────────────────

// PUT /notebooks/:id/meta — upload encrypted notebook metadata
notebooks.put("/:id/meta", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");
  await requireNotebook(c.env.DB, notebookId, userId);

  const data = await c.req.arrayBuffer();
  if (data.byteLength === 0) {
    throw badRequest("Request body is empty");
  }

  const ifMatch = c.req.header("If-Match");
  const result = await putMeta(c.env.STORAGE, userId, notebookId, data, ifMatch);
  if (!result) {
    throw preconditionFailed("Metadata was modified by another client");
  }

  await updateNotebookSyncTime(c.env.DB, notebookId);

  return c.json({ ok: true }, 200, { "ETag": result.etag });
});

// GET /notebooks/:id/meta — download encrypted notebook metadata
notebooks.get("/:id/meta", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");
  await requireNotebook(c.env.DB, notebookId, userId);

  const result = await getMeta(c.env.STORAGE, userId, notebookId);
  if (!result) throw notFound("Metadata not found");

  return new Response(result.data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "ETag": result.etag,
    },
  });
});

// ─── Notebook shares (management) ───────────────────────────────────────────

// POST /notebooks/:id/shares — create a share
notebooks.post("/:id/shares", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");
  await requireNotebook(c.env.DB, notebookId, userId);

  const body = await c.req.json<{
    mode: "public" | "password";
    passwordSalt?: string;
    wrappedKey?: string;
    label?: string;
    expiresAt?: string;
  }>();

  if (body.mode !== "public" && body.mode !== "password") {
    throw badRequest("mode must be 'public' or 'password'");
  }

  if (body.mode === "password") {
    if (!body.passwordSalt || !body.wrappedKey) {
      throw badRequest("passwordSalt and wrappedKey required for password mode");
    }
  }

  const id = randomId();
  await createShare(
    c.env.DB,
    id,
    notebookId,
    userId,
    body.mode,
    body.mode === "password" ? (body.passwordSalt ?? null) : null,
    body.mode === "password" ? (body.wrappedKey ?? null) : null,
    body.label?.trim() || null,
    body.expiresAt || null,
  );

  return c.json({
    id,
    notebookId,
    mode: body.mode,
    label: body.label?.trim() || null,
    createdAt: new Date().toISOString(),
    expiresAt: body.expiresAt || null,
  }, 201);
});

// GET /notebooks/:id/shares — list shares for notebook
notebooks.get("/:id/shares", async (c) => {
  const userId = c.get("userId");
  const notebookId = c.req.param("id");
  await requireNotebook(c.env.DB, notebookId, userId);

  const rows = await listSharesForNotebook(c.env.DB, notebookId, userId);
  return c.json(
    rows.map((r) => ({
      id: r.id,
      notebookId: r.notebook_id,
      mode: r.mode,
      label: r.label,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    })),
  );
});

// DELETE /notebooks/:id/shares/:shareId — revoke a share
notebooks.delete("/:id/shares/:shareId", async (c) => {
  const userId = c.get("userId");
  await revokeShare(c.env.DB, c.req.param("shareId"), userId);
  return c.json({ ok: true });
});

export { notebooks };
