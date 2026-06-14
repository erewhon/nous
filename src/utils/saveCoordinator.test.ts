import { describe, it, expect, vi } from "vitest";
import { registerSaveFlusher, flushAllSaves } from "./saveCoordinator";

describe("saveCoordinator (DL-26)", () => {
  it("flushes every registered editor", async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const ua = registerSaveFlusher(a);
    const ub = registerSaveFlusher(b);
    await flushAllSaves();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    ua();
    ub();
  });

  it("does not call an unregistered flusher", async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const ua = registerSaveFlusher(a);
    ua();
    await flushAllSaves();
    expect(a).not.toHaveBeenCalled();
  });

  it("resolves via timeout even if a flush hangs (won't block window close)", async () => {
    const hang = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    const u = registerSaveFlusher(hang);
    await flushAllSaves(50);
    expect(hang).toHaveBeenCalled();
    u();
  });
});
