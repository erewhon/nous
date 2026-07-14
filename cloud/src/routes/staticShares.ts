import { Hono } from "hono";
import type { Env, Variables } from "../types";
import {
  createStaticShare,
  getStaticShare,
  deleteStaticShare,
} from "../db/queries";
import { putStaticFile, deleteStaticShareFiles } from "../storage/r2";
import { badRequest, forbidden, notFound } from "../errors";

/**
 * Authenticated static-share management endpoints (Publish-Static-to-Nous).
 * Mounted on /shares in index.ts; the /shares/:shareId/static* paths are gated
 * by authMiddleware there, so the caller's JWT is verified before these run.
 *
 * Ownership model: the first PUT for a share id creates the `static_shares`
 * record owned by the authenticated publisher; later PUTs must come from that
 * same owner. Viewers never hit these routes — they read the public serve route.
 */
export const staticShares = new Hono<{ Bindings: Env; Variables: Variables }>();

const SHARE_ID_RE = /^[a-z0-9]+$/;

// PUT /shares/:shareId/static/<path> — upload one file of a published static site.
staticShares.put("/:shareId/static/:filepath{.+}", async (c) => {
  const userId = c.get("userId");
  const shareId = c.req.param("shareId");
  const filepath = c.req.param("filepath");

  if (!SHARE_ID_RE.test(shareId)) throw badRequest("Invalid share id");
  if (filepath.split("/").some((seg) => seg === "..")) {
    throw badRequest("Invalid path");
  }

  const data = await c.req.arrayBuffer();
  if (data.byteLength === 0) throw badRequest("Request body is empty");

  let share = await getStaticShare(c.env.DB, shareId);
  if (!share) {
    // First upload establishes the record, owned by the authed publisher.
    // Optional metadata rides on headers so a plain file PUT can create it.
    await createStaticShare(
      c.env.DB,
      shareId,
      userId,
      null,
      c.req.header("X-Static-Share-Title") ?? null,
      c.req.header("X-Static-Share-Theme") ?? null,
      c.req.header("X-Static-Share-Expires-At") ?? null,
      null,
    );
    share = await getStaticShare(c.env.DB, shareId);
  }

  if (share!.owner_user_id !== userId) {
    throw forbidden("You do not own this share");
  }

  await putStaticFile(c.env.STORAGE, shareId, filepath, data);
  return c.json({ ok: true });
});

// DELETE /shares/:shareId/static — unpublish: purge R2 objects + record (owner only).
staticShares.delete("/:shareId/static", async (c) => {
  const userId = c.get("userId");
  const shareId = c.req.param("shareId");

  const share = await getStaticShare(c.env.DB, shareId);
  if (!share) throw notFound("Static share not found");
  if (share.owner_user_id !== userId) {
    throw forbidden("You do not own this share");
  }

  await deleteStaticShareFiles(c.env.STORAGE, shareId);
  await deleteStaticShare(c.env.DB, shareId);
  return c.json({ ok: true });
});
