import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("../../platform/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const isTauri = vi.fn();
vi.mock("../../utils/platform", () => ({ isTauri: () => isTauri() }));

const daemonPost = vi.fn();
vi.mock("../../utils/daemon", () => ({
  daemonPost: (...a: unknown[]) => daemonPost(...a),
  DAEMON_BASE_URL: "http://localhost:7667",
}));

import { publishToNous } from "./api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishToNous", () => {
  it("invokes the Tauri command on desktop", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue({ share: { id: "x" }, url: "https://pub.nous.page/x/" });

    await publishToNous("nb", "pg", "minimal", "never");

    expect(invoke).toHaveBeenCalledWith("publish_share_to_nous", {
      request: { notebookId: "nb", pageId: "pg", theme: "minimal", expiry: "never" },
    });
    expect(daemonPost).not.toHaveBeenCalled();
  });

  it("calls the daemon endpoint on web", async () => {
    isTauri.mockReturnValue(false);
    daemonPost.mockResolvedValue({ share: { id: "x" }, url: "https://pub.nous.page/x/" });

    await publishToNous("nb", "pg", "minimal", "never");

    expect(daemonPost).toHaveBeenCalledWith(
      "/api/notebooks/nb/pages/pg/publish-nous",
      { theme: "minimal", expiry: "never" }
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
