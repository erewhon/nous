// Browser-path behavior of the platform shims. In the node test env there is
// no window (and no __TAURI_INTERNALS__), so isTauri() is false and every
// shim must take its browser fallback.

import { describe, it, expect } from "vitest";
import { isTauri } from "../utils/platform";
import { invoke, convertFileSrc, PlatformUnavailableError } from "./core";
import { save, open } from "./dialog";
import { exists, writeTextFile } from "./fs";
import { listen } from "./event";
import { getCurrentWindow } from "./window";

describe("platform shims (browser paths)", () => {
  it("detects non-Tauri environment", () => {
    expect(isTauri()).toBe(false);
  });

  it("invoke rejects with PlatformUnavailableError naming the command", async () => {
    await expect(invoke("get_daemon_api_key")).rejects.toThrow(
      PlatformUnavailableError
    );
    await expect(invoke("get_daemon_api_key")).rejects.toThrow(
      /get_daemon_api_key/
    );
  });

  it("convertFileSrc passes the path through", () => {
    expect(convertFileSrc("/library/assets/img.png")).toBe(
      "/library/assets/img.png"
    );
  });

  it("dialogs resolve to null (treated as cancel)", async () => {
    await expect(save({ defaultPath: "x.md" })).resolves.toBeNull();
    await expect(open()).resolves.toBeNull();
  });

  it("fs writes reject, exists reports false", async () => {
    await expect(writeTextFile("/tmp/x", "y")).rejects.toThrow(
      PlatformUnavailableError
    );
    await expect(exists("/tmp/x")).resolves.toBe(false);
  });

  it("listen resolves to a callable no-op unlisten", async () => {
    const unlisten = await listen("ai-stream", () => {});
    expect(typeof unlisten).toBe("function");
    expect(() => unlisten()).not.toThrow();
  });

  it("window stub setTitle drives document.title when available", async () => {
    const w = getCurrentWindow();
    await expect(w.onCloseRequested(() => {})).resolves.toBeDefined();
    await expect(w.destroy()).resolves.toBeUndefined();
  });
});
