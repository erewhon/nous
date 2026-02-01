import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import type { PDFUploadResponse } from "../../types/pdf";

interface PDFUploaderConfig {
  notebookId: string;
}

export function createPDFUploader(config: PDFUploaderConfig) {
  return {
    async uploadByFile(file: File): Promise<PDFUploadResponse> {
      try {
        // Validate file type
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          console.error("Invalid file type:", file.type);
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

        // Generate unique filename
        const timestamp = Date.now();
        const randomPart = Math.random().toString(36).substring(2, 10);
        const filename = `${timestamp}-${randomPart}.pdf`;
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
        console.error("PDF upload failed:", error);
        return {
          success: 0,
          file: { url: "", filename: "", originalName: file.name },
        };
      }
    },
  };
}
