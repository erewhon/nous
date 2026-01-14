import { z } from "zod";

// Capture source - where the inbox item came from
export const CaptureSourceSchema = z.union([
  z.object({ type: z.literal("quickCapture") }),
  z.object({ type: z.literal("webClipper"), url: z.string().url() }),
  z.object({ type: z.literal("email"), from: z.string() }),
  z.object({ type: z.literal("api"), source: z.string() }),
  z.object({ type: z.literal("import"), format: z.string() }),
]);

export type CaptureSource = z.infer<typeof CaptureSourceSchema>;

// Classification action - what should happen to the item
export const ClassificationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CreatePage"),
    notebook_id: z.string().uuid(),
    notebook_name: z.string(),
    suggested_title: z.string(),
    suggested_tags: z.array(z.string()),
  }),
  z.object({
    type: z.literal("AppendToPage"),
    notebook_id: z.string().uuid(),
    notebook_name: z.string(),
    page_id: z.string().uuid(),
    page_title: z.string(),
  }),
  z.object({
    type: z.literal("CreateNotebook"),
    suggested_name: z.string(),
    suggested_icon: z.string().optional(),
  }),
  z.object({
    type: z.literal("KeepInInbox"),
    reason: z.string(),
  }),
]);

export type ClassificationAction = z.infer<typeof ClassificationActionSchema>;

// Classification result from AI
export const InboxClassificationSchema = z.object({
  action: ClassificationActionSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export type InboxClassification = z.infer<typeof InboxClassificationSchema>;

// Inbox item
export const InboxItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  captured_at: z.string().datetime(),
  source: CaptureSourceSchema,
  classification: InboxClassificationSchema.nullable().optional(),
  is_processed: z.boolean(),
});

export type InboxItem = z.infer<typeof InboxItemSchema>;

// Capture request
export const CaptureRequestSchema = z.object({
  title: z.string().min(1),
  content: z.string().default(""),
  tags: z.array(z.string()).default([]),
  source: CaptureSourceSchema.optional(),
});

export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

// Action override for batch processing
export const ActionOverrideSchema = z.object({
  item_id: z.string().uuid(),
  action: ClassificationActionSchema,
});

export type ActionOverride = z.infer<typeof ActionOverrideSchema>;

// Apply actions request
export const ApplyActionsRequestSchema = z.object({
  item_ids: z.array(z.string().uuid()),
  overrides: z.array(ActionOverrideSchema).optional(),
});

export type ApplyActionsRequest = z.infer<typeof ApplyActionsRequestSchema>;

// Apply actions result
export const ApplyActionsResultSchema = z.object({
  processed_count: z.number(),
  created_pages: z.array(z.string().uuid()),
  updated_pages: z.array(z.string().uuid()),
  created_notebooks: z.array(z.string().uuid()),
  errors: z.array(z.string()),
});

export type ApplyActionsResult = z.infer<typeof ApplyActionsResultSchema>;

// Inbox summary
export const InboxSummarySchema = z.object({
  total_count: z.number(),
  unprocessed_count: z.number(),
  unclassified_count: z.number(),
  classified_count: z.number(),
});

export type InboxSummary = z.infer<typeof InboxSummarySchema>;
