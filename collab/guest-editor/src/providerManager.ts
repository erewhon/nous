/**
 * Lazy provider manager for multi-page guest editor.
 * Creates/destroys Yjs providers per page as guests navigate.
 */

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import type { BlockNoteEditorOptions } from "@blocknote/core";

type CollaborationOptions = NonNullable<BlockNoteEditorOptions<any, any, any>["collaboration"]>;

const PARTYKIT_HOST = "party.nous.page";

interface PageProvider {
  doc: Y.Doc;
  provider: YPartyKitProvider;
  fragment: Y.XmlFragment;
  collabOptions: CollaborationOptions;
}

const providers = new Map<string, PageProvider>();

function makeRoomId(notebookId: string, pageId: string): string {
  return `${notebookId}:${pageId}`;
}

export function getOrCreateProvider(
  pageId: string,
  notebookId: string,
  token: string,
  user: { name: string; color: string },
  isReadOnly: boolean,
): PageProvider {
  const existing = providers.get(pageId);
  if (existing) return existing;

  const roomId = makeRoomId(notebookId, pageId);
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("document-store");

  const provider = new YPartyKitProvider(
    PARTYKIT_HOST,
    roomId,
    doc,
    {
      party: "collab-server",
      params: { token },
      connect: true,
    }
  );

  provider.awareness.setLocalState({
    user: {
      name: isReadOnly ? "Viewer" : "Guest",
      color: user.color,
    },
  });

  const collabOptions: CollaborationOptions = {
    fragment,
    user: { name: isReadOnly ? "Viewer" : "Guest", color: user.color },
    provider: { awareness: provider.awareness },
    showCursorLabels: "activity",
  };

  const entry: PageProvider = { doc, provider, fragment, collabOptions };
  providers.set(pageId, entry);
  return entry;
}

export function destroyProvider(pageId: string): void {
  const entry = providers.get(pageId);
  if (!entry) return;

  entry.provider.awareness.setLocalState(null);
  entry.provider.disconnect();
  entry.provider.destroy();
  entry.doc.destroy();
  providers.delete(pageId);
}

export function destroyAll(): void {
  for (const pageId of [...providers.keys()]) {
    destroyProvider(pageId);
  }
}

export function hasProvider(pageId: string): boolean {
  return providers.has(pageId);
}
