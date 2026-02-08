import { z } from "zod";

// ===== External File Format =====

export const ExternalFileFormatSchema = z.enum(["json", "markdown", "plainText"]);

export type ExternalFileFormat = z.infer<typeof ExternalFileFormatSchema>;

export const EXTERNAL_FILE_FORMATS: {
  value: ExternalFileFormat;
  label: string;
  extensions: string[];
}[] = [
  { value: "json", label: "JSON", extensions: [".json"] },
  { value: "markdown", label: "Markdown", extensions: [".md", ".markdown"] },
  { value: "plainText", label: "Plain Text", extensions: [".txt", ".text"] },
];

// ===== Processed File Info =====

export const ProcessedFileInfoSchema = z.object({
  path: z.string(),
  modifiedAt: z.string(),
  processedAt: z.string(),
  pageId: z.string().optional(),
});

export type ProcessedFileInfo = z.infer<typeof ProcessedFileInfoSchema>;

// ===== External Source =====

export const ExternalSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  pathPattern: z.string(),
  fileFormats: z.array(ExternalFileFormatSchema).default([]),
  enabled: z.boolean().default(true),
  lastProcessed: z.string().optional(),
  processedFiles: z.array(ProcessedFileInfoSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ExternalSource = z.infer<typeof ExternalSourceSchema>;

// ===== Resolved File Info =====

export const ResolvedFileInfoSchema = z.object({
  path: z.string(),
  format: ExternalFileFormatSchema,
  sizeBytes: z.number(),
  modifiedAt: z.string(),
});

export type ResolvedFileInfo = z.infer<typeof ResolvedFileInfoSchema>;

// ===== Request Types =====

export interface CreateExternalSourceRequest {
  name: string;
  pathPattern: string;
  fileFormats?: ExternalFileFormat[];
  enabled?: boolean;
}

export interface UpdateExternalSourceRequest {
  name?: string;
  pathPattern?: string;
  fileFormats?: ExternalFileFormat[];
  enabled?: boolean;
}
