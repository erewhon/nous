import type { Context, Next } from "hono";
import type { Env, Variables } from "../types";
import { verifyPublishToken } from "../crypto/publish-token";
import { unauthorized } from "../errors";

/**
 * Publish auth — verifies the HMAC-signed publish token (Publish-Static-to-Nous)
 * and sets `userId` (the token's `pub`) on context for the static-share routes.
 * Distinct from the account JWT middleware: the desktop holds a shared publish
 * secret, not a cloud account.
 */
export async function publishAuthMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Missing or invalid publish token");
  }
  if (!c.env.PUBLISH_HMAC_SECRET) {
    throw unauthorized("Publishing is not configured on this server");
  }

  const payload = await verifyPublishToken(header.slice(7), c.env.PUBLISH_HMAC_SECRET);
  if (!payload) {
    throw unauthorized("Invalid or expired publish token");
  }

  c.set("userId", payload.pub);
  await next();
}
