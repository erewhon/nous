/**
 * Stats view — the first SDK-contributed database view.
 *
 * Read-only summary cards: row count, plus count/sum/average/min/max for
 * every numeric column — including formula and rollup columns, which
 * exercise ctx.getCellValue's computed-column resolution. The decimals
 * setting persists through ctx.updateConfig into the view's own config.
 *
 * Inline styles only (plugin-sdk convention — no Tailwind dependency).
 */
import type * as React from "react";
import { z } from "zod";
import type {
  CustomDatabaseViewContribution,
  CustomDatabaseViewProps,
} from "../custom-database-view";

export const statsConfigSchema = z.object({
  decimals: z.number().int().min(0).max(4).optional(),
});

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--color-border, #8884)",
  borderRadius: "8px",
  padding: "12px 16px",
  minWidth: "150px",
  background: "var(--color-bg-secondary, transparent)",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.75em",
  color: "var(--color-text-muted, #888)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const valueStyle: React.CSSProperties = {
  fontSize: "1.4em",
  fontWeight: 600,
};

function StatsView({ rows, properties, config, ctx }: CustomDatabaseViewProps) {
  const { decimals = 2 } = config as z.infer<typeof statsConfigSchema>;

  // Numeric columns: raw numbers plus computed columns that yield numbers.
  const numericProps = properties.filter((p) =>
    ["number", "formula", "rollup"].includes(p.type)
  );

  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(decimals);

  return (
    <div style={{ padding: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: "12px",
          fontSize: "0.85em",
          color: "var(--color-text-muted, #888)",
        }}
      >
        <label>
          Decimals{" "}
          <select
            value={decimals}
            onChange={(e) => ctx.updateConfig({ decimals: Number(e.target.value) })}
            disabled={ctx.readOnly}
          >
            {[0, 1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Rows</div>
          <div style={valueStyle}>{rows.length}</div>
        </div>
        {numericProps.map((prop) => {
          const values = rows
            .map((r) => ctx.getCellValue(r.id, prop.id))
            .map((v) => (typeof v === "string" && v !== "" ? Number(v) : v))
            .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
          if (values.length === 0) return null;
          const sum = values.reduce((a, b) => a + b, 0);
          return (
            <div key={prop.id} style={cardStyle}>
              <div style={labelStyle}>{prop.name}</div>
              <div style={valueStyle}>{fmt(sum)}</div>
              <div style={{ fontSize: "0.8em", color: "var(--color-text-muted, #888)" }}>
                n={values.length} · avg {fmt(sum / values.length)} · min{" "}
                {fmt(Math.min(...values))} · max {fmt(Math.max(...values))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const statsView: CustomDatabaseViewContribution = {
  id: "stats",
  label: "Stats",
  configSchema: statsConfigSchema,
  requires: null,
  Component: StatsView,
};
