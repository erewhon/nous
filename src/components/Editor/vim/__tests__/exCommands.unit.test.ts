import { describe, it, expect } from "vitest";
import {
  completionsFor,
  parseExCommand,
} from "../vimExCommands";

describe("parseExCommand", () => {
  it("classifies save commands", () => {
    expect(parseExCommand("w").kind).toBe("save");
    expect(parseExCommand("wq").kind).toBe("save");
    expect(parseExCommand("x").kind).toBe("save");
    expect(parseExCommand("  w  ").kind).toBe("save");
  });

  it("classifies quit commands", () => {
    expect(parseExCommand("q").kind).toBe("quit");
    expect(parseExCommand("q!").kind).toBe("quit");
  });

  it("parses numeric line jumps", () => {
    expect(parseExCommand("42")).toEqual({ kind: "goto", line: 42 });
    expect(parseExCommand("1")).toEqual({ kind: "goto", line: 1 });
  });

  it("parses $ as goto-last", () => {
    expect(parseExCommand("$").kind).toBe("gotoLast");
  });

  it("treats empty input as noop", () => {
    expect(parseExCommand("").kind).toBe("noop");
    expect(parseExCommand("   ").kind).toBe("noop");
  });

  it("reports unknown commands with the input", () => {
    expect(parseExCommand("frobnicate")).toEqual({
      kind: "unknown",
      input: "frobnicate",
    });
  });
});

describe("completionsFor", () => {
  it("returns all commands for an empty buffer", () => {
    expect(completionsFor("").length).toBe(5);
  });

  it("prefix-matches command names", () => {
    expect(completionsFor("w").map((c) => c.name)).toEqual(["w", "wq"]);
    expect(completionsFor("q").map((c) => c.name)).toEqual(["q", "q!"]);
    expect(completionsFor("x").map((c) => c.name)).toEqual(["x"]);
  });

  it("offers nothing for numeric or $ jumps", () => {
    expect(completionsFor("42")).toEqual([]);
    expect(completionsFor("$")).toEqual([]);
  });

  it("returns nothing for a non-matching prefix", () => {
    expect(completionsFor("zzz")).toEqual([]);
  });
});
