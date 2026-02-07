import { z } from "zod";

export const TaskStatusSchema = z.enum(["todo", "in_progress", "completed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const RecurrenceTypeSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
export type RecurrenceType = z.infer<typeof RecurrenceTypeSchema>;

export const RecurrencePatternSchema = z.object({
  type: RecurrenceTypeSchema,
  interval: z.number().int().min(1).default(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  endDate: z.string().optional(),
});
export type RecurrencePattern = z.infer<typeof RecurrencePatternSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().optional(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).default([]),
  recurrence: RecurrencePatternSchema.optional(),
  parentTaskId: z.string().uuid().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskViewSchema = z.enum(["today", "upcoming", "by_project", "by_priority", "all"]);
export type TaskView = z.infer<typeof TaskViewSchema>;

export const TaskSummarySchema = z.object({
  totalTasks: z.number(),
  dueTodayCount: z.number(),
  overdueCount: z.number(),
  completedTodayCount: z.number(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: TaskPrioritySchema.default("medium"),
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).default([]),
  recurrence: RecurrencePatternSchema.optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  recurrence: RecurrencePatternSchema.optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
