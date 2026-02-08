import { z } from "zod";
import { FabricCanvasDataSchema } from "./drawing";

// Canvas tool types - extends drawing tools with canvas-specific tools
export const CanvasToolTypeSchema = z.enum([
  // Navigation
  "select",
  "pan",
  // Drawing (existing)
  "pen",
  "eraser",
  "rectangle",
  "circle",
  "ellipse",
  "line",
  "arrow",
  "text",
  // Canvas-specific
  "textCard",
  "pageCard",
  "connection",
]);
export type CanvasToolType = z.infer<typeof CanvasToolTypeSchema>;

// TextCard schema - standalone editable text content
export const TextCardSchema = z.object({
  id: z.string().uuid(),
  elementType: z.literal("textCard"),
  content: z.string(), // Plain text or markdown
  width: z.number().default(200),
  height: z.number().default(150),
  backgroundColor: z.string().optional(),
});
export type TextCard = z.infer<typeof TextCardSchema>;

// PageCard schema - embedded reference to existing pages
export const PageCardSchema = z.object({
  id: z.string().uuid(),
  elementType: z.literal("pageCard"),
  pageId: z.string().uuid(),
  pageTitle: z.string(), // Cached for display
  notebookId: z.string().uuid(),
  width: z.number().default(220),
  height: z.number().default(160),
  showPreview: z.boolean().default(true),
});
export type PageCard = z.infer<typeof PageCardSchema>;

// Connection schema - lines between cards
export const ConnectionSchema = z.object({
  id: z.string().uuid(),
  elementType: z.literal("connection"),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  label: z.string().optional(),
  arrowEnd: z.boolean().default(true),
});
export type Connection = z.infer<typeof ConnectionSchema>;

// Canvas element union type
export const CanvasElementSchema = z.discriminatedUnion("elementType", [
  TextCardSchema,
  PageCardSchema,
  ConnectionSchema,
]);
export type CanvasElement = z.infer<typeof CanvasElementSchema>;

// Viewport state for pan/zoom
export const ViewportStateSchema = z.object({
  panX: z.number().default(0),
  panY: z.number().default(0),
  zoom: z.number().default(1),
});
export type ViewportState = z.infer<typeof ViewportStateSchema>;

// Canvas settings
export const CanvasSettingsSchema = z.object({
  gridEnabled: z.boolean().default(true),
  gridSize: z.number().default(20),
  snapToGrid: z.boolean().default(false),
  backgroundColor: z.string().default("#1e1e2e"),
});
export type CanvasSettings = z.infer<typeof CanvasSettingsSchema>;

// Full canvas page content schema
export const CanvasPageContentSchema = z.object({
  version: z.string().default("1.0"),
  fabricData: FabricCanvasDataSchema.optional(), // Fabric.js toJSON() output
  viewport: ViewportStateSchema.optional(),
  elements: z.record(z.string(), CanvasElementSchema).default({}),
  settings: CanvasSettingsSchema.optional(),
});
export type CanvasPageContent = z.infer<typeof CanvasPageContentSchema>;

// Canvas editor state (for UI)
export interface CanvasEditorState {
  isLoaded: boolean;
  selectedTool: CanvasToolType;
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  viewport: ViewportState;
  settings: CanvasSettings;
  selectedElementIds: string[];
  canUndo: boolean;
  canRedo: boolean;
}

// Canvas defaults
export const CANVAS_DEFAULTS = {
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 4,
  GRID_SIZE: 20,
  DEFAULT_TEXT_CARD_WIDTH: 200,
  DEFAULT_TEXT_CARD_HEIGHT: 150,
  DEFAULT_PAGE_CARD_WIDTH: 220,
  DEFAULT_PAGE_CARD_HEIGHT: 160,
  BACKGROUND_COLOR: "#1e1e2e",
} as const;

// Canvas colors for cards
export const CANVAS_CARD_COLORS = [
  { name: "Default", value: "#2d2d3d" },
  { name: "Blue", value: "#1e3a5f" },
  { name: "Green", value: "#1e3d2f" },
  { name: "Purple", value: "#2d1e3d" },
  { name: "Orange", value: "#3d2d1e" },
  { name: "Red", value: "#3d1e1e" },
  { name: "Yellow", value: "#3d3d1e" },
] as const;
