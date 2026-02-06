import { invoke } from "@tauri-apps/api/core";

export interface PresentationOptions {
  theme: string;
  transition: string;
}

export async function generatePresentation(
  notebookId: string,
  pageId: string,
  options: PresentationOptions
): Promise<string> {
  return invoke<string>("generate_presentation", {
    notebookId,
    pageId,
    options,
  });
}
