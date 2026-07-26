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

import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { DatabaseBoard, applyBoardDrop } from "./DatabaseBoard";
import type {
  DatabaseContentV2,
  DatabaseView,
  PropertyDef,
} from "../../types/database";

function makeContent(
  configOverrides: Record<string, unknown> = {}
): DatabaseContentV2 {
  return {
    version: 2,
    properties: [
      { id: "title", name: "Title", type: "text" },
      {
        id: "status",
        name: "Status",
        type: "select",
        options: [
          { id: "s-backlog", label: "Backlog", color: "#111111" },
          { id: "s-ready", label: "Ready", color: "#222222" },
          { id: "s-prog", label: "In Progress", color: "#333333" },
          { id: "s-review", label: "Review", color: "#444444" },
          { id: "s-done", label: "Done", color: "#555555" },
          { id: "s-weird", label: "Weirdname", color: "#ab12cd" },
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
      { id: "due", name: "Due", type: "date" },
      {
        id: "tags",
        name: "Tags",
        type: "multiSelect",
        options: [
          { id: "t1", label: "alpha", color: "#00f000" },
          { id: "t2", label: "beta", color: "#0000f0" },
        ],
      },
    ],
    rows: [
      {
        id: "r5",
        cells: { title: "Five", status: "s-backlog" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "r1",
        cells: {
          title: "One",
          status: "s-ready",
          prio: "p0",
          due: "2020-01-02",
          tags: ["t1"],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "r2",
        cells: { title: "Two", status: "s-prog" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "r3",
        cells: { title: "Three", status: "s-prog" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "r4",
        cells: { title: "Four", status: "s-done" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    views: [
      {
        id: "v-board",
        name: "Board",
        type: "board",
        sorts: [],
        filters: [],
        config: {
          groupByPropertyId: "status",
          cardPropertyIds: ["prio", "due", "tags"],
          ...configOverrides,
        },
      },
    ],
  } as unknown as DatabaseContentV2;
}

function renderBoard(content = makeContent()) {
  const view = content.views.find((v) => v.id === "v-board") as DatabaseView;
  let latest = content;
  const onUpdateContent = vi.fn(
    (updater: (prev: DatabaseContentV2) => DatabaseContentV2) => {
      latest = updater(latest);
    }
  );
  const onUpdateView = vi.fn((updater: (prev: DatabaseView) => DatabaseView) => {
    const updated = updater(
      latest.views.find((v) => v.id === view.id) as DatabaseView
    );
    latest = {
      ...latest,
      views: latest.views.map((v) => (v.id === view.id ? updated : v)),
    };
  });
  const utils = render(
    <DatabaseBoard
      content={content}
      view={view}
      onUpdateContent={onUpdateContent}
      onUpdateView={onUpdateView}
    />
  );
  const getView = () =>
    latest.views.find((v) => v.id === view.id) as DatabaseView;
  return { ...utils, getLatest: () => latest, getView, onUpdateContent, onUpdateView };
}

function getColumn(label: string): HTMLElement {
  const col = document.querySelector<HTMLElement>(
    `section[aria-label="${label} column"]`
  );
  if (!col) throw new Error(`column "${label}" not found`);
  return col;
}

afterEach(() => cleanup());

describe("DatabaseBoard — Corkboard", () => {
  it("renders one column per option with resolver-threaded colors", () => {
    renderBoard();
    expect(getColumn("Ready").style.getPropertyValue("--col-color")).toBe(
      "var(--color-info)"
    );
    expect(getColumn("In Progress").style.getPropertyValue("--col-color")).toBe(
      "var(--color-accent)"
    );
    expect(getColumn("Done").style.getPropertyValue("--col-color")).toBe(
      "var(--color-success)"
    );
    // Unrecognized names keep their stored hex
    expect(getColumn("Weirdname").style.getPropertyValue("--col-color")).toBe(
      "#ab12cd"
    );
  });

  it("shows n / limit in warning when a column exceeds its WIP limit", () => {
    renderBoard(makeContent({ wipLimits: { "s-prog": 1 } }));
    const count = within(getColumn("In Progress")).getByText("2 / 1");
    expect(count.className).toContain("db-board-column-count-over");
    // A column at/below its limit is not flagged
    renderBoard(makeContent({ wipLimits: { "s-prog": 5 } }));
  });

  it("renders collapsed columns as rails and expands on click", () => {
    const { getView } = renderBoard(
      makeContent({ collapsedColumns: ["s-backlog"] })
    );
    const rail = document.querySelector<HTMLElement>(
      'section[aria-label="Backlog column, collapsed"]'
    );
    expect(rail).not.toBeNull();
    expect(rail!.className).toContain("db-board-column-collapsed");
    // Its card is not rendered
    expect(screen.queryByText("Five")).toBeNull();

    fireEvent.click(rail!);
    expect(
      (getView().config as { collapsedColumns?: string[] }).collapsedColumns
    ).toBeUndefined();
  });

  it("applies the Done treatment to cards in done-named columns", () => {
    renderBoard();
    const doneCard = screen.getByText("Four").closest(".db-board-card");
    expect(doneCard?.className).toContain("db-board-card-done");
    const normalCard = screen.getByText("One").closest(".db-board-card");
    expect(normalCard?.className).not.toContain("db-board-card-done");
  });

  it("shows a quiet hint in empty columns", () => {
    renderBoard();
    expect(
      within(getColumn("Review")).getByText(/Nothing here yet/)
    ).toBeTruthy();
  });

  it("renders card slots: priority glyph, formatted overdue date, no ID row", () => {
    renderBoard();
    const card = screen.getByText("One").closest(".db-board-card")!;
    expect(card.querySelector(".db-prio.db-prio-0")).not.toBeNull();
    const due = card.querySelector(".db-board-card-due");
    expect(due?.textContent).toBe("Jan 2");
    expect(due?.className).toContain("db-board-card-due-late");
    // Tag pill renders inside the wrap-and-clip tagset
    expect(
      card.querySelector(".db-board-card-tagset")?.textContent
    ).toContain("alpha");
    // No ID-like text property in the fixture → no mono ID slot anywhere
    expect(document.querySelector(".db-tid")).toBeNull();
  });

  it("moves focus with arrows and opens the detail sheet with Enter", () => {
    renderBoard();
    const container = document.querySelector(".db-board-container")!;

    // First arrow press adopts the first card (Backlog / Five)
    fireEvent.keyDown(container, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-row-id")).toBe("r5");

    // Right moves to the next non-empty column (Ready / One)
    fireEvent.keyDown(container, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-row-id")).toBe("r1");

    // Right again lands in In Progress; Down moves within the column
    fireEvent.keyDown(container, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-row-id")).toBe("r2");
    fireEvent.keyDown(container, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-row-id")).toBe("r3");

    fireEvent.keyDown(container, { key: "Enter" });
    expect(screen.getByText("Delete row")).toBeTruthy();
  });

  it("moves the focused card to the adjacent column with Shift+Arrow", () => {
    const { getLatest } = renderBoard();
    const container = document.querySelector(".db-board-container")!;
    fireEvent.keyDown(container, { key: "ArrowRight" }); // focus r5 (Backlog)
    fireEvent.keyDown(container, { key: "ArrowRight", shiftKey: true });
    expect(
      getLatest().rows.find((r) => r.id === "r5")!.cells.status
    ).toBe("s-ready");
  });

  it("add-card seeds the column's group value and opens the detail sheet", () => {
    const { getLatest, getView, rerender, onUpdateContent, onUpdateView } =
      renderBoard();
    fireEvent.click(within(getColumn("Ready")).getByText("New"));
    const rows = getLatest().rows;
    expect(rows).toHaveLength(6);
    expect(rows[5]!.cells.status).toBe("s-ready");
    // The host (DatabaseEditor) re-renders with the updated content; the
    // detail sheet for the fresh row appears on that pass.
    rerender(
      <DatabaseBoard
        content={getLatest()}
        view={getView()}
        onUpdateContent={onUpdateContent}
        onUpdateView={onUpdateView}
      />
    );
    expect(screen.getByText("Delete row")).toBeTruthy();
  });

  it("column menu: collapse, WIP limit, and board-wide sort", () => {
    const { getView } = renderBoard();
    const openMenu = (label: string) =>
      fireEvent.click(within(getColumn(label)).getByLabelText("Column menu"));

    openMenu("Ready");
    fireEvent.click(screen.getByText("Collapse column"));
    expect(
      (getView().config as { collapsedColumns?: string[] }).collapsedColumns
    ).toEqual(["s-ready"]);

    openMenu("In Progress");
    fireEvent.click(screen.getByText("Set WIP limit…"));
    const input = document.querySelector<HTMLInputElement>(
      ".db-board-col-menu-wip input"
    )!;
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByText("Set"));
    expect(
      (getView().config as { wipLimits?: Record<string, number> }).wipLimits
    ).toEqual({ "s-prog": 3 });

    openMenu("In Progress");
    fireEvent.click(screen.getByText("Priority"));
    expect(getView().sorts).toEqual([{ propertyId: "prio", direction: "asc" }]);
  });
});

describe("applyBoardDrop", () => {
  const content = makeContent();
  const groupProp = content.properties.find(
    (p) => p.id === "status"
  ) as PropertyDef;

  it("moves a select-grouped row to the target column", () => {
    const next = applyBoardDrop(content, groupProp, "status", "r1", "s-done");
    expect(next.rows.find((r) => r.id === "r1")!.cells.status).toBe("s-done");
  });

  it("drops to the no-value column by clearing the cell", () => {
    const next = applyBoardDrop(
      content,
      groupProp,
      "status",
      "r1",
      "__no_value__"
    );
    expect(next.rows.find((r) => r.id === "r1")!.cells.status).toBeNull();
  });

  it("multiSelect: strips the group's own options, keeps foreign ids", () => {
    const multiProp: PropertyDef = {
      id: "labels",
      name: "Labels",
      type: "multiSelect",
      options: [
        { id: "l1", label: "L1", color: "#111111" },
        { id: "l2", label: "L2", color: "#222222" },
      ],
    };
    const base: DatabaseContentV2 = {
      ...content,
      rows: [
        {
          id: "m1",
          cells: { labels: ["l1", "external-id"] },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const next = applyBoardDrop(base, multiProp, "labels", "m1", "l2");
    expect(next.rows[0]!.cells.labels).toEqual(["external-id", "l2"]);
  });
});
