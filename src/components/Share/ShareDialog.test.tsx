// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ShareDialog } from "./ShareDialog";

// --- Mocks ---------------------------------------------------------------

const sharePage = vi.fn();
const publishToNous = vi.fn();
const publishFolderToNous = vi.fn();
const publishSectionToNous = vi.fn();
const publishNotebookToNous = vi.fn();
const listShares = vi.fn();
const getShareUploadConfig = vi.fn();
vi.mock("./api", () => ({
  sharePage: (...a: unknown[]) => sharePage(...a),
  shareFolder: vi.fn(),
  shareSection: vi.fn(),
  shareNotebook: vi.fn(),
  publishToNous: (...a: unknown[]) => publishToNous(...a),
  publishFolderToNous: (...a: unknown[]) => publishFolderToNous(...a),
  publishSectionToNous: (...a: unknown[]) => publishSectionToNous(...a),
  publishNotebookToNous: (...a: unknown[]) => publishNotebookToNous(...a),
  listShares: (...a: unknown[]) => listShares(...a),
  deleteShare: vi.fn(),
  getShareUploadConfig: (...a: unknown[]) => getShareUploadConfig(...a),
}));

vi.mock("../../stores/notebookStore", () => ({
  useNotebookStore: (sel: (s: { selectedNotebookId: string | null }) => unknown) =>
    sel({ selectedNotebookId: "nb-1" }),
}));
vi.mock("../../stores/pageStore", () => ({
  usePageStore: (
    sel: (s: { pages: Array<{ id: string; title: string }>; selectedPageId: string }) => unknown,
  ) => sel({ pages: [{ id: "pg-1", title: "Doc" }], selectedPageId: "pg-1" }),
}));
vi.mock("../../stores/toastStore", () => ({
  useToastStore: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../utils/daemon", () => ({ DAEMON_BASE_URL: "http://localhost:7667" }));

// --- Setup ---------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  listShares.mockResolvedValue([]);
  getShareUploadConfig.mockResolvedValue(null);
});

// vitest globals are off, so RTL's auto-cleanup never registers.
afterEach(() => cleanup());

// --- Tests ---------------------------------------------------------------

describe("ShareDialog publish destination", () => {
  it("publishes to Nous and shows the returned URL when Nous is selected", async () => {
    publishToNous.mockResolvedValue({
      share: { id: "abc12345", expiresAt: null },
      url: "https://pub.nous.page/abc12345/",
    });

    render(<ShareDialog isOpen onClose={() => {}} pageId="pg-1" notebookId="nb-1" />);
    await waitFor(() => expect(getShareUploadConfig).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Nous" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(publishToNous).toHaveBeenCalledWith("nb-1", "pg-1", "minimal", "1w"),
    );
    expect(sharePage).not.toHaveBeenCalled();
    expect(
      await screen.findByDisplayValue("https://pub.nous.page/abc12345/"),
    ).toBeInTheDocument();
  });

  it("publishes a folder mini-site to Nous via publishFolderToNous", async () => {
    publishFolderToNous.mockResolvedValue({
      share: { id: "fold1234", expiresAt: null },
      url: "https://pub.nous.page/fold1234/",
    });

    render(
      <ShareDialog
        isOpen
        onClose={() => {}}
        folderId="fld-1"
        folderName="My Folder"
        notebookId="nb-1"
      />,
    );
    await waitFor(() => expect(getShareUploadConfig).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Nous" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(publishFolderToNous).toHaveBeenCalledWith(
        "nb-1",
        "fld-1",
        "minimal",
        "1w",
        "My Folder",
      ),
    );
    expect(publishToNous).not.toHaveBeenCalled();
    expect(
      await screen.findByDisplayValue("https://pub.nous.page/fold1234/"),
    ).toBeInTheDocument();
  });

  it("uses the local daemon (sharePage) by default, not Nous", async () => {
    sharePage.mockResolvedValue({
      share: { id: "local1", externalUrl: null, expiresAt: null },
      localUrl: "http://localhost:7667/share/local1",
    });

    render(<ShareDialog isOpen onClose={() => {}} pageId="pg-1" notebookId="nb-1" />);
    await waitFor(() => expect(getShareUploadConfig).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(sharePage).toHaveBeenCalled());
    expect(publishToNous).not.toHaveBeenCalled();
  });
});
