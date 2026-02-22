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
  "relation",
  "rollup",
  "pageLink",
  "formula",
]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

// Select/multi-select option
export const SelectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
});
export type SelectOption = z.infer<typeof SelectOptionSchema>;

// Relation configuration — links to another database page
export const RelationConfigSchema = z.object({
  databasePageId: z.string(), // Page ID of the target database
  backRelationPropertyId: z.string().optional(), // ID of the mirror property in the other DB
  direction: z.enum(["forward", "back"]).optional(), // undefined = legacy forward
});
export type RelationConfig = z.infer<typeof RelationConfigSchema>;

// Rollup aggregation functions
export const RollupAggregationSchema = z.enum([
  "show_original",
  "count",
  "countValues",
  "countUnique",
  "sum",
  "average",
  "min",
  "max",
  "range",
  "percent_empty",
  "percent_not_empty",
]);
export type RollupAggregation = z.infer<typeof RollupAggregationSchema>;

// Rollup configuration — aggregates data via a relation
export const RollupConfigSchema = z.object({
  relationPropertyId: z.string(), // which relation/back-relation to follow
  targetPropertyId: z.string(), // which property in the linked DB to aggregate
  aggregation: RollupAggregationSchema,
});
export type RollupConfig = z.infer<typeof RollupConfigSchema>;

// Formula configuration — computed columns
export const FormulaConfigSchema = z.object({
  expression: z.string(),
  resultType: z.enum(["string", "number", "boolean", "date"]).optional(),
});
export type FormulaConfig = z.infer<typeof FormulaConfigSchema>;

// Number formatting configuration
export const NumberFormatSchema = z.object({
  style: z.enum(["plain", "currency", "percent", "progressBar"]).default("plain"),
  decimals: z.number().optional(),
  thousandsSeparator: z.boolean().optional(),
  currencySymbol: z.string().optional(),
});
export type NumberFormat = z.infer<typeof NumberFormatSchema>;

// Cell value can be various types
export const CellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type CellValue = z.infer<typeof CellValueSchema>;

// Conditional formatting
export const ConditionalFormatStyleSchema = z.object({
  backgroundColor: z.string().optional(),
  textColor: z.string().optional(),
});
export type ConditionalFormatStyle = z.infer<typeof ConditionalFormatStyleSchema>;

export const ConditionalFormatRuleSchema = z.object({
  id: z.string(),
  operator: z.string(),
  value: CellValueSchema,
  style: ConditionalFormatStyleSchema,
});
export type ConditionalFormatRule = z.infer<typeof ConditionalFormatRuleSchema>;

// Property (column) definition
export const PropertyDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: PropertyTypeSchema,
  options: z.array(SelectOptionSchema).optional(),
  width: z.number().optional(),
  relationConfig: RelationConfigSchema.optional(),
  rollupConfig: RollupConfigSchema.optional(),
  formulaConfig: FormulaConfigSchema.optional(),
  numberFormat: NumberFormatSchema.optional(),
  defaultValue: CellValueSchema.optional(),
  conditionalFormats: z.array(ConditionalFormatRuleSchema).optional(),
});
export type PropertyDef = z.infer<typeof PropertyDefSchema>;

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
  "chart",
]);
export type DatabaseViewType = z.infer<typeof DatabaseViewTypeSchema>;

export const TableViewConfigSchema = z.object({
  groupByPropertyId: z.string().nullable().optional(),
  collapsedGroups: z.array(z.string()).optional(),
  hiddenPropertyIds: z.array(z.string()).optional(),
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

export const ChartTypeSchema = z.enum(["bar", "line", "pie"]);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const ChartAggregationSchema = z.enum(["count", "sum", "average", "min", "max"]);
export type ChartAggregation = z.infer<typeof ChartAggregationSchema>;

export const ChartViewConfigSchema = z.object({
  chartType: ChartTypeSchema,
  xAxisPropertyId: z.string(),
  yAxisPropertyId: z.string().optional(),
  aggregation: ChartAggregationSchema,
  colorPropertyId: z.string().optional(),
});
export type ChartViewConfig = z.infer<typeof ChartViewConfigSchema>;

export const ViewConfigSchema = z.union([
  TableViewConfigSchema,
  BoardViewConfigSchema,
  GalleryViewConfigSchema,
  ListViewConfigSchema,
  CalendarViewConfigSchema,
  ChartViewConfigSchema,
]);

export const SummaryAggregationSchema = z.enum([
  "none",
  "count",
  "countValues",
  "countUnique",
  "sum",
  "average",
  "min",
  "max",
  "range",
  "percent_empty",
  "percent_not_empty",
]);
export type SummaryAggregation = z.infer<typeof SummaryAggregationSchema>;

export const DatabaseViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: DatabaseViewTypeSchema,
  sorts: z.array(DatabaseSortSchema),
  filters: z.array(DatabaseFilterSchema),
  config: ViewConfigSchema,
  propertyWidths: z.record(z.string(), z.number()).optional(),
  propertySummaries: z.record(z.string(), SummaryAggregationSchema).optional(),
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

// --- Object Types ---

// Property template for object type definitions
export const ObjectTypePropertySchema = z.object({
  name: z.string(),
  type: PropertyTypeSchema,
  options: z.array(SelectOptionSchema).optional(),
  defaultValue: CellValueSchema.optional(),
});
export type ObjectTypeProperty = z.infer<typeof ObjectTypePropertySchema>;

// Object type definition
export const ObjectTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(), // emoji or SVG string
  description: z.string().optional(),
  properties: z.array(ObjectTypePropertySchema),
  defaultViewType: DatabaseViewTypeSchema.optional(),
  builtIn: z.boolean().optional(), // true for system-provided types
  defaultSorts: z.array(z.object({
    propertyName: z.string(),
    direction: z.enum(["asc", "desc"]),
  })).optional(),
  defaultFilters: z.array(z.object({
    propertyName: z.string(),
    operator: z.string(),
    value: CellValueSchema,
  })).optional(),
  defaultGroupByPropertyName: z.string().optional(),
  defaultDatePropertyName: z.string().optional(),
});
export type ObjectType = z.infer<typeof ObjectTypeSchema>;

// Built-in object types
export const BUILT_IN_OBJECT_TYPES: ObjectType[] = [
  {
    id: "builtin-book",
    name: "Book",
    icon: "\ud83d\udcd6",
    description: "Track books with author, genre, rating, and reading status",
    builtIn: true,
    defaultSorts: [{ propertyName: "Status", direction: "asc" }],
    properties: [
      { name: "Title", type: "text" },
      { name: "Author", type: "text" },
      { name: "Genre", type: "select", options: [
        { id: "genre-fiction", label: "Fiction", color: "#3b82f6" },
        { id: "genre-nonfiction", label: "Non-fiction", color: "#22c55e" },
        { id: "genre-sci-fi", label: "Sci-fi", color: "#8b5cf6" },
        { id: "genre-biography", label: "Biography", color: "#f97316" },
        { id: "genre-self-help", label: "Self-help", color: "#eab308" },
      ]},
      { name: "Status", type: "select", options: [
        { id: "status-to-read", label: "To Read", color: "#6b7280" },
        { id: "status-reading", label: "Reading", color: "#3b82f6" },
        { id: "status-finished", label: "Finished", color: "#22c55e" },
        { id: "status-abandoned", label: "Abandoned", color: "#ef4444" },
      ], defaultValue: "status-to-read" },
      { name: "Rating", type: "number" },
      { name: "Date Read", type: "date" },
      { name: "URL", type: "url" },
    ],
  },
  {
    id: "builtin-person",
    name: "Person",
    icon: "\ud83d\udc64",
    description: "Contact directory with roles, company, and communication details",
    builtIn: true,
    properties: [
      { name: "Name", type: "text" },
      { name: "Company", type: "text" },
      { name: "Role", type: "text" },
      { name: "Email", type: "url" },
      { name: "Tags", type: "multiSelect", options: [
        { id: "tag-work", label: "Work", color: "#3b82f6" },
        { id: "tag-personal", label: "Personal", color: "#22c55e" },
        { id: "tag-client", label: "Client", color: "#f97316" },
        { id: "tag-mentor", label: "Mentor", color: "#8b5cf6" },
      ]},
      { name: "Last Contacted", type: "date" },
    ],
  },
  {
    id: "builtin-project",
    name: "Project",
    icon: "\ud83d\udcc1",
    description: "Project tracker with status, priority, dates, and ownership",
    builtIn: true,
    defaultViewType: "board",
    defaultGroupByPropertyName: "Status",
    defaultSorts: [{ propertyName: "Priority", direction: "desc" }],
    properties: [
      { name: "Name", type: "text" },
      { name: "Status", type: "select", options: [
        { id: "proj-planning", label: "Planning", color: "#6b7280" },
        { id: "proj-active", label: "Active", color: "#3b82f6" },
        { id: "proj-on-hold", label: "On Hold", color: "#eab308" },
        { id: "proj-completed", label: "Completed", color: "#22c55e" },
        { id: "proj-cancelled", label: "Cancelled", color: "#ef4444" },
      ], defaultValue: "proj-planning" },
      { name: "Priority", type: "select", options: [
        { id: "pri-low", label: "Low", color: "#6b7280" },
        { id: "pri-medium", label: "Medium", color: "#eab308" },
        { id: "pri-high", label: "High", color: "#f97316" },
        { id: "pri-urgent", label: "Urgent", color: "#ef4444" },
      ], defaultValue: "pri-medium" },
      { name: "Start Date", type: "date" },
      { name: "Due Date", type: "date" },
      { name: "Owner", type: "text" },
      { name: "Completed", type: "checkbox", defaultValue: false },
    ],
  },
  {
    id: "builtin-meeting",
    name: "Meeting",
    icon: "\ud83d\udcc5",
    description: "Meeting log with date, attendees, agenda, and action items",
    builtIn: true,
    defaultViewType: "calendar",
    defaultDatePropertyName: "Date",
    defaultSorts: [{ propertyName: "Date", direction: "asc" }],
    properties: [
      { name: "Title", type: "text" },
      { name: "Date", type: "date" },
      { name: "Type", type: "select", options: [
        { id: "mtg-standup", label: "Standup", color: "#22c55e" },
        { id: "mtg-planning", label: "Planning", color: "#3b82f6" },
        { id: "mtg-review", label: "Review", color: "#8b5cf6" },
        { id: "mtg-1on1", label: "1:1", color: "#f97316" },
        { id: "mtg-other", label: "Other", color: "#6b7280" },
      ]},
      { name: "Attendees", type: "text" },
      { name: "Agenda", type: "text" },
      { name: "Action Items", type: "text" },
    ],
  },
];

// Create a new row pre-populated with default values from property definitions
export function createDefaultRow(properties: PropertyDef[]): DatabaseRow {
  const now = new Date().toISOString();
  const cells: Record<string, CellValue> = {};
  for (const prop of properties) {
    if (prop.defaultValue != null) {
      cells[prop.id] = prop.defaultValue;
    }
  }
  return { id: crypto.randomUUID(), cells, createdAt: now, updatedAt: now };
}

// Create database content from an object type
export function createDatabaseFromObjectType(objectType: ObjectType): DatabaseContentV2 {
  const properties: PropertyDef[] = objectType.properties.map((p) => ({
    id: crypto.randomUUID(),
    name: p.name,
    type: p.type,
    ...(p.options ? { options: p.options } : {}),
    ...(p.defaultValue != null ? { defaultValue: p.defaultValue } : {}),
  }));

  // Helper: property name → generated id
  const propIdByName = new Map(properties.map((p) => [p.name, p.id]));

  // Resolve sorts from property names to IDs
  const sorts = (objectType.defaultSorts ?? [])
    .filter((s) => propIdByName.has(s.propertyName))
    .map((s) => ({ propertyId: propIdByName.get(s.propertyName)!, direction: s.direction }));

  // Resolve filters from property names to IDs
  const filters = (objectType.defaultFilters ?? [])
    .filter((f) => propIdByName.has(f.propertyName))
    .map((f) => ({ propertyId: propIdByName.get(f.propertyName)!, operator: f.operator, value: f.value }));

  // Resolve group-by
  const groupByPropertyId = objectType.defaultGroupByPropertyName
    ? propIdByName.get(objectType.defaultGroupByPropertyName) ?? null
    : null;

  // Resolve date property (calendar)
  const datePropertyId = objectType.defaultDatePropertyName
    ? propIdByName.get(objectType.defaultDatePropertyName) ?? null
    : null;

  // Build view config
  const viewType = objectType.defaultViewType ?? "table";
  let config: Record<string, unknown> = {};
  if (viewType === "board" && groupByPropertyId) {
    config = { groupByPropertyId };
  } else if (viewType === "table" && groupByPropertyId) {
    config = { groupByPropertyId };
  } else if (viewType === "calendar" && datePropertyId) {
    config = { datePropertyId };
  }

  const viewName = viewType === "board" ? "Board" :
    viewType === "gallery" ? "Gallery" :
    viewType === "list" ? "List" :
    viewType === "calendar" ? "Calendar" :
    viewType === "chart" ? "Chart" : "Table";

  return {
    version: 2,
    properties,
    rows: [],
    views: [
      {
        id: crypto.randomUUID(),
        name: viewName,
        type: viewType,
        sorts,
        filters,
        config,
      },
    ],
  };
}
