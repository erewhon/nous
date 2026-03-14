/**
 * R2 storage helpers for encrypted notebook data.
 *
 * Layout:
 *   notebooks/{userId}/{notebookId}/meta.enc
 *   notebooks/{userId}/{notebookId}/pages/{pageId}.enc
 *   notebooks/{userId}/{notebookId}/assets/{hash}.enc
 */

function pagePath(userId: string, notebookId: string, pageId: string): string {
  return `notebooks/${userId}/${notebookId}/pages/${pageId}.enc`;
}

function metaPath(userId: string, notebookId: string): string {
  return `notebooks/${userId}/${notebookId}/meta.enc`;
}

function notebookPrefix(userId: string, notebookId: string): string {
  return `notebooks/${userId}/${notebookId}/`;
}

export async function putPage(
  bucket: R2Bucket,
  userId: string,
  notebookId: string,
  pageId: string,
  data: ArrayBuffer,
): Promise<void> {
  await bucket.put(pagePath(userId, notebookId, pageId), data);
}

export async function getPage(
  bucket: R2Bucket,
  userId: string,
  notebookId: string,
  pageId: string,
): Promise<ArrayBuffer | null> {
  const obj = await bucket.get(pagePath(userId, notebookId, pageId));
  if (!obj) return null;
  return obj.arrayBuffer();
}

export async function deletePage(
  bucket: R2Bucket,
  userId: string,
  notebookId: string,
  pageId: string,
): Promise<void> {
  await bucket.delete(pagePath(userId, notebookId, pageId));
}

export async function putMeta(
  bucket: R2Bucket,
  userId: string,
  notebookId: string,
  data: ArrayBuffer,
): Promise<void> {
  await bucket.put(metaPath(userId, notebookId), data);
}

export async function getMeta(
  bucket: R2Bucket,
  userId: string,
  notebookId: string,
): Promise<ArrayBuffer | null> {
  const obj = await bucket.get(metaPath(userId, notebookId));
  if (!obj) return null;
  return obj.arrayBuffer();
}

/**
 * List all page IDs stored for a notebook.
 */
export async function listPageIds(
  bucket: R2Bucket,
  userId: string,
  notebookId: string,
): Promise<string[]> {
  const prefix = `${notebookPrefix(userId, notebookId)}pages/`;
  const listed = await bucket.list({ prefix });
  return listed.objects.map((obj) => {
    // Strip prefix and .enc suffix
    const name = obj.key.slice(prefix.length);
    return name.endsWith(".enc") ? name.slice(0, -4) : name;
  });
}

/**
 * Delete all objects for a notebook (pages, meta, assets).
 */
export async function deleteAllNotebookData(
  bucket: R2Bucket,
  userId: string,
  notebookId: string,
): Promise<void> {
  const prefix = notebookPrefix(userId, notebookId);
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((o) => o.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
