import { invoke } from "@tauri-apps/api/core";

export type ShareType =
  | { type: "single_page"; pageId: string }
  | { type: "folder"; folderId: string }
  | { type: "section"; sectionId: string };

export interface ShareRecord {
  id: string;
  shareType?: ShareType;
  notebookId: string;
  title: string;
  theme: string;
  expiry: string;
  createdAt: string;
  expiresAt: string | null;
  externalUrl: string | null;
  pageCount?: number;
  // Backward compat
  pageId?: string;
  pageTitle?: string;
}

export interface SharePageResponse {
  share: ShareRecord;
  localUrl: string;
}

export async function sharePage(
  notebookId: string,
  pageId: string,
  theme: string,
  expiry: string,
  uploadExternal: boolean = false
): Promise<SharePageResponse> {
  return invoke("share_page", {
    request: { notebookId, pageId, theme, expiry, uploadExternal },
  });
}

export async function listShares(): Promise<ShareRecord[]> {
  return invoke("list_shares");
}

export async function deleteShare(shareId: string): Promise<void> {
  return invoke("delete_share", { shareId });
}

// ===== Folder / Section Sharing =====

export async function shareFolder(
  notebookId: string,
  folderId: string,
  theme: string,
  expiry: string,
  uploadExternal: boolean = false,
  siteTitle?: string
): Promise<SharePageResponse> {
  return invoke("share_folder", {
    request: { notebookId, folderId, theme, expiry, uploadExternal, siteTitle },
  });
}

export async function shareSection(
  notebookId: string,
  sectionId: string,
  theme: string,
  expiry: string,
  uploadExternal: boolean = false,
  siteTitle?: string
): Promise<SharePageResponse> {
  return invoke("share_section", {
    request: { notebookId, sectionId, theme, expiry, uploadExternal, siteTitle },
  });
}

// ===== S3 Upload Configuration =====

export interface ShareUploadConfigInput {
  endpointUrl: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  publicUrlBase: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ShareUploadConfigResponse {
  endpointUrl: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  publicUrlBase: string;
  hasCredentials: boolean;
}

export async function configureShareUpload(
  configInput: ShareUploadConfigInput
): Promise<void> {
  return invoke("configure_share_upload", { configInput });
}

export async function getShareUploadConfig(): Promise<ShareUploadConfigResponse | null> {
  return invoke("get_share_upload_config");
}

export async function testShareUpload(
  configInput: ShareUploadConfigInput
): Promise<void> {
  return invoke("test_share_upload", { configInput });
}

export async function removeShareUploadConfig(): Promise<void> {
  return invoke("remove_share_upload_config");
}
