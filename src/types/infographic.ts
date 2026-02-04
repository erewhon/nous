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

// ===== State Types =====

export interface InfographicState {
  isGenerating: boolean;
  error: string | null;
  result: InfographicResult | null;
  selectedTemplate: InfographicTemplate;
  config: Partial<InfographicConfig>;
  availability: InfographicAvailability | null;
}
