import { describe, it, expect, vi } from "vitest";

// notebookStore pulls in the persist middleware (localStorage) and the api
// module at import time; polyfill + mock them before importing the helpers.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

vi.mock("../utils/api", () => ({
  listNotebooks: vi.fn(),
  listPages: vi.fn(),
}));

import { countNonCoverPages, buildPageCounts } from "./notebookStore";
import type { Page } from "../types/page";

const page = (id: string, isCover = false): Page =>
  ({ id, isCover }) as unknown as Page;

describe("countNonCoverPages", () => {
  it("counts only non-cover pages", () => {
    expect(
      countNonCoverPages([page("a"), page("cover", true), page("b")])
    ).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(countNonCoverPages([])).toBe(0);
  });

  it("returns 0 when every page is a cover", () => {
    expect(countNonCoverPages([page("c1", true), page("c2", true)])).toBe(0);
  });
});

describe("buildPageCounts (degrade rule)", () => {
  it("maps fulfilled results and OMITS rejected notebooks entirely", () => {
    const results: PromiseSettledResult<readonly [string, number]>[] = [
      { status: "fulfilled", value: ["nb1", 5] },
      { status: "rejected", reason: new Error("boom") },
      { status: "fulfilled", value: ["nb3", 0] },
    ];
    const counts = buildPageCounts(results);
    // nb1 present, nb3 present (a real 0 is fine), nb2 absent (unknown → no badge)
    expect(counts).toEqual({ nb1: 5, nb3: 0 });
    expect("nb2" in counts).toBe(false);
  });

  it("returns an empty map when everything fails", () => {
    const results: PromiseSettledResult<readonly [string, number]>[] = [
      { status: "rejected", reason: new Error("x") },
    ];
    expect(buildPageCounts(results)).toEqual({});
  });
});
