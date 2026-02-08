import { z } from "zod";

// ===== Infographic Template Types =====

export const InfographicTemplateSchema = z.enum([
  "key_concepts",
  "executive_summary",
  "timeline",
  "concept_map",
]);
export type InfographicTemplate = z.infer<typeof InfographicTemplateSchema>;

export const InfographicThemeSchema = z.enum(["light", "dark"]);
export type InfographicTheme = z.infer<typeof InfographicThemeSchema>;

// ===== Configuration Types =====

export const InfographicConfigSchema = z.object({
  template: InfographicTemplateSchema,
  width: z.number().default(1200),
  height: z.number().default(800),
  theme: InfographicThemeSchema.default("light"),
  title: z.string().nullable().optional(),
});
export type InfographicConfig = z.infer<typeof InfographicConfigSchema>;

// ===== Result Types =====

export const InfographicResultSchema = z.object({
  svgContent: z.string(),
  pngPath: z.string().nullable().optional(),
  width: z.number(),
  height: z.number(),
  generationTimeSeconds: z.number(),
});
export type InfographicResult = z.infer<typeof InfographicResultSchema>;

// ===== Availability Types =====

export const InfographicAvailabilitySchema = z.object({
  svgGeneration: z.boolean(),
  pngExport: z.boolean(),
});
export type InfographicAvailability = z.infer<
  typeof InfographicAvailabilitySchema
>;

// ===== Template Display Info =====

export interface InfographicTemplateInfo {
  id: InfographicTemplate;
  name: string;
  description: string;
  dataSource: string;
}

export const INFOGRAPHIC_TEMPLATES: InfographicTemplateInfo[] = [
  {
    id: "key_concepts",
    name: "Key Concepts Card",
    description: "Grid of term/definition cards from study guide key concepts",
    dataSource: "Study Guide",
  },
  {
    id: "executive_summary",
    name: "Executive Summary",
    description:
      "Title, key findings, and recommendations from briefing document",
    dataSource: "Briefing Document",
  },
  {
    id: "timeline",
    name: "Timeline Graphic",
    description: "Horizontal timeline of dated events",
    dataSource: "Timeline",
  },
  {
    id: "concept_map",
    name: "Concept Map Poster",
    description: "Static node/link diagram of concepts and relationships",
    dataSource: "Concept Graph",
  },
];

// ===== Size Presets =====

export interface InfographicSizePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  description: string;
}

export const INFOGRAPHIC_SIZE_PRESETS: InfographicSizePreset[] = [
  { id: "social", name: "Social Media", width: 1080, height: 1080, description: "Square (Instagram, Facebook)" },
  { id: "story", name: "Story/Reel", width: 1080, height: 1920, description: "Vertical (Stories, TikTok)" },
  { id: "presentation", name: "Presentation", width: 1920, height: 1080, description: "16:9 (Slides, YouTube)" },
  { id: "poster", name: "Poster", width: 1200, height: 1600, description: "3:4 Portrait" },
  { id: "wide", name: "Wide Banner", width: 1600, height: 600, description: "Horizontal banner" },
  { id: "custom", name: "Custom", width: 1200, height: 800, description: "Set your own dimensions" },
];

// ===== State Types =====

export interface InfographicState {
  isGenerating: boolean;
  error: string | null;
  result: InfographicResult | null;
  selectedTemplate: InfographicTemplate;
  config: Partial<InfographicConfig>;
  availability: InfographicAvailability | null;
}
