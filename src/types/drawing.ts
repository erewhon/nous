import { z } from "zod";

// Drawing tool types
export const DrawingToolTypeSchema = z.enum([
  "select",
  "pen",
  "eraser",
  "rectangle",
  "circle",
  "ellipse",
  "line",
  "arrow",
  "text",
]);
export type DrawingToolType = z.infer<typeof DrawingToolTypeSchema>;

// Drawing display modes for editor block
export const DrawingDisplayModeSchema = z.enum(["compact", "standard", "large"]);
export type DrawingDisplayMode = z.infer<typeof DrawingDisplayModeSchema>;

// Fabric.js object serialization schema (simplified - Fabric handles full serialization)
export const FabricObjectSchema = z.object({
  type: z.string(),
  version: z.string().optional(),
  originX: z.string().optional(),
  originY: z.string().optional(),
  left: z.number().optional(),
  top: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fill: z.union([z.string(), z.null()]).optional(),
  stroke: z.union([z.string(), z.null()]).optional(),
  strokeWidth: z.number().optional(),
  strokeDashArray: z.array(z.number()).nullable().optional(),
  strokeLineCap: z.string().optional(),
  strokeLineJoin: z.string().optional(),
  angle: z.number().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  opacity: z.number().optional(),
  visible: z.boolean().optional(),
  // Path data for freehand drawings
  path: z.array(z.unknown()).optional(),
  // Text properties
  text: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  textAlign: z.string().optional(),
  // Circle/ellipse properties
  radius: z.number().optional(),
  rx: z.number().optional(),
  ry: z.number().optional(),
  // Line properties
  x1: z.number().optional(),
  y1: z.number().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
  // Polygon/arrow points
  points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
}).passthrough(); // Allow additional Fabric.js properties

export type FabricObject = z.infer<typeof FabricObjectSchema>;

// Full Fabric.js canvas serialization
export const FabricCanvasDataSchema = z.object({
  version: z.string(),
  objects: z.array(FabricObjectSchema),
  background: z.string().optional(),
  backgroundImage: z.unknown().optional(),
}).passthrough();

export type FabricCanvasData = z.infer<typeof FabricCanvasDataSchema>;

// Drawing block data for Editor.js
export const DrawingBlockDataSchema = z.object({
  // Canvas JSON data (Fabric.js serialization)
  canvasData: FabricCanvasDataSchema.optional(),
  // Canvas dimensions
  width: z.number().default(800),
  height: z.number().default(400),
  // Display mode in editor
  displayMode: DrawingDisplayModeSchema.default("standard"),
  // Optional caption
  caption: z.string().default(""),
  // Timestamp for versioning
  lastModified: z.number().optional(),
});

export type DrawingBlockData = z.infer<typeof DrawingBlockDataSchema>;

// Page annotation data (stored separately per page)
export const PageAnnotationSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  notebookId: z.string(),
  canvasData: FabricCanvasDataSchema,
  // Viewport info for scaling
  viewportWidth: z.number(),
  viewportHeight: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PageAnnotation = z.infer<typeof PageAnnotationSchema>;

// Drawing viewer state (for full-screen mode)
export interface DrawingViewerState {
  isOpen: boolean;
  blockId: string | null;
  drawingData: DrawingBlockData | null;
  selectedTool: DrawingToolType;
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  canUndo: boolean;
  canRedo: boolean;
}

// Annotation overlay state
export interface AnnotationOverlayState {
  isActive: boolean;
  pageId: string | null;
  notebookId: string | null;
  annotationData: PageAnnotation | null;
  selectedTool: DrawingToolType;
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  isModified: boolean;
}

// Default drawing colors
export const DRAWING_COLORS = [
  { name: "Black", value: "#000000" },
  { name: "White", value: "#ffffff" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#22c55e" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Pink", value: "#ec4899" },
] as const;

// Stroke width options
export const STROKE_WIDTHS = [
  { name: "Fine", value: 1 },
  { name: "Thin", value: 2 },
  { name: "Medium", value: 4 },
  { name: "Thick", value: 8 },
  { name: "Bold", value: 12 },
] as const;

// Display mode configuration
export const DISPLAY_MODE_CONFIG: Record<
  DrawingDisplayMode,
  { icon: string; label: string; height: number }
> = {
  compact: { icon: "S", label: "Small", height: 200 },
  standard: { icon: "M", label: "Medium", height: 400 },
  large: { icon: "L", label: "Large", height: 600 },
};
