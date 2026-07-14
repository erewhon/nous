import type { Context } from "hono";
import type { Env, Variables } from "../types";
import { getStaticShare } from "../db/queries";
import { getStaticFile } from "../storage/r2";
import { extToContentType } from "../storage/contentType";

/**
 * Public, read-only serving of a published static share, mounted for the
 * `pub.nous.page` host (see index.ts). The Worker stays in the request path so
 * expiry is enforced at view time (410), matching the local static shares.
 *
 * URL shape: `pub.nous.page/{shareId}/{path}` → R2 `pub/{shareId}/{path}`.
 * An empty or directory path falls back to `index.html`.
 */
export async function serveStaticShare(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response> {
  const segments = c.req.path.split("/").filter(Boolean);
  const shareId = segments[0];
  if (!shareId) return c.text("Not found", 404);

  const share = await getStaticShare(c.env.DB, shareId);
  if (!share) return c.text("Not found", 404);
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return c.text("This share has expired", 410);
  }

  // Canonicalize the bare root to a trailing slash. The generated sites use
  // relative links (`page.html`), which the browser resolves against the current
  // directory. Without the slash, `pub.nous.page/{id}` resolves them against the
  // host root (`pub.nous.page/page.html` → 404), so redirect to `/{id}/`.
  if (segments.length === 1 && !c.req.path.endsWith("/")) {
    return c.redirect(`/${shareId}/`, 301);
  }

  let path = segments.slice(1).join("/");
  if (path === "") path = "index.html";

  let file = await getStaticFile(c.env.STORAGE, shareId, path);
  if (!file && !path.split("/").pop()!.includes(".")) {
    // Directory-style path → try its index.html.
    const indexPath = `${path.replace(/\/$/, "")}/index.html`;
    const indexFile = await getStaticFile(c.env.STORAGE, shareId, indexPath);
    if (indexFile) {
      file = indexFile;
      path = indexPath;
    }
  }
  if (!file) return c.text("Not found", 404);

  return new Response(file.data, {
    headers: { "Content-Type": extToContentType(path) },
  });
}
