import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import type { VideoUploadResponse } from "../../types/video";
import { SUPPORTED_VIDEO_MIMETYPES, SUPPORTED_VIDEO_EXTENSIONS } from "../../types/video";

interface VideoUploaderConfig {
  notebookId: string;
}

/**
 * Check if file is a supported video format.
 */
function isVideoFile(file: File): boolean {
  const mimeOk = SUPPORTED_VIDEO_MIMETYPES.includes(
    file.type as (typeof SUPPORTED_VIDEO_MIMETYPES)[number]
  );
  const extOk = SUPPORTED_VIDEO_EXTENSIONS.some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );
  return mimeOk || extOk;
}

/**
 * Get the file extension from a filename.
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Create a video uploader for a specific notebook.
 */
export function createVideoUploader(config: VideoUploaderConfig) {
  return {
    async uploadByFile(file: File): Promise<VideoUploadResponse> {
      try {
        // Validate file type
        if (!isVideoFile(file)) {
          console.error("Invalid video file type:", file.type);
          return {
            success: 0,
            file: { url: "", filename: "", originalName: file.name },
          };
        }

        // Get notebook assets path from backend
        const assetsPath = await invoke<string>("get_notebook_assets_path", {
          notebookId: config.notebookId,
        });

        // Ensure assets directory exists
        const dirExists = await exists(assetsPath);
        if (!dirExists) {
          await mkdir(assetsPath, { recursive: true });
        }

        // Generate unique filename preserving extension
        const timestamp = Date.now();
        const randomPart = Math.random().toString(36).substring(2, 10);
        const ext = getExtension(file.name) || ".mp4";
        const filename = `${timestamp}-${randomPart}${ext}`;
        const filePath = `${assetsPath}/${filename}`;

        // Read file as ArrayBuffer and write
        const arrayBuffer = await file.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));

        // Return convertFileSrc URL for display
        const url = convertFileSrc(filePath);

        return {
          success: 1,
          file: {
            url,
            filename,
            originalName: file.name,
          },
        };
      } catch (error) {
        console.error("Video upload failed:", error);
        return {
          success: 0,
          file: { url: "", filename: "", originalName: file.name },
        };
      }
    },
  };
}
