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

import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { z } from "zod";
import { CustomDatabaseView } from "./CustomDatabaseView";
import {
  registerCustomDatabaseView,
  setCustomDatabaseViewEnabled,
  getDisabledCustomDatabaseViews,
  type CustomDatabaseViewContribution,
  type CustomDatabaseViewProps,
} from "../../plugin-sdk/custom-database-view";
import type {
  DatabaseContentV2,
  DatabaseView,
} from "../../types/database";

function makeContent(): DatabaseContentV2 {
  return {
    version: 2,
    properties: [
      { id: "title", name: "Title", type: "text" },
      { id: "score", name: "Score", type: "number" },
    ],
    rows: [
      {
        id: "r1",
        cells: { title: "Beta", score: 2 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "r2",
        cells: { title: "Alpha", score: 9 },
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
        config: {},
      },
      {
        id: "v-custom",
        name: "Test View",
        type: "custom",
        sorts: [{ propertyId: "title", direction: "asc" }],
        filters: [],
        config: { customViewId: "test-view", viewConfig: { note: "hi" } },
      },
    ],
  } as unknown as DatabaseContentV2;
}

function TestComponent({ rows, config, ctx }: CustomDatabaseViewProps) {
  return (
    <div>
      <div data-testid="order">{rows.map((r) => r.id).join(",")}</div>
      <div data-testid="config">{JSON.stringify(config)}</div>
      <button onClick={() => ctx.updateCell("r1", "score", 42)}>edit</button>
      <button onClick={() => ctx.updateConfig({ note: "bye", extra: 1 })}>
        cfg
      </button>
      <button onClick={() => ctx.addRow({ title: "New" })}>add</button>
      <button onClick={() => ctx.deleteRow("r2")}>del</button>
    </div>
  );
}

const contribution: CustomDatabaseViewContribution = {
  id: "test-view",
  label: "Test View",
  configSchema: z.looseObject({ note: z.string() }),
  Component: TestComponent,
};
registerCustomDatabaseView(contribution);

function renderHost(content = makeContent()) {
  const view = content.views.find((v) => v.id === "v-custom") as DatabaseView;
  let latest = content;
  const onUpdateContent = vi.fn(
    (updater: (prev: DatabaseContentV2) => DatabaseContentV2) => {
      latest = updater(latest);
    },
  );
  const onUpdateView = vi.fn(
    (updater: (prev: DatabaseView) => DatabaseView) => {
      const updated = updater(
        latest.views.find((v) => v.id === view.id) as DatabaseView,
      );
      latest = {
        ...latest,
        views: latest.views.map((v) => (v.id === view.id ? updated : v)),
      };
    },
  );
  const utils = render(
    <CustomDatabaseView
      content={content}
      view={view}
      onUpdateContent={onUpdateContent}
      onUpdateView={onUpdateView}
    />,
  );
  return { ...utils, getLatest: () => latest, onUpdateContent, onUpdateView };
}

afterEach(() => {
  cleanup();
  for (const id of [...getDisabledCustomDatabaseViews()]) {
    setCustomDatabaseViewEnabled(id, true);
  }
});

describe("CustomDatabaseView", () => {
  it("renders the contribution with sorted rows and parsed config", () => {
    renderHost();
    // title asc: Alpha (r2) before Beta (r1)
    expect(screen.getByTestId("order").textContent).toBe("r2,r1");
    expect(JSON.parse(screen.getByTestId("config").textContent!)).toEqual({
      note: "hi",
    });
  });

  it("updateCell edits the cell and bumps updatedAt", () => {
    const { getLatest } = renderHost();
    fireEvent.click(screen.getByText("edit"));
    const r1 = getLatest().rows.find((r) => r.id === "r1")!;
    expect(r1.cells.score).toBe(42);
    expect(r1.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("updateConfig merges into viewConfig without touching customViewId", () => {
    const { getLatest } = renderHost();
    fireEvent.click(screen.getByText("cfg"));
    const view = getLatest().views.find((v) => v.id === "v-custom")!;
    expect(view.config).toEqual({
      customViewId: "test-view",
      viewConfig: { note: "bye", extra: 1 },
    });
  });

  it("addRow applies defaults then merges cells; deleteRow removes", () => {
    const { getLatest } = renderHost();
    fireEvent.click(screen.getByText("add"));
    expect(getLatest().rows).toHaveLength(3);
    expect(getLatest().rows[2]!.cells.title).toBe("New");

    fireEvent.click(screen.getByText("del"));
    expect(getLatest().rows.map((r) => r.id)).not.toContain("r2");
  });

  it("renders a placeholder when the contribution is disabled, config intact", () => {
    const { getLatest } = renderHost();
    act(() => setCustomDatabaseViewEnabled("test-view", false));
    expect(screen.queryByTestId("order")).toBeNull();
    expect(screen.getByText(/Test View is disabled/)).toBeTruthy();
    expect(
      getLatest().views.find((v) => v.id === "v-custom")!.config,
    ).toEqual({ customViewId: "test-view", viewConfig: { note: "hi" } });

    act(() => setCustomDatabaseViewEnabled("test-view", true));
    expect(screen.getByTestId("order")).toBeTruthy();
  });

  it("renders a placeholder for an unknown customViewId", () => {
    const content = makeContent();
    const view = content.views.find((v) => v.id === "v-custom")!;
    view.config = { customViewId: "never-registered" };
    renderHost(content);
    expect(screen.getByText(/Unknown custom view "never-registered"/)).toBeTruthy();
  });

  it("renders a placeholder on config parse failure without crashing", () => {
    const content = makeContent();
    const view = content.views.find((v) => v.id === "v-custom")!;
    view.config = { customViewId: "test-view", viewConfig: { note: 42 } };
    renderHost(content);
    expect(screen.queryByTestId("order")).toBeNull();
    expect(screen.getByText(/invalid view configuration/)).toBeTruthy();
  });
});
