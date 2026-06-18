// @vitest-environment jsdom
//
// putDatabase is the editor's whole-content database save. It must forward the
// `baseline` (the full content the editor loaded) so the daemon can 3-way merge
// concurrent cell/schema/view edits, and preserve it when queueing to the outbox
// on failure. (The merge itself is covered by Rust tests in bin/cli/api.rs.)
import { describe, it, expect, vi, beforeEach } from "vitest";

const daemonPut = vi.fn();
vi.mock("./daemon", () => ({
  daemonGet: vi.fn(),
  daemonPost: vi.fn(),
  daemonPut: (...a: unknown[]) => daemonPut(...a),
  daemonDelete: vi.fn(),
}));

const enqueueFailedDatabaseSave = vi.fn();
vi.mock("./saveOutbox", () => ({
  enqueueFailedDatabaseSave: (...a: unknown[]) => enqueueFailedDatabaseSave(...a),
}));

import { putDatabase } from "./api";

beforeEach(() => vi.clearAllMocks());

describe("putDatabase baseline plumbing", () => {
  it("forwards the full baseline for the 3-way merge when provided", async () => {
    daemonPut.mockResolvedValue({});
    const base = { rows: [{ id: "r1" }], properties: [{ id: "p1" }] };
    await putDatabase("n", "db1", { rows: [] }, ["r1"], base);
    expect(daemonPut).toHaveBeenCalledWith("/api/notebooks/n/databases/db1", {
      database: { rows: [] },
      baselineRowIds: ["r1"],
      baseline: base,
    });
  });

  it("omits baseline when not provided (older callers / back-compat)", async () => {
    daemonPut.mockResolvedValue({});
    await putDatabase("n", "db1", { rows: [] }, ["r1"]);
    expect(daemonPut).toHaveBeenCalledWith("/api/notebooks/n/databases/db1", {
      database: { rows: [] },
      baselineRowIds: ["r1"],
    });
  });

  it("queues to the outbox WITH the baseline on failure (so the retry still merges)", async () => {
    daemonPut.mockRejectedValue(new Error("offline"));
    const base = { rows: [{ id: "r1" }] };
    await expect(
      putDatabase("n", "db1", { rows: [] }, ["r1"], base)
    ).rejects.toThrow();
    expect(enqueueFailedDatabaseSave).toHaveBeenCalledWith(
      expect.objectContaining({ baseline: base, baselineRowIds: ["r1"] })
    );
  });
});
