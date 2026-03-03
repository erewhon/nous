/**
 * Deterministic room ID construction.
 * Must match the Rust `make_room_id()` format.
 */
export function makeRoomId(notebookId: string, pageId: string): string {
  return `${notebookId}:${pageId}`;
}
