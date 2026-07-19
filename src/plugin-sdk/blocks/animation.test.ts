// @vitest-environment jsdom
/**
 * Palette push contract for the sandboxed animation frame.
 *
 * The frame runs at a null origin and can't read the parent's CSS custom
 * properties, so the host pushes `{type:'nous-theme', theme, palette}` and the
 * frame's listener applies the values as inline custom properties. These tests
 * execute the actual listener script from the srcdoc against the jsdom window,
 * then exercise it via real MessageEvents.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildAnimationSrcdoc, hostPalette } from "./animation";

/** Run the srcdoc's <script> listener against the test window/document. */
function installFrameListener() {
  const src = buildAnimationSrcdoc("");
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("srcdoc carries no listener script");
  new Function(m[1])();
}

function pushMessage(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

const root = () => document.documentElement;

function resetRoot() {
  root().removeAttribute("data-theme");
  root().removeAttribute("style");
}

describe("animation frame theme listener", () => {
  // The listener is idempotent (same message → same DOM state), so one
  // installation serves the whole suite.
  beforeAll(installFrameListener);
  afterEach(resetRoot);

  it("applies pushed palette values as inline custom properties before re-dispatching nous-themechange", () => {
    let accentAtDispatch: string | null = null;
    let themeDetail: string | null = null;
    const onChange = (e: Event) => {
      accentAtDispatch = root().style.getPropertyValue("--accent");
      themeDetail = (e as CustomEvent<{ theme: string }>).detail.theme;
    };
    window.addEventListener("nous-themechange", onChange);
    pushMessage({
      type: "nous-theme",
      theme: "dark",
      palette: { accent: "#3b82f6", bg: "rgb(11, 16, 32)", border: "gainsboro" },
    });
    window.removeEventListener("nous-themechange", onChange);

    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().style.getPropertyValue("--accent")).toBe("#3b82f6");
    expect(root().style.getPropertyValue("--bg")).toBe("rgb(11, 16, 32)");
    expect(root().style.getPropertyValue("--border")).toBe("gainsboro");
    // Canvas authors repaint from this event — values must already be live.
    expect(accentAtDispatch).toBe("#3b82f6");
    expect(themeDetail).toBe("dark");
  });

  it("rejects non-color values (clearing any stale override) and non-allowlisted tokens", () => {
    root().style.setProperty("--accent", "#123456"); // stale value from an earlier push
    pushMessage({
      type: "nous-theme",
      theme: "light",
      palette: {
        accent: "red;} body{background:url(https://evil)", // CSS injection attempt
        "code-bg": "url(https://evil/x.png)",
        muted: "var(--accent)", // indirection can't cross the boundary
        evil: "#ffffff", // not in the allowlist
      },
    });
    expect(root().getAttribute("data-theme")).toBe("light");
    expect(root().style.getPropertyValue("--accent")).toBe(""); // cleared, falls back to inlined default
    expect(root().style.getPropertyValue("--code-bg")).toBe("");
    expect(root().style.getPropertyValue("--muted")).toBe("");
    expect(root().style.getPropertyValue("--evil")).toBe("");
  });

  it("still flips the theme (against inlined defaults) when no palette rides the message", () => {
    root().style.setProperty("--accent", "#123456");
    pushMessage({ type: "nous-theme", theme: "dark" });
    expect(root().getAttribute("data-theme")).toBe("dark");
    // An older bridge that pushes no values must not disturb existing state.
    expect(root().style.getPropertyValue("--accent")).toBe("#123456");
  });

  it("ignores messages that are not a well-formed theme push", () => {
    pushMessage({ type: "nous-theme", theme: "hotdog", palette: { accent: "#fff" } });
    pushMessage({ type: "other", theme: "dark" });
    pushMessage(null);
    expect(root().getAttribute("data-theme")).toBeNull();
    expect(root().style.getPropertyValue("--accent")).toBe("");
  });
});

describe("hostPalette", () => {
  afterEach(() => {
    resetRoot();
    vi.unstubAllGlobals();
  });

  /**
   * jsdom's getComputedStyle doesn't reliably resolve custom properties, so
   * feed the values through a stub — the mapping and validation under test
   * live in hostPalette, not in the browser's cascade.
   */
  function stubComputedVars(vars: Record<string, string>) {
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) => vars[name] ?? "",
    }));
  }

  it("maps the desktop app's --color-* tokens onto the frame contract", () => {
    stubComputedVars({
      "--color-bg-primary": "#1e1e2e",
      "--color-text-primary": "#cdd6f4",
      "--color-accent": "#8b5cf6",
      "--color-bg-secondary": "#181825",
      "--color-bg-tertiary": "#313244",
      "--color-text-muted": "#6c7086",
      "--color-border": "#313244",
    });
    expect(hostPalette()).toEqual({
      bg: "#1e1e2e",
      text: "#cdd6f4",
      accent: "#8b5cf6",
      panel: "#181825",
      "code-bg": "#313244",
      "callout-bg": "#181825",
      muted: "#6c7086",
      border: "#313244",
    });
  });

  it("falls back to the guest editor's --guest-* tokens and omits unresolved tokens", () => {
    stubComputedVars({
      "--guest-accent": "#3b82f6",
      "--guest-bg": "#0f0f1a",
    });
    const p = hostPalette();
    expect(p.accent).toBe("#3b82f6");
    expect(p.bg).toBe("#0f0f1a");
    // Nothing resolved for these → omitted so the frame keeps its defaults.
    expect(p).not.toHaveProperty("muted");
    expect(p).not.toHaveProperty("border");
  });

  it("prefers a host already speaking the frame contract and drops non-color values", () => {
    stubComputedVars({
      "--accent": "#0066cc", // published-theme page token wins over app token
      "--color-accent": "#8b5cf6",
      "--color-text-muted": "12px solid nonsense{}", // not a color → dropped
    });
    const p = hostPalette();
    expect(p.accent).toBe("#0066cc");
    expect(p).not.toHaveProperty("muted");
  });
});
