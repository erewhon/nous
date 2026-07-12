/**
 * Shared view row pipeline: filter + sort rows per a view's sorts/filters.
 *
 * Extracted from DatabaseTable so contributed custom views (plugin SDK) get
 * exactly the built-in semantics instead of re-implementing them. The
 * resolver decides how cells are read — DatabaseTable resolves formula and
 * rollup columns through the relation context; passing a raw-cell resolver
 * reproduces the simpler views' behavior.
 */
import type {
  CellValue,
  DatabaseRow,
  DatabaseView,
  PropertyDef,
} from "../../types/database";

export type CellResolver = (row: DatabaseRow, propertyId: string) => CellValue;

/** Read the raw cell, no computed-column resolution. */
export const rawCellResolver: CellResolver = (row, propertyId) =>
  row.cells[propertyId] ?? null;

// Helper: compare cell values for sorting
export function compareCellValues(a: CellValue, b: CellValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.join(",").localeCompare(b.join(","));

  return String(a).localeCompare(String(b));
}

// Helper: apply a filter to a cell value
export function applyFilter(
  cellVal: CellValue,
  operator: string,
  filterVal: CellValue,
  prop: PropertyDef
): boolean {
  switch (operator) {
    case "isEmpty":
      return (
        cellVal == null ||
        cellVal === "" ||
        (Array.isArray(cellVal) && cellVal.length === 0)
      );
    case "isNotEmpty":
      return (
        cellVal != null &&
        cellVal !== "" &&
        !(Array.isArray(cellVal) && cellVal.length === 0)
      );
    case "equals":
      if (prop.type === "checkbox") {
        return cellVal === (filterVal === "true" || filterVal === true);
      }
      if (prop.type === "multiSelect" && Array.isArray(cellVal)) {
        return cellVal.includes(String(filterVal ?? ""));
      }
      // select: both are option IDs; text/number: string comparison
      return String(cellVal ?? "") === String(filterVal ?? "");
    case "notEquals":
      if (prop.type === "checkbox") {
        return cellVal !== (filterVal === "true" || filterVal === true);
      }
      if (prop.type === "multiSelect" && Array.isArray(cellVal)) {
        return !cellVal.includes(String(filterVal ?? ""));
      }
      return String(cellVal ?? "") !== String(filterVal ?? "");
    case "contains":
      return String(cellVal ?? "")
        .toLowerCase()
        .includes(String(filterVal ?? "").toLowerCase());
    case "doesNotContain":
      return !String(cellVal ?? "")
        .toLowerCase()
        .includes(String(filterVal ?? "").toLowerCase());
    case "gt":
      return Number(cellVal) > Number(filterVal);
    case "gte":
      return Number(cellVal) >= Number(filterVal);
    case "lt":
      return Number(cellVal) < Number(filterVal);
    case "lte":
      return Number(cellVal) <= Number(filterVal);
    case "before":
      return String(cellVal ?? "") < String(filterVal ?? "");
    case "after":
      return String(cellVal ?? "") > String(filterVal ?? "");
    default:
      return true;
  }
}

/**
 * Apply a view's filters then sorts to rows. Filters on missing properties
 * are skipped; multiple sorts tie-break in order (DatabaseTable semantics).
 */
export function applyViewToRows(
  rows: DatabaseRow[],
  view: Pick<DatabaseView, "sorts" | "filters">,
  properties: PropertyDef[],
  resolve: CellResolver = rawCellResolver
): DatabaseRow[] {
  let result = [...rows];

  for (const filter of view.filters) {
    const prop = properties.find((p) => p.id === filter.propertyId);
    if (!prop) continue;
    result = result.filter((row) =>
      applyFilter(resolve(row, filter.propertyId), filter.operator, filter.value, prop)
    );
  }

  if (view.sorts.length > 0) {
    result.sort((a, b) => {
      for (const sort of view.sorts) {
        const cmp = compareCellValues(
          resolve(a, sort.propertyId),
          resolve(b, sort.propertyId)
        );
        if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }

  return result;
}
