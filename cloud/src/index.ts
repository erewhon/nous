import { Hono } from "hono";
import type { Env, Variables } from "./types";
import { corsMiddleware } from "./middleware/cors";
import { authMiddleware } from "./middleware/auth";
import { auth } from "./routes/auth";
import { me } from "./routes/me";
import { notebooks } from "./routes/notebooks";
import { sharesPublic } from "./routes/shares";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ message: err.message }, 500);
});

// Global CORS
app.use("*", corsMiddleware);

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "nous-cloud" }));

// Public routes
app.route("/auth", auth);
app.route("/shares", sharesPublic);

// Protected routes
app.use("/me/*", authMiddleware);
app.route("/me", me);
app.use("/notebooks/*", authMiddleware);
app.route("/notebooks", notebooks);

export default app;
