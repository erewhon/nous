// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Node 25 defines a globalThis.localStorage getter that yields undefined
// without --localstorage-file, shadowing jsdom's. Polyfill before imports.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
import { buildHeatmapData, levelColor, heatmapView } from "./heatmap";
import type { DatabaseViewCtx } from "../custom-database-view";
import type { CellValue, DatabaseRow, PropertyDef } from "../../types/database";
import { migrateLegacyPluginViews } from "../../types/database";
import type { DatabaseContentV2 } from "../../types/database";

function row(id: string, cells: Record<string, CellValue>): DatabaseRow {
  return {
    id,
    cells,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("buildHeatmapData", () => {
  it("sums values per day and tracks the max", () => {
    const rows = [
      row("a", { date: "2026-07-01", n: 2 }),
      row("b", { date: "2026-07-01T10:30:00Z", n: 3 }),
      row("c", { date: "2026-07-02", n: 1 }),
    ];
    const { totals, max } = buildHeatmapData(rows, "date", (r) =>
      Number(r.cells.n),
    );
    expect(totals.get("2026-07-01")).toBe(5);
    expect(totals.get("2026-07-02")).toBe(1);
    expect(max).toBe(5);
  });

  it("counts rows when the value resolver returns 1", () => {
    const rows = [
      row("a", { date: "2026-07-01" }),
      row("b", { date: "2026-07-01" }),
    ];
    const { totals } = buildHeatmapData(rows, "date", () => 1);
    expect(totals.get("2026-07-01")).toBe(2);
  });

  it("skips rows without a date value", () => {
    const rows = [row("a", { date: "" }), row("b", {})];
    const { totals } = buildHeatmapData(rows, "date", () => 1);
    expect(totals.size).toBe(0);
  });
});

describe("levelColor", () => {
  it("maps zero/undefined to the empty color and scales by ratio", () => {
    expect(levelColor(undefined, 10)).toContain("var(");
    expect(levelColor(0, 10)).toContain("var(");
    expect(levelColor(2, 10)).toBe("#0e4429");
    expect(levelColor(5, 10)).toBe("#006d32");
    expect(levelColor(7, 10)).toBe("#26a641");
    expect(levelColor(10, 10)).toBe("#39d353");
  });
});

describe("HeatmapView component", () => {
  const properties = [
    { id: "title", name: "Title", type: "text" },
    { id: "when", name: "When", type: "date" },
    { id: "amount", name: "Amount", type: "number" },
  ] as PropertyDef[];

  function ctx(overrides: Partial<DatabaseViewCtx> = {}): DatabaseViewCtx {
    return {
      getCellValue: vi.fn((rowId: string, propId: string) => {
        const r = rows.find((x) => x.id === rowId);
        return r?.cells[propId] ?? null;
      }),
      updateCell: vi.fn(),
      addRow: vi.fn(),
      deleteRow: vi.fn(),
      updateConfig: vi.fn(),
      openRow: vi.fn(),
      readOnly: false,
      ...overrides,
    };
  }

  const rows = [
    row("r1", { when: isoDaysAgo(1), amount: 4 }),
    row("r2", { when: isoDaysAgo(1), amount: 6 }),
    row("r3", { when: isoDaysAgo(400), amount: 9 }), // outside the window
  ];

  it("renders a grid with recent days colored by summed value", () => {
    const { container } = render(
      <heatmapView.Component rows={rows} properties={properties} config={{}} ctx={ctx()} />,
    );
    const cell = container.querySelector(`rect[data-date="${isoDaysAgo(1)}"]`)!;
    expect(cell).toBeTruthy();
    // 10 is the max → highest level
    expect(cell.getAttribute("fill")).toBe("#39d353");
    expect(screen.getByText(/Sum of Amount per day/)).toBeTruthy();
  });

  it("persists column choices through ctx.updateConfig", () => {
    const c = ctx();
    render(
      <heatmapView.Component rows={rows} properties={properties} config={{}} ctx={c} />,
    );
    fireEvent.change(screen.getByDisplayValue("Amount"), {
      target: { value: "" },
    });
    expect(c.updateConfig).toHaveBeenCalledWith({ valuePropertyId: "" });
  });

  it("explains itself when no date property exists", () => {
    render(
      <heatmapView.Component
        rows={[]}
        properties={[{ id: "t", name: "T", type: "text" } as PropertyDef]}
        config={{}}
        ctx={ctx()}
      />,
    );
    expect(screen.getByText(/No date column found/)).toBeTruthy();
  });

  it("hides the column selectors when read-only", () => {
    render(
      <heatmapView.Component
        rows={rows}
        properties={properties}
        config={{}}
        ctx={ctx({ readOnly: true })}
      />,
    );
    expect(screen.queryByDisplayValue("Amount")).toBeNull();
  });
});

describe("migrateLegacyPluginViews", () => {
  function content(views: DatabaseContentV2["views"]): DatabaseContentV2 {
    return { version: 2, properties: [], rows: [], views } as DatabaseContentV2;
  }

  it("rewrites a legacy heatmap plugin view to the contributed view", () => {
    const migrated = migrateLegacyPluginViews(
      content([
        {
          id: "v1",
          name: "Heatmap",
          type: "plugin",
          sorts: [],
          filters: [{ propertyId: "p", operator: "isNotEmpty", value: null }],
          config: {
            pluginId: "nous.builtin.database-heatmap",
            viewType: "heatmap",
            pluginConfig: { datePropertyId: "when" },
          },
        },
      ]),
    );
    expect(migrated.views[0]).toEqual({
      id: "v1",
      name: "Heatmap",
      type: "custom",
      sorts: [],
      filters: [{ propertyId: "p", operator: "isNotEmpty", value: null }],
      config: { customViewId: "heatmap", viewConfig: { datePropertyId: "when" } },
    });
  });

  it("leaves successor-less plugin views as dead-letter, config intact", () => {
    const original = content([
      {
        id: "v1",
        name: "Nutrition Summary",
        type: "plugin",
        sorts: [],
        filters: [],
        config: { pluginId: "nous.builtin.food-tracker", viewType: "nutrition_summary" },
      },
    ]);
    expect(migrateLegacyPluginViews(original)).toBe(original);
  });

  it("does not touch non-plugin views", () => {
    const original = content([
      { id: "v1", name: "Table", type: "table", sorts: [], filters: [], config: {} },
    ]);
    expect(migrateLegacyPluginViews(original)).toBe(original);
  });
});
