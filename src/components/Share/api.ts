import { invoke } from "@tauri-apps/api/core";

export interface ShareRecord {
  id: string;
  pageId: string;
  notebookId: string;
  pageTitle: string;
  theme: string;
  expiry: string;
  createdAt: string;
  expiresAt: string | null;
  externalUrl: string | null;
}

export interface SharePageResponse {
  share: ShareRecord;
  localUrl: string;
}

export async function sharePage(
  notebookId: string,
  pageId: string,
  theme: string,
  expiry: string
): Promise<SharePageResponse> {
  return invoke("share_page", {
    request: { notebookId, pageId, theme, expiry },
  });
}

export async function listShares(): Promise<ShareRecord[]> {
  return invoke("list_shares");
}

export async function deleteShare(shareId: string): Promise<void> {
  return invoke("delete_share", { shareId });
}
