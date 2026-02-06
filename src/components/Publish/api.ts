import { invoke } from "@tauri-apps/api/core";

export interface PublishOptions {
  includeAssets: boolean;
  includeBacklinks: boolean;
  siteTitle: string | null;
}

export interface PublishResult {
  outputDir: string;
  pageCount: number;
  assetCount: number;
}

export async function publishNotebook(
  notebookId: string,
  outputDir: string,
  theme: string,
  options: PublishOptions
): Promise<PublishResult> {
  return invoke("publish_notebook", {
    notebookId,
    outputDir,
    theme,
    options,
  });
}

export async function publishSelectedPages(
  notebookId: string,
  pageIds: string[],
  outputDir: string,
  theme: string,
  options: PublishOptions
): Promise<PublishResult> {
  return invoke("publish_selected_pages", {
    notebookId,
    pageIds,
    outputDir,
    theme,
    options,
  });
}

export async function previewPublishPage(
  notebookId: string,
  pageId: string,
  theme: string
): Promise<string> {
  return invoke("preview_publish_page", {
    notebookId,
    pageId,
    theme,
  });
}
