// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

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

import { render, cleanup } from "@testing-library/react";
import { DatabaseTable } from "./DatabaseTable";
import type {
  DatabaseContentV2,
  DatabaseView,
} from "../../types/database";

function makeContent(
  overrides: {
    config?: Record<string, unknown>;
    properties?: unknown[];
    rows?: unknown[];
  } = {}
): DatabaseContentV2 {
  return {
    version: 2,
    properties: overrides.properties ?? [
      { id: "title", name: "Title", type: "text" },
      { id: "ref", name: "ID", type: "text" },
      {
        id: "status",
        name: "Status",
        type: "select",
        options: [
          { id: "s-ready", label: "Ready", color: "#222222" },
          { id: "s-prog", label: "In Progress", color: "#333333" },
          { id: "s-done", label: "Done", color: "#555555" },
        ],
      },
      {
        id: "prio",
        name: "Priority",
        type: "select",
        options: [
          { id: "p0", label: "P0", color: "#f00000" },
          { id: "p1", label: "P1", color: "#f0a000" },
          { id: "p2", label: "P2", color: "#00a0f0" },
          { id: "p3", label: "P3", color: "#808080" },
        ],
      },
    ],
    rows: overrides.rows ?? [
      {
        id: "r1",
        cells: { title: "One", ref: "NOU-231", status: "s-ready", prio: "p0" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "r2",
        cells: { title: "Two", ref: "NOU-232", status: "s-done", prio: "p2" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    views: [
      {
        id: "v-table",
        name: "Table",
        type: "table",
        sorts: [],
        filters: [],
        config: { groupByPropertyId: "status", ...(overrides.config ?? {}) },
      },
    ],
  } as unknown as DatabaseContentV2;
}

function renderTable(content = makeContent()) {
  const view = content.views.find((v) => v.id === "v-table") as DatabaseView;
  const onUpdateContent = vi.fn();
  const onUpdateView = vi.fn();
  const utils = render(
    <DatabaseTable
      content={content}
      view={view}
      onUpdateContent={onUpdateContent}
      onUpdateView={onUpdateView}
    />
  );
  return { ...utils, onUpdateContent, onUpdateView };
}

afterEach(cleanup);

describe("DatabaseTable — Corkboard record primitives", () => {
  it("renders the priority bar-glyph with rank class and mono label for select priorities", () => {
    const { container } = renderTable();
    const p0 = container.querySelector(".db-prio.db-prio-0");
    expect(p0).not.toBeNull();
    expect(p0!.querySelectorAll("i")).toHaveLength(3);
    const labels = Array.from(
      container.querySelectorAll(".db-prio-label")
    ).map((el) => el.textContent);
    expect(labels).toContain("P0");
    expect(labels).toContain("P2");
  });

  it("renders the glyph for number-typed priority properties", () => {
    const content = makeContent({
      properties: [
        { id: "title", name: "Title", type: "text" },
        { id: "prio", name: "priority", type: "number" },
      ],
      rows: [
        {
          id: "r1",
          cells: { title: "One", prio: 1 },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      config: { groupByPropertyId: undefined },
    });
    const { container } = renderTable(content);
    expect(container.querySelector(".db-prio.db-prio-1")).not.toBeNull();
  });

  it("does not hijack select displays of non-priority properties", () => {
    const { container } = renderTable();
    // Status cells must still render as pills, not glyphs.
    const statusPills = Array.from(
      container.querySelectorAll(".db-select-pill")
    ).map((el) => el.textContent);
    expect(statusPills).toContain("Ready");
    expect(statusPills).toContain("Done");
  });

  it("marks the id-like text column with db-cell-id for the mono treatment", () => {
    const { container } = renderTable();
    const idCells = Array.from(container.querySelectorAll("td.db-cell-id"));
    expect(idCells.length).toBeGreaterThan(0);
    expect(idCells.map((el) => el.textContent)).toContain("NOU-231");
    // The title column must never get the ID treatment.
    const titleCell = Array.from(container.querySelectorAll("td")).find(
      (td) => td.textContent === "One"
    );
    expect(titleCell?.className).not.toContain("db-cell-id");
  });

  it("applies db-done-text to title cells in Done groups only", () => {
    const { container } = renderTable();
    const doneTitle = Array.from(container.querySelectorAll("td")).find(
      (td) => td.textContent === "Two"
    );
    const readyTitle = Array.from(container.querySelectorAll("td")).find(
      (td) => td.textContent === "One"
    );
    expect(doneTitle?.className).toContain("db-done-text");
    expect(readyTitle?.className).not.toContain("db-done-text");
  });

  it("does not apply db-done-text when the table is ungrouped", () => {
    const content = makeContent({ config: { groupByPropertyId: undefined } });
    const { container } = renderTable(content);
    const doneTitle = Array.from(container.querySelectorAll("td")).find(
      (td) => td.textContent === "Two"
    );
    expect(doneTitle?.className).not.toContain("db-done-text");
  });
});
