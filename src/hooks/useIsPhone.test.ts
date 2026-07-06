// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

afterEach(cleanup);

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
      listeners.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
      listeners.delete(cb),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb({ matches: next }));
    },
  };
}

import { useIsPhone } from "./useIsPhone";
import { useMobileStore } from "../stores/mobileStore";

describe("useIsPhone", () => {
  it("reflects the media query and reacts to changes", () => {
    const mq = mockMatchMedia(false);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);

    act(() => mq.setMatches(true));
    expect(result.current).toBe(true);

    act(() => mq.setMatches(false));
    expect(result.current).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("mobileStore", () => {
  it("toggles and closes the drawer", () => {
    const s = useMobileStore.getState();
    expect(useMobileStore.getState().drawerOpen).toBe(false);
    s.toggleDrawer();
    expect(useMobileStore.getState().drawerOpen).toBe(true);
    s.closeDrawer();
    expect(useMobileStore.getState().drawerOpen).toBe(false);
    s.openDrawer();
    expect(useMobileStore.getState().drawerOpen).toBe(true);
    useMobileStore.setState({ drawerOpen: false });
  });
});
