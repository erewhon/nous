/**
 * Map a file path/name to a `Content-Type` for serving published static shares
 * from R2. Case-insensitive on the extension; unknown/absent extension falls
 * back to `application/octet-stream`.
 */
const BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  txt: "text/plain; charset=utf-8",
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export function extToContentType(path: string): string {
  // Take the last path segment, then the substring after its final dot.
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return DEFAULT_CONTENT_TYPE;
  const ext = name.slice(dot + 1).toLowerCase();
  return BY_EXT[ext] ?? DEFAULT_CONTENT_TYPE;
}
