import { z } from "zod";

export const ActivityTypeSchema = z.enum([
  "message",
  "call",
  "faceTimeAudio",
  "faceTimeVideo",
  "missedCall",
]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const DirectionSchema = z.enum(["incoming", "outgoing"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const ContactSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phoneNumbers: z.array(z.string()).default([]),
  emails: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(""),
  lastContacted: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ContactActivitySchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  activityType: ActivityTypeSchema,
  direction: DirectionSchema,
  timestamp: z.string(),
  preview: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
});
export type ContactActivity = z.infer<typeof ContactActivitySchema>;

export const HarvestStateSchema = z.object({
  lastMessageTimestamp: z.number().nullable().optional(),
  lastCallTimestamp: z.number().nullable().optional(),
  lastContactTimestamp: z.number().nullable().optional(),
});
export type HarvestState = z.infer<typeof HarvestStateSchema>;

export const HarvestResultSchema = z.object({
  contactsAdded: z.number(),
  contactsUpdated: z.number(),
  activitiesAdded: z.number(),
});
export type HarvestResult = z.infer<typeof HarvestResultSchema>;

export const UpdateContactRequestSchema = z.object({
  name: z.string().optional(),
  phoneNumbers: z.array(z.string()).optional(),
  emails: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
export type UpdateContactRequest = z.infer<typeof UpdateContactRequestSchema>;
