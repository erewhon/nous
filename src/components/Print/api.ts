import { invoke } from "@tauri-apps/api/core";

export interface PrintOptions {
  includeToc: boolean;
  includeMetadata: boolean;
}

export async function generatePrintHtml(
  notebookId: string,
  pageId: string,
  options: PrintOptions
): Promise<string> {
  return invoke<string>("generate_print_html", {
    notebookId,
    pageId,
    options,
  });
}
