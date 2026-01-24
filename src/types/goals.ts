import { z } from "zod";

// Frequency of goal tracking
export const FrequencySchema = z.enum(["daily", "weekly", "monthly"]);
export type Frequency = z.infer<typeof FrequencySchema>;

// How the goal is tracked
export const TrackingTypeSchema = z.enum(["auto", "manual"]);
export type TrackingType = z.infer<typeof TrackingTypeSchema>;

// Type of auto-detection
export const AutoDetectTypeSchema = z.enum(["git_commit", "jj_commit", "page_edit", "page_create"]);
export type AutoDetectType = z.infer<typeof AutoDetectTypeSchema>;

// Scope for auto-detection
export const AutoDetectScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("library"), id: z.string() }),
  z.object({ type: z.literal("notebook"), id: z.string() }),
  z.object({ type: z.literal("section"), notebookId: z.string(), sectionId: z.string() }),
]);
export type AutoDetectScope = z.infer<typeof AutoDetectScopeSchema>;

// Auto-detection configuration
export const AutoDetectConfigSchema = z.object({
  type: AutoDetectTypeSchema,
  scope: AutoDetectScopeSchema,
  repoPath: z.string().optional(), // Legacy single repo (for backwards compatibility)
  repoPaths: z.array(z.string()).optional().default([]), // Multiple repos (commits aggregated)
  threshold: z.number().optional(),
});
export type AutoDetectConfig = z.infer<typeof AutoDetectConfigSchema>;

// Reminder configuration
export const ReminderConfigSchema = z.object({
  enabled: z.boolean(),
  time: z.string(), // HH:MM format
});
export type ReminderConfig = z.infer<typeof ReminderConfigSchema>;

// Goal
export const GoalSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  frequency: FrequencySchema,
  trackingType: TrackingTypeSchema,
  autoDetect: AutoDetectConfigSchema.optional(),
  reminder: ReminderConfigSchema.optional(),
  createdAt: z.string(),
  archivedAt: z.string().optional(),
});
export type Goal = z.infer<typeof GoalSchema>;

// Goal progress entry
export const GoalProgressSchema = z.object({
  goalId: z.string().uuid(),
  date: z.string(), // YYYY-MM-DD
  completed: z.boolean(),
  autoDetected: z.boolean(),
  value: z.number().optional(),
});
export type GoalProgress = z.infer<typeof GoalProgressSchema>;

// Goal statistics
export const GoalStatsSchema = z.object({
  goalId: z.string().uuid(),
  currentStreak: z.number(),
  longestStreak: z.number(),
  totalCompleted: z.number(),
  completionRate: z.number(),
});
export type GoalStats = z.infer<typeof GoalStatsSchema>;

// Goals summary
export const GoalsSummarySchema = z.object({
  activeGoals: z.number(),
  completedToday: z.number(),
  totalStreaks: z.number(),
  highestStreak: z.number(),
});
export type GoalsSummary = z.infer<typeof GoalsSummarySchema>;

// Request to create a new goal
export const CreateGoalRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  frequency: FrequencySchema,
  trackingType: TrackingTypeSchema,
  autoDetect: AutoDetectConfigSchema.optional(),
  reminder: ReminderConfigSchema.optional(),
});
export type CreateGoalRequest = z.infer<typeof CreateGoalRequestSchema>;

// Request to update an existing goal
export const UpdateGoalRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  frequency: FrequencySchema.optional(),
  autoDetect: AutoDetectConfigSchema.optional(),
  reminder: ReminderConfigSchema.optional(),
});
export type UpdateGoalRequest = z.infer<typeof UpdateGoalRequestSchema>;
