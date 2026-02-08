import { z } from "zod";

export const LiveQueryFilterSchema = z.object({
  field: z.enum(["title", "tag", "pageType", "folder", "content"]),
  operator: z.enum(["contains", "equals", "not_equals", "starts_with"]),
  value: z.string(),
});
export type LiveQueryFilter = z.infer<typeof LiveQueryFilterSchema>;

export const LiveQuerySortSchema = z.object({
  field: z.enum(["title", "createdAt", "updatedAt"]),
  direction: z.enum(["asc", "desc"]),
});
export type LiveQuerySort = z.infer<typeof LiveQuerySortSchema>;

export const LiveQueryConfigSchema = z.object({
  filters: z.array(LiveQueryFilterSchema),
  sort: LiveQuerySortSchema.optional(),
  limit: z.number().optional(),
  displayMode: z.enum(["list", "table", "compact"]).optional(),
});
export type LiveQueryConfig = z.infer<typeof LiveQueryConfigSchema>;
