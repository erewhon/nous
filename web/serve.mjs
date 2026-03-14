/**
 * Production server for the Nous web viewer.
 * Serves the Vite SPA with HTML5 history fallback.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(__dirname, "dist");
const PORT = 3201;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

async function tryFile(filePath) {
  try {
    const s = await stat(filePath);
    if (s.isFile()) return await readFile(filePath);
  } catch {
    return null;
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let filePath = join(DIST, url.pathname);

  // Try the exact file first
  let content = await tryFile(filePath);

  // For paths without extension, try index.html (SPA fallback)
  if (!content && !extname(url.pathname)) {
    content = await tryFile(join(DIST, "index.html"));
    filePath = join(DIST, "index.html");
  }

  if (content) {
    const ext = extname(filePath);
    const mime = MIME[ext] ?? "application/octet-stream";

    // Cache assets with hashed names aggressively
    const cacheControl =
      ext === ".html"
        ? "no-cache"
        : url.pathname.includes("/assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600";

    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": cacheControl,
    });
    res.end(content);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`Nous web viewer running on http://localhost:${PORT}`);
});
