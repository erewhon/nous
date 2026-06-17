// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { VersionHistoryDialog, formatRelativeTime } from "./VersionHistoryDialog";
import type { Page } from "../../types/page";

// --- Mocks ---------------------------------------------------------------

const refreshPages = vi.fn().mockResolvedValue(undefined);
vi.mock("../../stores/pageStore", () => ({
  usePageStore: (selector: (s: { refreshPages: typeof refreshPages }) => unknown) =>
    selector({ refreshPages }),
}));

const getPageVersions = vi.fn();
const getPageVersion = vi.fn();
const restorePageVersion = vi.fn();
vi.mock("../../utils/api", () => ({
  getPageVersions: (...a: unknown[]) => getPageVersions(...a),
  getPageVersion: (...a: unknown[]) => getPageVersion(...a),
  restorePageVersion: (...a: unknown[]) => restorePageVersion(...a),
}));

// --- Fixtures ------------------------------------------------------------

const NB = "nb-1";
const PG = "pg-1";
const VERSION_NAME = "20260101_120000_000000_000001";

function makePage(blocksText: string[]): Page {
  return {
    id: PG,
    notebookId: NB,
    title: "Doc",
    content: {
      blocks: blocksText.map((t, i) => ({
        id: `b${i}`,
        type: "paragraph",
        data: { text: t },
      })),
    },
  } as unknown as Page;
}

const VERSION = {
  name: VERSION_NAME,
  ts: new Date().toISOString(),
  blockCount: 5,
  contentHash: "sha256:abc",
  oplogEntryCount: 1,
  changesSince: 2,
  preview: "original content ZEBRA",
};

beforeEach(() => {
  vi.clearAllMocks();
  getPageVersions.mockResolvedValue([VERSION]);
  getPageVersion.mockResolvedValue(makePage(["original content ZEBRA", "more"]));
  restorePageVersion.mockResolvedValue(makePage(["original content ZEBRA"]));
});

// The project's vitest config doesn't enable `globals`, so RTL's automatic
// afterEach cleanup never registers — unmount manually to avoid DOM bleed
// between tests (otherwise repeated text matches multiple stale renders).
afterEach(() => cleanup());

// --- Tests ---------------------------------------------------------------

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-06-16T12:00:00Z");
  it("formats recent and older timestamps", () => {
    expect(formatRelativeTime("2026-06-16T11:59:30Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-06-16T11:00:00Z", now)).toBe("1 hour ago");
    expect(formatRelativeTime("2026-06-14T12:00:00Z", now)).toBe("2 days ago");
    expect(formatRelativeTime("not-a-date", now)).toBe("unknown time");
  });
});

describe("VersionHistoryDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <VersionHistoryDialog isOpen={false} page={makePage(["x"])} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(getPageVersions).not.toHaveBeenCalled();
  });

  it("lists versions on open", async () => {
    render(
      <VersionHistoryDialog isOpen={true} page={makePage(["x"])} onClose={vi.fn()} />
    );
    await waitFor(() =>
      expect(getPageVersions).toHaveBeenCalledWith(NB, PG)
    );
    expect(await screen.findByText("original content ZEBRA")).toBeInTheDocument();
    expect(screen.getByText("5 blocks")).toBeInTheDocument();
  });

  it("loads a snapshot preview when a version is selected", async () => {
    render(
      <VersionHistoryDialog isOpen={true} page={makePage(["x"])} onClose={vi.fn()} />
    );
    fireEvent.click(await screen.findByText("original content ZEBRA"));
    await waitFor(() =>
      expect(getPageVersion).toHaveBeenCalledWith(NB, PG, VERSION_NAME)
    );
  });

  it("restores via a two-step confirm, then refreshes and closes", async () => {
    const onClose = vi.fn();
    render(
      <VersionHistoryDialog isOpen={true} page={makePage(["x"])} onClose={onClose} />
    );

    // Select the version so it can be restored.
    fireEvent.click(await screen.findByText("original content ZEBRA"));
    await waitFor(() => expect(getPageVersion).toHaveBeenCalled());

    // First click arms the confirmation; no API call yet.
    fireEvent.click(screen.getByText("Restore this version"));
    expect(restorePageVersion).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm restore")).toBeInTheDocument();

    // Second click performs the restore → refresh → close.
    fireEvent.click(screen.getByText("Confirm restore"));
    await waitFor(() =>
      expect(restorePageVersion).toHaveBeenCalledWith(NB, PG, VERSION_NAME)
    );
    await waitFor(() => expect(refreshPages).toHaveBeenCalledWith([PG]));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an empty state when there are no versions", async () => {
    getPageVersions.mockResolvedValue([]);
    render(
      <VersionHistoryDialog isOpen={true} page={makePage(["x"])} onClose={vi.fn()} />
    );
    expect(await screen.findByText(/No saved versions yet/)).toBeInTheDocument();
  });
});
