import { Hono } from "hono";
import type { Env, Variables } from "../types";
import {
  getMasterKeySalt,
  setMasterKeySalt,
  getShareById,
  saveShare,
  listSavedShares,
  removeSavedShare,
} from "../db/queries";
import { badRequest, notFound } from "../errors";

type AppEnv = { Bindings: Env; Variables: Variables };

const me = new Hono<AppEnv>();

// GET /me/encryption — get encryption params (salt)
me.get("/encryption", async (c) => {
  const userId = c.get("userId");
  const salt = await getMasterKeySalt(c.env.DB, userId);
  return c.json({ salt, iterations: 100_000, hash: "SHA-256" });
});

// POST /me/encryption — set encryption salt (one-time, immutable)
me.post("/encryption", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ salt?: string }>();

  if (!body.salt || !/^[0-9a-f]{32}$/.test(body.salt)) {
    throw badRequest("salt must be a 32-character hex string (16 bytes)");
  }

  const existing = await getMasterKeySalt(c.env.DB, userId);
  if (existing) {
    throw badRequest("Encryption salt is already set and cannot be changed");
  }

  await setMasterKeySalt(c.env.DB, userId, body.salt);
  return c.json({ salt: body.salt, iterations: 100_000, hash: "SHA-256" }, 201);
});

// ─── Saved Shares ────────────────────────────────────────────────────────────

// POST /me/saved-shares — save a share to library
me.post("/saved-shares", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    shareId?: string;
    wrappedNotebookKey?: string;
  }>();

  if (!body.shareId || !body.wrappedNotebookKey) {
    throw badRequest("shareId and wrappedNotebookKey are required");
  }

  // Verify the share exists and is active
  const share = await getShareById(c.env.DB, body.shareId);
  if (!share) throw notFound("Share not found");
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    throw notFound("Share has expired");
  }

  await saveShare(c.env.DB, userId, body.shareId, body.wrappedNotebookKey);
  return c.json({ ok: true }, 201);
});

// GET /me/saved-shares — list saved shares
me.get("/saved-shares", async (c) => {
  const userId = c.get("userId");
  const rows = await listSavedShares(c.env.DB, userId);
  return c.json(
    rows.map((r) => ({
      shareId: r.share_id,
      notebookName: r.notebook_name,
      ownerEmail: r.owner_email,
      wrappedNotebookKey: r.wrapped_notebook_key,
      savedAt: r.saved_at,
    })),
  );
});

// DELETE /me/saved-shares/:shareId — remove from library
me.delete("/saved-shares/:shareId", async (c) => {
  const userId = c.get("userId");
  await removeSavedShare(c.env.DB, userId, c.req.param("shareId"));
  return c.json({ ok: true });
});

export { me };
