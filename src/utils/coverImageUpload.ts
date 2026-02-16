import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";

/**
 * Upload a cover image for a notebook and return a convertFileSrc URL.
 */
export async function uploadCoverImage(
  notebookId: string,
  file: File
): Promise<string> {
  const assetsPath = await invoke<string>("get_notebook_assets_path", {
    notebookId,
  });

  const dirExists = await exists(assetsPath);
  if (!dirExists) {
    await mkdir(assetsPath, { recursive: true });
  }

  const ext = file.name.split(".").pop() || "png";
  const filename = `cover-${Date.now()}.${ext}`;
  const filePath = `${assetsPath}/${filename}`;

  const buf = await file.arrayBuffer();
  await writeFile(filePath, new Uint8Array(buf));

  return convertFileSrc(filePath);
}
