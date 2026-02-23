import { z } from "zod";

// Capture method enum
export const CaptureMethodSchema = z.enum(["aiVision", "accessibility", "both"]);
export type CaptureMethod = z.infer<typeof CaptureMethodSchema>;

// App category enum
export const AppCategorySchema = z.enum([
  "chat",
  "email",
  "notifications",
  "browser",
  "custom",
]);
export type AppCategory = z.infer<typeof AppCategorySchema>;

// Monitor target configuration
export const MonitorTargetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  windowMatch: z.string(),
  category: AppCategorySchema,
  captureMethod: CaptureMethodSchema,
  intervalSecs: z.number().int().positive(),
  enabled: z.boolean(),
  watchInstructions: z.string().nullable().optional(),
  sendToInbox: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MonitorTarget = z.infer<typeof MonitorTargetSchema>;

// Captured item (structured sub-item)
export const CapturedItemSchema = z.object({
  itemType: z.string(),
  sender: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  content: z.string(),
  timestamp: z.string().nullable().optional(),
  urgency: z.string().nullable().optional(),
});
export type CapturedItem = z.infer<typeof CapturedItemSchema>;

// Capture event
export const CaptureEventSchema = z.object({
  id: z.string().uuid(),
  targetId: z.string().uuid(),
  targetName: z.string(),
  capturedAt: z.string(),
  captureMethod: CaptureMethodSchema,
  content: z.string(),
  items: z.array(CapturedItemSchema),
  screenshotPath: z.string().nullable().optional(),
  isRead: z.boolean(),
  sentToInbox: z.boolean(),
});
export type CaptureEvent = z.infer<typeof CaptureEventSchema>;

// Window info for discovery
export const WindowInfoSchema = z.object({
  windowId: z.string(),
  title: z.string(),
  className: z.string().nullable().optional(),
});
export type WindowInfo = z.infer<typeof WindowInfoSchema>;

// Request types
export interface CreateTargetRequest {
  name: string;
  windowMatch: string;
  category?: AppCategory;
  captureMethod?: CaptureMethod;
  intervalSecs?: number;
  watchInstructions?: string;
  sendToInbox?: boolean;
}

export interface UpdateTargetRequest {
  name?: string;
  windowMatch?: string;
  category?: AppCategory;
  captureMethod?: CaptureMethod;
  intervalSecs?: number;
  enabled?: boolean;
  watchInstructions?: string;
  sendToInbox?: boolean;
}
