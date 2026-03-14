import type { Context, Next } from "hono";
import type { Env, Variables } from "../types";
import { verifyJWT } from "../crypto/jwt";
import { unauthorized } from "../errors";

/**
 * Auth middleware — verifies the Bearer JWT and sets userId/email on context.
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Missing or invalid Authorization header");
  }

  const token = header.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    throw unauthorized("Invalid or expired token");
  }

  c.set("userId", payload.sub);
  c.set("email", payload.email);
  await next();
}
