import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";

interface ImageUploaderConfig {
  notebookId: string;
}

interface UploadResponse {
  success: number;
  file: {
    url: string;
  };
}

export function createImageUploader(config: ImageUploaderConfig) {
  return {
    async uploadByFile(file: File): Promise<UploadResponse> {
      try {
        // Get notebook assets path from backend
        const assetsPath = await invoke<string>("get_notebook_assets_path", {
          notebookId: config.notebookId,
        });

        // Ensure assets directory exists
        const dirExists = await exists(assetsPath);
        if (!dirExists) {
          await mkdir(assetsPath, { recursive: true });
        }

        // Generate unique filename
        const timestamp = Date.now();
        const randomPart = Math.random().toString(36).substring(2, 10);
        const extension = file.name.split(".").pop() || "png";
        const filename = `${timestamp}-${randomPart}.${extension}`;
        const filePath = `${assetsPath}/${filename}`;

        // Read file as ArrayBuffer and write
        const arrayBuffer = await file.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));

        // Return convertFileSrc URL for display
        const url = convertFileSrc(filePath);

        return {
          success: 1,
          file: { url },
        };
      } catch (error) {
        console.error("Image upload failed:", error);
        return {
          success: 0,
          file: { url: "" },
        };
      }
    },

    async uploadByUrl(url: string): Promise<UploadResponse> {
      // For external URLs, just pass through
      // In the future, we could download and store locally
      return {
        success: 1,
        file: { url },
      };
    },
  };
}
