/**
 * Heatmap view — GitHub-contribution-style date grid, ported from the
 * retired database_heatmap.lua (iframe scaffolding removed 2026-07-11).
 *
 * One cell per day for the last 52 weeks. Cell intensity is the per-day sum
 * of a value column (number/formula/rollup, resolved through ctx.getCellValue)
 * or the row count when no value column is chosen. Column choices persist in
 * the view's own config; unset config auto-picks the first date/number
 * property, matching the legacy behavior.
 *
 * Inline styles only (plugin-sdk convention — no Tailwind dependency).
 */
import type * as React from "react";
import { z } from "zod";
import type {
  CustomDatabaseViewContribution,
  CustomDatabaseViewProps,
} from "../custom-database-view";
import type { DatabaseRow, PropertyDef } from "../../types/database";

export const heatmapConfigSchema = z.object({
  datePropertyId: z.string().optional(),
  /** Empty string means "count rows". */
  valuePropertyId: z.string().optional(),
});

// GitHub's green scale; the empty level adapts to the theme.
const LEVEL_COLORS = ["", "#0e4429", "#006d32", "#26a641", "#39d353"];
const EMPTY_COLOR = "var(--color-bg-tertiary, rgba(128,128,128,0.18))";

const CELL = 12;
const GAP = 2;
const STEP = CELL + GAP;
const LABEL_W = 30;
const MONTH_H = 14;

export interface HeatmapData {
  /** ISO date (YYYY-MM-DD) → summed value. */
  totals: Map<string, number>;
  max: number;
}

/** Aggregate per-day totals. Pure — value resolution is injected. */
export function buildHeatmapData(
  rows: ReadonlyArray<DatabaseRow>,
  datePropertyId: string,
  getValue: (row: DatabaseRow) => number,
): HeatmapData {
  const totals = new Map<string, number>();
  let max = 1;
  for (const row of rows) {
    const raw = row.cells[datePropertyId];
    if (typeof raw !== "string" || raw === "") continue;
    const key = raw.slice(0, 10);
    const next = (totals.get(key) ?? 0) + getValue(row);
    totals.set(key, next);
    if (next > max) max = next;
  }
  return { totals, max };
}

export function levelColor(value: number | undefined, max: number): string {
  if (!value || value <= 0) return EMPTY_COLOR;
  const ratio = value / max;
  if (ratio <= 0.25) return LEVEL_COLORS[1]!;
  if (ratio <= 0.5) return LEVEL_COLORS[2]!;
  if (ratio <= 0.75) return LEVEL_COLORS[3]!;
  return LEVEL_COLORS[4]!;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const selectStyle: React.CSSProperties = {
  fontSize: "0.85em",
};

const mutedStyle: React.CSSProperties = {
  fontSize: "0.8em",
  color: "var(--color-text-muted, #888)",
};

function HeatmapView({ rows, properties, config, ctx }: CustomDatabaseViewProps) {
  const cfg = config as z.infer<typeof heatmapConfigSchema>;

  const dateProps = properties.filter((p) => p.type === "date");
  const valueProps = properties.filter((p) =>
    ["number", "formula", "rollup"].includes(p.type),
  );

  const dateProp: PropertyDef | undefined =
    dateProps.find((p) => p.id === cfg.datePropertyId) ?? dateProps[0];
  const valueProp: PropertyDef | undefined =
    cfg.valuePropertyId === ""
      ? undefined // explicit "count rows"
      : (valueProps.find((p) => p.id === cfg.valuePropertyId) ?? valueProps[0]);

  if (!dateProp) {
    return (
      <div style={{ padding: "24px", ...mutedStyle, textAlign: "center" }}>
        No date column found. Add a date property to use the heatmap view.
      </div>
    );
  }

  const { totals, max } = buildHeatmapData(rows, dateProp.id, (row) => {
    if (!valueProp) return 1;
    const v = ctx.getCellValue(row.id, valueProp.id);
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && !Number.isNaN(n) ? n : 0;
  });

  // Grid: last 364 days extended back to the previous Sunday.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const back363 = new Date(today);
  back363.setUTCDate(back363.getUTCDate() - 363);
  const start = new Date(back363);
  start.setUTCDate(start.getUTCDate() - back363.getUTCDay()); // back to Sunday

  const days: Array<{ iso: string; week: number; dow: number; month: number }> = [];
  for (let d = new Date(start), i = 0; d <= today; d.setUTCDate(d.getUTCDate() + 1), i++) {
    days.push({
      iso: isoDate(d),
      week: Math.floor(i / 7),
      dow: i % 7,
      month: d.getUTCMonth(),
    });
  }
  const numWeeks = Math.ceil(days.length / 7);

  // Month labels: first week where a month starts.
  const monthLabels: Array<{ week: number; label: string }> = [];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let lastMonth = -1;
  for (const day of days) {
    if (day.dow === 0 && day.month !== lastMonth) {
      monthLabels.push({ week: day.week, label: MONTHS[day.month]! });
      lastMonth = day.month;
    }
  }

  const width = LABEL_W + numWeeks * STEP;
  const height = MONTH_H + 7 * STEP;
  const dowLabels: Array<[number, string]> = [[1, "Mon"], [3, "Wed"], [5, "Fri"]];

  return (
    <div style={{ padding: "16px", overflowX: "auto" }}>
      {!ctx.readOnly && (
        <div style={{ display: "flex", gap: "16px", marginBottom: "10px", ...mutedStyle }}>
          <label>
            Date{" "}
            <select
              style={selectStyle}
              value={dateProp.id}
              onChange={(e) => ctx.updateConfig({ datePropertyId: e.target.value })}
            >
              {dateProps.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            Value{" "}
            <select
              style={selectStyle}
              value={valueProp?.id ?? ""}
              onChange={(e) => ctx.updateConfig({ valuePropertyId: e.target.value })}
            >
              <option value="">Row count</option>
              {valueProps.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <svg width={width} height={height} role="img" aria-label="Activity heatmap">
        {monthLabels.map((m) => (
          <text
            key={`m-${m.week}`}
            x={LABEL_W + m.week * STEP}
            y={MONTH_H - 4}
            style={{ fontSize: 9, fill: "var(--color-text-muted, #888)" }}
          >
            {m.label}
          </text>
        ))}
        {dowLabels.map(([dow, label]) => (
          <text
            key={label}
            x={0}
            y={MONTH_H + dow * STEP + CELL - 2}
            style={{ fontSize: 9, fill: "var(--color-text-muted, #888)" }}
          >
            {label}
          </text>
        ))}
        {days.map((day) => {
          const value = totals.get(day.iso);
          return (
            <rect
              key={day.iso}
              data-date={day.iso}
              x={LABEL_W + day.week * STEP}
              y={MONTH_H + day.dow * STEP}
              width={CELL}
              height={CELL}
              rx={2}
              fill={levelColor(value, max)}
            >
              <title>{`${day.iso}: ${value ?? 0}`}</title>
            </rect>
          );
        })}
      </svg>
      <div style={{ marginTop: "6px", ...mutedStyle }}>
        {valueProp ? `Sum of ${valueProp.name} per day` : "Rows per day"} · max {max}
      </div>
    </div>
  );
}

function HeatmapIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="4" height="4" rx="0.5" />
      <rect x="10" y="3" width="4" height="4" rx="0.5" />
      <rect x="17" y="3" width="4" height="4" rx="0.5" />
      <rect x="3" y="10" width="4" height="4" rx="0.5" />
      <rect x="10" y="10" width="4" height="4" rx="0.5" />
      <rect x="17" y="10" width="4" height="4" rx="0.5" />
      <rect x="3" y="17" width="4" height="4" rx="0.5" />
      <rect x="10" y="17" width="4" height="4" rx="0.5" />
      <rect x="17" y="17" width="4" height="4" rx="0.5" />
    </svg>
  );
}

export const heatmapView: CustomDatabaseViewContribution = {
  id: "heatmap",
  label: "Heatmap",
  icon: HeatmapIcon,
  configSchema: heatmapConfigSchema,
  requires: "date",
  Component: HeatmapView,
};
