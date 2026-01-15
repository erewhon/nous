import { z } from "zod";

// Bounding rectangle for highlight position
export const PDFRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type PDFRect = z.infer<typeof PDFRectSchema>;

// Highlight annotation on PDF text
export const PDFHighlightSchema = z.object({
  id: z.string(),
  pageNumber: z.number().int().positive(),
  // Bounding rectangles (for multi-line highlights)
  rects: z.array(PDFRectSchema),
  // Selected text content
  selectedText: z.string(),
  // Optional user note attached to highlight
  note: z.string().optional(),
  // Highlight color (hex)
  color: z.string().default("#facc15"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PDFHighlight = z.infer<typeof PDFHighlightSchema>;

// Display modes for PDF block
export const PDFDisplayModeSchema = z.enum(["thumbnail", "preview", "full"]);
export type PDFDisplayMode = z.infer<typeof PDFDisplayModeSchema>;

// PDF block data stored in Editor.js
export const PDFBlockDataSchema = z.object({
  // Asset filename (e.g., "1704067200000-abc123.pdf")
  filename: z.string(),
  // Full URL for rendering (convertFileSrc result)
  url: z.string(),
  // Original filename for display
  originalName: z.string().optional(),
  // Caption below PDF
  caption: z.string().default(""),
  // Current page in block view (1-indexed)
  currentPage: z.number().int().positive().default(1),
  // Total pages (cached after load)
  totalPages: z.number().int().positive().optional(),
  // Display mode in editor
  displayMode: PDFDisplayModeSchema.default("preview"),
  // Inline annotations stored with the block
  highlights: z.array(PDFHighlightSchema).default([]),
});

export type PDFBlockData = z.infer<typeof PDFBlockDataSchema>;

// Full-screen viewer state
export interface PDFViewerState {
  isOpen: boolean;
  blockId: string | null;
  pdfData: PDFBlockData | null;
  currentPage: number;
  zoom: number;
  isAnnotating: boolean;
  selectedHighlightId: string | null;
  selectedColor: string;
}

// Default highlight colors
export const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#facc15" },
  { name: "Green", value: "#4ade80" },
  { name: "Blue", value: "#60a5fa" },
  { name: "Pink", value: "#f472b6" },
  { name: "Orange", value: "#fb923c" },
] as const;

// PDF uploader response
export interface PDFUploadResponse {
  success: number;
  file: {
    url: string;
    filename: string;
    originalName: string;
  };
}

// Extracted highlight for export to page
export interface ExtractedHighlight {
  pageNumber: number;
  text: string;
  note?: string;
  color: string;
}
