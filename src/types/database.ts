import { z } from "zod";

// Property types supported by database columns
export const PropertyTypeSchema = z.enum([
  "text",
  "number",
  "select",
  "multiSelect",
  "checkbox",
  "date",
  "url",
]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

// Select/multi-select option
export const SelectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
});
export type SelectOption = z.infer<typeof SelectOptionSchema>;

// Property (column) definition
export const PropertyDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: PropertyTypeSchema,
  options: z.array(SelectOptionSchema).optional(),
  width: z.number().optional(),
});
export type PropertyDef = z.infer<typeof PropertyDefSchema>;

// Cell value can be various types
export const CellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type CellValue = z.infer<typeof CellValueSchema>;

// A single row in the database
export const DatabaseRowSchema = z.object({
  id: z.string(),
  cells: z.record(z.string(), CellValueSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DatabaseRow = z.infer<typeof DatabaseRowSchema>;

// Sort configuration
export const DatabaseSortSchema = z.object({
  propertyId: z.string(),
  direction: z.enum(["asc", "desc"]),
});
export type DatabaseSort = z.infer<typeof DatabaseSortSchema>;

// Filter configuration
export const DatabaseFilterSchema = z.object({
  propertyId: z.string(),
  operator: z.string(),
  value: CellValueSchema,
});
export type DatabaseFilter = z.infer<typeof DatabaseFilterSchema>;

// Root database content stored in .database files
export const DatabaseContentSchema = z.object({
  version: z.literal(1),
  properties: z.array(PropertyDefSchema),
  rows: z.array(DatabaseRowSchema),
  sorts: z.array(DatabaseSortSchema),
  filters: z.array(DatabaseFilterSchema),
});
export type DatabaseContent = z.infer<typeof DatabaseContentSchema>;

// Default colors for select options
export const SELECT_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#6b7280", // gray
  "#a855f7", // purple
];

// Create empty database content
export function createDefaultDatabaseContent(): DatabaseContent {
  return {
    version: 1,
    properties: [
      {
        id: crypto.randomUUID(),
        name: "Name",
        type: "text",
      },
    ],
    rows: [],
    sorts: [],
    filters: [],
  };
}
