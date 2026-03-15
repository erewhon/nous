import { cors } from "hono/cors";

/**
 * CORS middleware configured for the Nous desktop app.
 * Allows requests from tauri://localhost (Tauri WebView origin)
 * and http://localhost:* for local development.
 */
export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return origin;
    if (origin === "tauri://localhost") return origin;
    if (origin.startsWith("http://localhost")) return origin;
    if (origin === "https://nous.page") return origin;
    if (origin.endsWith(".nous.page")) return origin;
    return null;
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "If-Match"],
  exposeHeaders: ["Content-Length", "ETag"],
  maxAge: 86400,
  credentials: true,
});
