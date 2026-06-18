// @vitest-environment jsdom
//
// Bug 2 (live refresh): an open database table must reflect external writes
// from the daemon / MCP server without a manual navigate-away-and-back. The
// editor subscribes to the daemon event bus and re-reads from disk on
// `database.rows_*` events for its own page. These tests pin that wiring and
// guard against the regression where the editor listened for a Tauri event
// (`mcp-database-updated`) that nothing ever emitted.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import type { Page } from "../../types/page";
import { createDefaultDatabaseContent } from "../../types/database";

// --- Mocks ---------------------------------------------------------------

const getDatabase = vi.fn();
const putDatabase = vi.fn();
const getFileContent = vi.fn();
vi.mock("../../utils/api", () => ({
  getDatabase: (...a: unknown[]) => getDatabase(...a),
  putDatabase: (...a: unknown[]) => putDatabase(...a),
  getFileContent: (...a: unknown[]) => getFileContent(...a),
}));

// Capture the listener the editor registers so the test can synthesize the
// daemon events the real WebSocket bus would deliver.
const busListeners = new Set<(e: unknown) => void>();
vi.mock("../../utils/daemonEvents", () => ({
  daemonEventBus: {
    subscribe: (l: (e: unknown) => void) => {
      busListeners.add(l);
      return () => busListeners.delete(l);
    },
  },
}));
function emitDaemon(event: string, data: Record<string, unknown>) {
  for (const l of [...busListeners]) l({ event, data });
}

const pageStoreState = { pages: [] as unknown[], selectPage: vi.fn() };
vi.mock("../../stores/pageStore", () => {
  const usePageStore = (selector: (s: typeof pageStoreState) => unknown) =>
    selector(pageStoreState);
  (
    usePageStore as unknown as { getState: () => typeof pageStoreState }
  ).getState = () => pageStoreState;
  return { usePageStore, setPendingSavePromise: vi.fn() };
});

vi.mock("./useRelationContext", () => ({
  useRelationContext: () => ({ targetContents: {}, formulaValues: {} }),
}));

// Stub the view/toolbar subtree — these tests exercise the live-refresh wiring,
// not rendering. Keeps the mount light and jsdom-safe. (Factories are inlined
// rather than sharing a helper because vi.mock is hoisted above local consts.)
vi.mock("./DatabaseTable", () => ({ DatabaseTable: () => null }));
vi.mock("./DatabaseToolbar", () => ({ DatabaseToolbar: () => null }));
vi.mock("./DatabaseViewTabs", () => ({ DatabaseViewTabs: () => null }));
vi.mock("./DatabaseList", () => ({ DatabaseList: () => null }));
vi.mock("./DatabaseBoard", () => ({ DatabaseBoard: () => null }));
vi.mock("./DatabaseGallery", () => ({ DatabaseGallery: () => null }));
vi.mock("./DatabaseCalendar", () => ({ DatabaseCalendar: () => null }));
vi.mock("./DatabaseChart", () => ({ DatabaseChart: () => null }));
vi.mock("./DatabaseTimeline", () => ({ DatabaseTimeline: () => null }));
vi.mock("./PluginDatabaseView", () => ({ PluginDatabaseView: () => null }));

import { DatabaseEditor } from "./DatabaseEditor";

// --- Fixtures ------------------------------------------------------------

const NB = "nb-1";
const PG = "pg-db";
const DB = createDefaultDatabaseContent();

function makePage(): Page {
  return {
    id: PG,
    notebookId: NB,
    title: "Tasks",
    pageType: "database",
  } as unknown as Page;
}

beforeEach(() => {
  vi.clearAllMocks();
  busListeners.clear();
  getDatabase.mockResolvedValue({ database: DB });
  putDatabase.mockResolvedValue(undefined);
  getFileContent.mockResolvedValue("{}");
});

// vitest `globals` is off, so RTL's automatic cleanup never registers.
afterEach(() => cleanup());

// --- Tests ---------------------------------------------------------------

describe("DatabaseEditor live refresh (Bug 2)", () => {
  it("re-reads from disk when the daemon reports rows added to this page", async () => {
    render(<DatabaseEditor page={makePage()} notebookId={NB} />);
    await waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(1));

    emitDaemon("database.rows_added", { notebookId: NB, pageId: PG });

    await waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(2));
  });

  it("re-reads on rows_updated and rows_deleted too", async () => {
    render(<DatabaseEditor page={makePage()} notebookId={NB} />);
    await waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(1));

    emitDaemon("database.rows_updated", { notebookId: NB, pageId: PG });
    await waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(2));

    emitDaemon("database.rows_deleted", { notebookId: NB, pageId: PG });
    await waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(3));
  });

  it("ignores database events for a different page", async () => {
    render(<DatabaseEditor page={makePage()} notebookId={NB} />);
    await waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(1));

    emitDaemon("database.rows_updated", {
      notebookId: NB,
      pageId: "some-other-page",
    });

    // Give an erroneous refresh time to fire, then assert it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect(getDatabase).toHaveBeenCalledTimes(1);
  });

  it("ignores database.updated (the editor's own saves) to avoid a refresh loop", async () => {
    render(<DatabaseEditor page={makePage()} notebookId={NB} />);
    await waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(1));

    emitDaemon("database.updated", { notebookId: NB, pageId: PG });

    await new Promise((r) => setTimeout(r, 20));
    expect(getDatabase).toHaveBeenCalledTimes(1);
  });
});
