import { z } from "zod";

// Helper for source field (string or array of strings)
const SourceSchema = z.union([z.string(), z.array(z.string())]);

// Helper for data field (record of string or string array)
const DataSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

// Helper for metadata field
const MetadataSchema = z.record(z.string(), z.unknown()).optional();

// Jupyter notebook cell output types
export const JupyterOutputSchema = z.discriminatedUnion("output_type", [
  z.object({
    output_type: z.literal("stream"),
    name: z.enum(["stdout", "stderr"]),
    text: SourceSchema,
  }),
  z.object({
    output_type: z.literal("execute_result"),
    execution_count: z.number().nullable(),
    data: DataSchema,
    metadata: MetadataSchema,
  }),
  z.object({
    output_type: z.literal("display_data"),
    data: DataSchema,
    metadata: MetadataSchema,
  }),
  z.object({
    output_type: z.literal("error"),
    ename: z.string(),
    evalue: z.string(),
    traceback: z.array(z.string()),
  }),
]);

export type JupyterOutput = z.infer<typeof JupyterOutputSchema>;

// Code cell
export const JupyterCodeCellSchema = z.object({
  cell_type: z.literal("code"),
  execution_count: z.number().nullable().optional(),
  metadata: MetadataSchema,
  source: SourceSchema,
  outputs: z.array(JupyterOutputSchema).optional().default([]),
});

// Markdown cell
export const JupyterMarkdownCellSchema = z.object({
  cell_type: z.literal("markdown"),
  metadata: MetadataSchema,
  source: SourceSchema,
});

// Raw cell
export const JupyterRawCellSchema = z.object({
  cell_type: z.literal("raw"),
  metadata: MetadataSchema,
  source: SourceSchema,
});

export const JupyterCellSchema = z.discriminatedUnion("cell_type", [
  JupyterCodeCellSchema,
  JupyterMarkdownCellSchema,
  JupyterRawCellSchema,
]);

export type JupyterCell = z.infer<typeof JupyterCellSchema>;
export type JupyterCodeCell = z.infer<typeof JupyterCodeCellSchema>;
export type JupyterMarkdownCell = z.infer<typeof JupyterMarkdownCellSchema>;

// Kernel spec
export const JupyterKernelSpecSchema = z.object({
  display_name: z.string().optional(),
  language: z.string().optional(),
  name: z.string().optional(),
});

// Language info
export const JupyterLanguageInfoSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  codemirror_mode: z.union([z.string(), z.object({ name: z.string() })]).optional(),
  file_extension: z.string().optional(),
  mimetype: z.string().optional(),
});

// Notebook metadata
export const JupyterMetadataSchema = z.object({
  kernelspec: JupyterKernelSpecSchema.optional(),
  language_info: JupyterLanguageInfoSchema.optional(),
}).passthrough();

// Full notebook
export const JupyterNotebookSchema = z.object({
  nbformat: z.number(),
  nbformat_minor: z.number(),
  metadata: JupyterMetadataSchema.optional().default({}),
  cells: z.array(JupyterCellSchema),
});

export type JupyterNotebook = z.infer<typeof JupyterNotebookSchema>;

// Helper to normalize source (can be string or array of strings)
export function normalizeSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source;
}
