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

// V1 database content (legacy)
export const DatabaseContentV1Schema = z.object({
  version: z.literal(1),
  properties: z.array(PropertyDefSchema),
  rows: z.array(DatabaseRowSchema),
  sorts: z.array(DatabaseSortSchema),
  filters: z.array(DatabaseFilterSchema),
});
export type DatabaseContentV1 = z.infer<typeof DatabaseContentV1Schema>;

// Keep backward-compat alias
export const DatabaseContentSchema = DatabaseContentV1Schema;
export type DatabaseContent = DatabaseContentV1;

// --- V2: Multi-View Architecture ---

export const DatabaseViewTypeSchema = z.enum([
  "table",
  "board",
  "gallery",
  "list",
  "calendar",
]);
export type DatabaseViewType = z.infer<typeof DatabaseViewTypeSchema>;

export const TableViewConfigSchema = z.object({
  groupByPropertyId: z.string().nullable().optional(),
  collapsedGroups: z.array(z.string()).optional(),
});
export type TableViewConfig = z.infer<typeof TableViewConfigSchema>;

export const BoardViewConfigSchema = z.object({
  groupByPropertyId: z.string(),
  hiddenColumns: z.array(z.string()).optional(),
});
export type BoardViewConfig = z.infer<typeof BoardViewConfigSchema>;

export const GalleryViewConfigSchema = z.object({
  visiblePropertyIds: z.array(z.string()).optional(),
  cardSize: z.enum(["small", "medium", "large"]).optional(),
});
export type GalleryViewConfig = z.infer<typeof GalleryViewConfigSchema>;

export const ListViewConfigSchema = z.object({
  secondaryPropertyIds: z.array(z.string()).optional(),
});
export type ListViewConfig = z.infer<typeof ListViewConfigSchema>;

export const CalendarViewConfigSchema = z.object({
  datePropertyId: z.string(),
});
export type CalendarViewConfig = z.infer<typeof CalendarViewConfigSchema>;

export const ViewConfigSchema = z.union([
  TableViewConfigSchema,
  BoardViewConfigSchema,
  GalleryViewConfigSchema,
  ListViewConfigSchema,
  CalendarViewConfigSchema,
]);

export const DatabaseViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: DatabaseViewTypeSchema,
  sorts: z.array(DatabaseSortSchema),
  filters: z.array(DatabaseFilterSchema),
  config: ViewConfigSchema,
  propertyWidths: z.record(z.string(), z.number()).optional(),
});
export type DatabaseView = z.infer<typeof DatabaseViewSchema>;

export const DatabaseContentV2Schema = z.object({
  version: z.literal(2),
  properties: z.array(PropertyDefSchema),
  rows: z.array(DatabaseRowSchema),
  views: z.array(DatabaseViewSchema),
});
export type DatabaseContentV2 = z.infer<typeof DatabaseContentV2Schema>;

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

// Migrate from any version to V2
export function migrateDatabaseContent(raw: unknown): DatabaseContentV2 {
  // Try V2 first
  const v2Result = DatabaseContentV2Schema.safeParse(raw);
  if (v2Result.success) return v2Result.data;

  // Try V1
  const v1Result = DatabaseContentV1Schema.safeParse(raw);
  if (v1Result.success) {
    const v1 = v1Result.data;
    const propertyWidths: Record<string, number> = {};
    for (const prop of v1.properties) {
      if (prop.width) {
        propertyWidths[prop.id] = prop.width;
      }
    }
    return {
      version: 2,
      properties: v1.properties,
      rows: v1.rows,
      views: [
        {
          id: crypto.randomUUID(),
          name: "Table",
          type: "table",
          sorts: v1.sorts,
          filters: v1.filters,
          config: {},
          propertyWidths:
            Object.keys(propertyWidths).length > 0 ? propertyWidths : undefined,
        },
      ],
    };
  }

  throw new Error("Invalid database content: cannot parse as v1 or v2");
}

// Create empty V2 database content
export function createDefaultDatabaseContent(): DatabaseContentV2 {
  return {
    version: 2,
    properties: [
      {
        id: crypto.randomUUID(),
        name: "Name",
        type: "text",
      },
    ],
    rows: [],
    views: [
      {
        id: crypto.randomUUID(),
        name: "Table",
        type: "table",
        sorts: [],
        filters: [],
        config: {},
      },
    ],
  };
}
