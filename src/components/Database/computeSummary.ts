import type {
  DatabaseRow,
  PropertyDef,
  PropertyType,
  SummaryAggregation,
} from "../../types/database";
import { formatNumber } from "./formatNumber";

/** Valid aggregations per property type */
const AGGREGATIONS_BY_TYPE: Record<PropertyType, SummaryAggregation[]> = {
  number: [
    "none", "count", "countValues", "countUnique",
    "sum", "average", "min", "max", "range",
    "percent_empty", "percent_not_empty",
  ],
  text: [
    "none", "count", "countValues", "countUnique",
    "percent_empty", "percent_not_empty",
  ],
  url: [
    "none", "count", "countValues", "countUnique",
    "percent_empty", "percent_not_empty",
  ],
  select: [
    "none", "count", "countValues", "countUnique",
    "percent_empty", "percent_not_empty",
  ],
  multiSelect: [
    "none", "count", "countValues", "countUnique",
    "percent_empty", "percent_not_empty",
  ],
  checkbox: [
    "none", "count", "countValues",
    "percent_empty", "percent_not_empty",
  ],
  date: [
    "none", "count", "countValues", "min", "max", "range",
    "percent_empty", "percent_not_empty",
  ],
  relation: [
    "none", "count", "percent_empty", "percent_not_empty",
  ],
  rollup: [
    "none", "count", "percent_empty", "percent_not_empty",
  ],
  pageLink: [
    "none", "count", "percent_empty", "percent_not_empty",
  ],
};

export function getAggregationsForType(type: PropertyType): SummaryAggregation[] {
  return AGGREGATIONS_BY_TYPE[type] ?? AGGREGATIONS_BY_TYPE.text;
}

function isEmpty(val: unknown): boolean {
  return val == null || val === "" || (Array.isArray(val) && val.length === 0);
}

export function computeSummary(
  rows: DatabaseRow[],
  propertyId: string,
  aggregation: SummaryAggregation,
  prop: PropertyDef
): string {
  if (aggregation === "none") return "";

  const total = rows.length;
  if (total === 0) return aggregation === "count" ? "0" : "-";

  const values = rows.map((r) => r.cells[propertyId]);

  switch (aggregation) {
    case "count":
      return String(total);

    case "countValues":
      return String(values.filter((v) => !isEmpty(v)).length);

    case "countUnique": {
      const nonEmpty = values.filter((v) => !isEmpty(v));
      const unique = new Set(nonEmpty.map((v) => JSON.stringify(v)));
      return String(unique.size);
    }

    case "sum": {
      const nums = values
        .map((v) => (v != null ? Number(v) : NaN))
        .filter((n) => !isNaN(n));
      if (nums.length === 0) return "-";
      const result = nums.reduce((a, b) => a + b, 0);
      return formatSummaryNumber(result, prop);
    }

    case "average": {
      const nums = values
        .map((v) => (v != null ? Number(v) : NaN))
        .filter((n) => !isNaN(n));
      if (nums.length === 0) return "-";
      const result = nums.reduce((a, b) => a + b, 0) / nums.length;
      return formatSummaryNumber(result, prop);
    }

    case "min": {
      if (prop.type === "date") {
        const dates = values.filter((v): v is string => typeof v === "string" && v !== "");
        if (dates.length === 0) return "-";
        dates.sort();
        return dates[0];
      }
      const nums = values
        .map((v) => (v != null ? Number(v) : NaN))
        .filter((n) => !isNaN(n));
      if (nums.length === 0) return "-";
      return formatSummaryNumber(Math.min(...nums), prop);
    }

    case "max": {
      if (prop.type === "date") {
        const dates = values.filter((v): v is string => typeof v === "string" && v !== "");
        if (dates.length === 0) return "-";
        dates.sort();
        return dates[dates.length - 1];
      }
      const nums = values
        .map((v) => (v != null ? Number(v) : NaN))
        .filter((n) => !isNaN(n));
      if (nums.length === 0) return "-";
      return formatSummaryNumber(Math.max(...nums), prop);
    }

    case "range": {
      if (prop.type === "date") {
        const dates = values.filter((v): v is string => typeof v === "string" && v !== "");
        if (dates.length < 2) return "-";
        dates.sort();
        const minD = new Date(dates[0]).getTime();
        const maxD = new Date(dates[dates.length - 1]).getTime();
        const days = Math.round((maxD - minD) / (1000 * 60 * 60 * 24));
        return `${days}d`;
      }
      const nums = values
        .map((v) => (v != null ? Number(v) : NaN))
        .filter((n) => !isNaN(n));
      if (nums.length < 2) return "-";
      return formatSummaryNumber(Math.max(...nums) - Math.min(...nums), prop);
    }

    case "percent_empty": {
      const emptyCount = values.filter((v) => isEmpty(v)).length;
      return `${Math.round((emptyCount / total) * 100)}%`;
    }

    case "percent_not_empty": {
      const nonEmptyCount = values.filter((v) => !isEmpty(v)).length;
      return `${Math.round((nonEmptyCount / total) * 100)}%`;
    }

    default:
      return "";
  }
}

function formatSummaryNumber(value: number, prop: PropertyDef): string {
  if (prop.type === "number" && prop.numberFormat) {
    return formatNumber(value, prop.numberFormat);
  }
  // Round to 2 decimal places if not integer
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

/** Labels for aggregation options */
export const SUMMARY_LABELS: Record<SummaryAggregation, string> = {
  none: "None",
  count: "Count",
  countValues: "Count values",
  countUnique: "Count unique",
  sum: "Sum",
  average: "Average",
  min: "Min",
  max: "Max",
  range: "Range",
  percent_empty: "% Empty",
  percent_not_empty: "% Not empty",
};
