import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env, Variables } from "./types";
import { corsMiddleware } from "./middleware/cors";
import { authMiddleware } from "./middleware/auth";
import { publishAuthMiddleware } from "./middleware/publishAuth";
import { auth } from "./routes/auth";
import { me } from "./routes/me";
import { notebooks } from "./routes/notebooks";
import { sharesPublic } from "./routes/shares";
import { staticShares } from "./routes/staticShares";
import { serveStaticShare } from "./routes/staticServe";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status);
  }
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ message: err.message }, 500);
});

// Global CORS
app.use("*", corsMiddleware);

// pub.nous.page — serve published static shares (public, read-only). Gated on
// host so it never shadows the API routes on api.nous.page. Runs before the API
// routes and the health check.
app.use("*", async (c, next) => {
  if (new URL(c.req.url).hostname.toLowerCase() === "pub.nous.page") {
    return serveStaticShare(c);
  }
  return next();
});

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "nous-cloud" }));

// Static-share management (Publish-Static-to-Nous): publish-token-gated,
// owner-only. Registered before the public /shares router so the publish-auth
// middleware runs for the static sub-paths; the public serve route lives on the
// pub host separately.
app.use("/shares/:shareId/static", publishAuthMiddleware);
app.use("/shares/:shareId/static/*", publishAuthMiddleware);
app.route("/shares", staticShares);

// Public routes
app.route("/auth", auth);
app.route("/shares", sharesPublic);

// Protected routes
app.use("/me/*", authMiddleware);
app.route("/me", me);
app.use("/notebooks/*", authMiddleware);
app.route("/notebooks", notebooks);

export default app;
