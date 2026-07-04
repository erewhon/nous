import { invoke } from "../../platform/core";
import { convertFileSrc } from "../../platform/core";
import { writeFile, mkdir, exists } from "../../platform/fs";
import { isTauri } from "../../utils/platform";
import { daemonPutBytes } from "../../utils/daemon";
import { buildDaemonAssetUrl } from "../../utils/assetUrl";

interface ImageUploaderConfig {
  notebookId: string;
}

function uniqueAssetFilename(originalName: string): string {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 10);
  const extension = originalName.split(".").pop() || "png";
  return `${timestamp}-${randomPart}.${extension}`;
}

/**
 * BlockNote `uploadFile` handler (drag-drop, paste, and the file panel's
 * Upload tab). Returns the URL to store on the image block.
 *
 * Desktop: writes to the notebook assets dir via the fs plugin and returns
 * a convertFileSrc URL (same flow as the legacy Editor.js uploader below).
 * Browser: PUTs the bytes to the daemon's asset route and returns a daemon
 * asset URL. Either form is normalized to asset://{nb}/{file} when the
 * page is saved (see unresolveAssetUrl in blockFormatConverter).
 */
export function createBlockNoteUploadFile(
  getNotebookId: () => string | undefined
) {
  return async (file: File): Promise<string> => {
    const notebookId = getNotebookId();
    if (!notebookId) {
      throw new Error("Cannot upload: no notebook selected");
    }
    const filename = uniqueAssetFilename(file.name);

    if (!isTauri()) {
      await daemonPutBytes(
        `/api/notebooks/${notebookId}/assets/${filename}`,
        file,
        file.type || "application/octet-stream"
      );
      return buildDaemonAssetUrl(notebookId, filename);
    }

    const assetsPath = await invoke<string>("get_notebook_assets_path", {
      notebookId,
    });
    if (!(await exists(assetsPath))) {
      await mkdir(assetsPath, { recursive: true });
    }
    const filePath = `${assetsPath}/${filename}`;
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(filePath, new Uint8Array(arrayBuffer));
    return convertFileSrc(filePath);
  };
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
