import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { getMasterKeySalt, setMasterKeySalt } from "../db/queries";
import { badRequest } from "../errors";

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

export { me };
