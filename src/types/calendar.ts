import { z } from "zod";
import { DatabaseFilterSchema } from "./database";

// Calendar pages aggregate sources; the page's file content holds this config
// (JSON), never events. Events live in normal databases.

export const CalendarDatabaseSourceSchema = z.object({
  type: z.literal("database"),
  /** Per-source id — generate with generateId() (never bare crypto.randomUUID). */
  id: z.string(),
  /** Page id of the database page to overlay. */
  pageId: z.string(),
  /** Date property driving placement. */
  datePropertyId: z.string(),
  /** Optional end-date property for ranged items. */
  endDatePropertyId: z.string().optional(),
  /** CSS color for this source's items. */
  color: z.string(),
  /** Optional row filter, same shape the database views use. */
  filter: DatabaseFilterSchema.optional(),
  /** Marks the writable target for quick-created events (at most one source). */
  isEventsTarget: z.boolean().optional(),
});
export type CalendarDatabaseSource = z.infer<typeof CalendarDatabaseSourceSchema>;

export const CalendarIcsFileSourceSchema = z.object({
  type: z.literal("ics-file"),
  id: z.string(),
  /** Page id of an ics page (imported or linked .ics file). */
  pageId: z.string(),
  color: z.string(),
});
export type CalendarIcsFileSource = z.infer<typeof CalendarIcsFileSourceSchema>;

export const CalendarIcsSubscriptionSourceSchema = z.object({
  type: z.literal("ics-subscription"),
  id: z.string(),
  url: z
    .url()
    .refine((u) => u.startsWith("https://"), "Subscription URLs must use https"),
  refreshMinutes: z.number().int().positive().default(60),
  color: z.string(),
});
export type CalendarIcsSubscriptionSource = z.infer<
  typeof CalendarIcsSubscriptionSourceSchema
>;

export const CalendarSourceSchema = z.discriminatedUnion("type", [
  CalendarDatabaseSourceSchema,
  CalendarIcsFileSourceSchema,
  CalendarIcsSubscriptionSourceSchema,
]);
export type CalendarSource = z.infer<typeof CalendarSourceSchema>;

export const CalendarViewModeSchema = z.enum(["month", "week"]);
export type CalendarViewMode = z.infer<typeof CalendarViewModeSchema>;

export const CalendarPageConfigSchema = z
  .object({
    version: z.literal(1),
    sources: z.array(CalendarSourceSchema).default([]),
    viewMode: CalendarViewModeSchema.default("month"),
  })
  .superRefine((config, ctx) => {
    const targets = config.sources.filter(
      (s) => s.type === "database" && s.isEventsTarget,
    );
    if (targets.length > 1) {
      ctx.addIssue({
        code: "custom",
        message: "Only one source may be the events target",
        path: ["sources"],
      });
    }
  });
export type CalendarPageConfig = z.infer<typeof CalendarPageConfigSchema>;

export function createDefaultCalendarConfig(): CalendarPageConfig {
  return { version: 1, sources: [], viewMode: "month" };
}

/**
 * Parse a calendar page's raw file content. Empty content yields the default
 * config; malformed content throws — callers surface the error and must NEVER
 * overwrite the file in response.
 */
export function parseCalendarConfig(raw: string): CalendarPageConfig {
  const trimmed = raw.trim();
  if (!trimmed) {
    return createDefaultCalendarConfig();
  }
  return CalendarPageConfigSchema.parse(JSON.parse(trimmed));
}
