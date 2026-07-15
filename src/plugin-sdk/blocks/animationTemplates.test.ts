import { describe, it, expect } from "vitest";
import { ANIMATION_TEMPLATES } from "./animationTemplates";

describe("animation starter templates", () => {
  it("ships a few templates with unique ids and non-empty source", () => {
    expect(ANIMATION_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    const ids = ANIMATION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ANIMATION_TEMPLATES) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.html.trim().length).toBeGreaterThan(0);
    }
  });

  it("templates are self-contained — no external network references", () => {
    for (const t of ANIMATION_TEMPLATES) {
      // The block's inner CSP blocks these anyway; keep the starters clean.
      expect(t.html).not.toMatch(/https?:\/\//);
      expect(t.html).not.toMatch(/\bfetch\s*\(/);
      expect(t.html).not.toMatch(/\bimport\s+/);
      expect(t.html).not.toMatch(/src\s*=\s*["']https?:/);
    }
  });

  it("templates theme with the page and honor reduced motion", () => {
    for (const t of ANIMATION_TEMPLATES) {
      // Reads at least one injected palette custom property (via var() in CSS
      // or getPropertyValue('--…') in canvas templates).
      expect(t.html).toMatch(/--(accent|muted|text)\b/);
      // Has a reduced-motion path (JS guard or CSS media query).
      expect(t.html).toMatch(/prefers-reduced-motion/);
    }
  });
});
