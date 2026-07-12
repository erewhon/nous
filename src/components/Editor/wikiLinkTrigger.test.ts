import { describe, it, expect } from "vitest";
import { wikiTriggerAction } from "./wikiLinkTrigger";

describe("wikiTriggerAction", () => {
  describe("menu closed", () => {
    it("opens on [ typed after a lone [", () => {
      expect(wikiTriggerAction("[", "x[", false)).toBe("open");
    });

    it("opens at the start of a block (only [ before caret)", () => {
      expect(wikiTriggerAction("[", "[", false)).toBe("open");
    });

    it("does not open on a single [ with no [ before it", () => {
      expect(wikiTriggerAction("[", "ab", false)).toBe("pass");
      expect(wikiTriggerAction("[", "", false)).toBe("pass");
    });

    it("does not re-open on a third [", () => {
      expect(wikiTriggerAction("[", "[[", false)).toBe("pass");
    });

    it("ignores other characters", () => {
      expect(wikiTriggerAction("a", "x[", false)).toBe("pass");
      expect(wikiTriggerAction("]", "x]", false)).toBe("pass");
    });
  });

  describe("menu open", () => {
    it("passes ordinary typing through (query extends)", () => {
      expect(wikiTriggerAction("a", "[[", true)).toBe("pass");
    });

    it("passes a colon through (emoji trigger must not hijack)", () => {
      expect(wikiTriggerAction(":", "re", true)).toBe("pass");
    });

    it("passes a slash through", () => {
      expect(wikiTriggerAction("/", "gs", true)).toBe("pass");
    });

    it("passes a first ] through", () => {
      expect(wikiTriggerAction("]", "ge", true)).toBe("pass");
    });

    it("closes on the second ] of ]]", () => {
      expect(wikiTriggerAction("]", "e]", true)).toBe("close");
    });

    it("does not open a nested menu on [[ while open", () => {
      expect(wikiTriggerAction("[", "x[", true)).toBe("pass");
    });
  });
});
