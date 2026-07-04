// Maps stored asset references to daemon HTTP asset URLs for the browser
// build (and back for persistence).
//
// Page content stores local media in several historical forms:
//   - asset://{notebook-id}/{path}          (Joplin/import format)
//   - asset://localhost/{encoded-abs-path}  (Tauri convertFileSrc, Linux/macOS)
//   - http(s)://asset.localhost/{abs-path}  (Tauri convertFileSrc, Windows)
//   - /abs/path/to/library/notebooks/{nb}/assets/...  (raw file paths)
//   - external http(s) URLs                 (left untouched)
//
// In a browser none of the Tauri forms work, so resolveAssetUrl maps
// anything that lives under a notebook's assets/ directory to the daemon's
// GET /api/notebooks/{nb}/assets/{path} route. <img> tags can't send
// Authorization headers, so the API key rides along as the ?token= query
// param the daemon's auth middleware already accepts for WebSockets.
//
// Resolved URLs must never be persisted (they embed the token and a host):
// unresolveAssetUrl converts them back to the stable asset://{nb}/{path}
// form before content is saved. See convertImage / the image case in
// blockFormatConverter.ts.

import { getDaemonBaseUrl, getStoredDaemonApiKey } from "./daemonConfig";
import { isTauri } from "./platform";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const IMPORT_ASSET_RE = new RegExp(`^asset://(${UUID})/(.+)$`, "i");
const NOTEBOOK_ASSETS_PATH_RE = new RegExp(
  `/notebooks/(${UUID})/assets/(.+)$`,
  "i"
);
const DAEMON_ASSET_URL_RE = new RegExp(
  `^(?:https?://[^/]+)?/api/notebooks/(${UUID})/assets/([^?]+)`,
  "i"
);

/** decodeURIComponent that returns the input on malformed sequences. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Normalize a relative asset path for use in a URL: decode-then-encode each
 * segment so both raw filenames ("my photo.png") and pre-encoded ones
 * ("my%20photo.png") come out encoded exactly once.
 */
function encodeRelPath(relPath: string): string {
  return relPath
    .split("/")
    .map((s) => encodeURIComponent(safeDecode(s)))
    .join("/");
}

/** Daemon HTTP URL for a notebook asset, with the auth token if one is set. */
export function buildDaemonAssetUrl(
  notebookId: string,
  relPath: string
): string {
  const base = getDaemonBaseUrl();
  const key = getStoredDaemonApiKey();
  const suffix = key ? `?token=${encodeURIComponent(key)}` : "";
  return `${base}/api/notebooks/${notebookId}/assets/${encodeRelPath(relPath)}${suffix}`;
}

/**
 * Map a stored asset reference to a URL the current platform can render.
 * In the Tauri shell this is the identity (the asset protocol handles it);
 * in a browser, anything under a notebook assets/ dir becomes a daemon
 * asset URL. References that can't be mapped (external URLs, files outside
 * a notebook, orphaned import paths) pass through unchanged.
 */
export function resolveAssetUrl(url: string): string {
  if (!url || isTauri()) return url;

  const imported = url.match(IMPORT_ASSET_RE);
  if (imported) return buildDaemonAssetUrl(imported[1], imported[2]);

  // Tauri convertFileSrc output or a raw absolute path → extract the
  // filesystem path, then map it if it lives under notebooks/{nb}/assets/.
  let fsPath: string | null = null;
  if (url.startsWith("asset://localhost/")) {
    fsPath = safeDecode(url.slice("asset://localhost/".length));
  } else if (/^https?:\/\/asset\.localhost\//i.test(url)) {
    fsPath = safeDecode(url.replace(/^https?:\/\/asset\.localhost\//i, "/"));
  } else if (url.startsWith("/")) {
    fsPath = url;
  }
  if (fsPath) {
    const m = fsPath.match(NOTEBOOK_ASSETS_PATH_RE);
    if (m) return buildDaemonAssetUrl(m[1], m[2]);
  }

  return url;
}

/**
 * Reverse of resolveAssetUrl for persistence: a daemon asset URL (with or
 * without host and ?token=) becomes the stable asset://{nb}/{path} form.
 * Everything else passes through unchanged.
 */
export function unresolveAssetUrl(url: string): string {
  if (!url) return url;
  const m = url.match(DAEMON_ASSET_URL_RE);
  if (m) return `asset://${m[1]}/${m[2]}`;
  return url;
}
