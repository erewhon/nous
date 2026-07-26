import { describe, expect, it } from "vitest";
import type { PropertyDef } from "../../types/database";
import {
  findDueProperty,
  findIdProperty,
  findPriorityProperty,
  isDoneStatus,
  priorityRank,
  resolveStatusColor,
} from "./boardSemantics";

describe("resolveStatusColor", () => {
  it("maps well-known status names to semantic tokens", () => {
    expect(resolveStatusColor("Backlog")).toBe("var(--color-text-muted)");
    expect(resolveStatusColor("Todo")).toBe("var(--color-text-muted)");
    expect(resolveStatusColor("No value")).toBe("var(--color-text-muted)");
    expect(resolveStatusColor("Ready")).toBe("var(--color-info)");
    expect(resolveStatusColor("Open")).toBe("var(--color-info)");
    expect(resolveStatusColor("In Progress")).toBe("var(--color-accent)");
    expect(resolveStatusColor("Doing")).toBe("var(--color-accent)");
    expect(resolveStatusColor("Review")).toBe("var(--color-warning)");
    expect(resolveStatusColor("On Hold")).toBe("var(--color-warning)");
    expect(resolveStatusColor("Blocked")).toBe("var(--color-error)");
    expect(resolveStatusColor("Done")).toBe("var(--color-success)");
    expect(resolveStatusColor("Shipped")).toBe("var(--color-success)");
  });

  it("is insensitive to case, whitespace, dashes, and underscores", () => {
    expect(resolveStatusColor("  TODO ")).toBe("var(--color-text-muted)");
    expect(resolveStatusColor("In-Progress")).toBe("var(--color-accent)");
    expect(resolveStatusColor("in_progress")).toBe("var(--color-accent)");
    expect(resolveStatusColor("UP  NEXT")).toBe("var(--color-info)");
  });

  it("falls back to the stored color for unknown names", () => {
    expect(resolveStatusColor("Weirdname", "#ab12cd")).toBe("#ab12cd");
  });

  it("falls back to muted when unknown and no stored color", () => {
    expect(resolveStatusColor("Weirdname")).toBe("var(--color-text-muted)");
    expect(resolveStatusColor("Weirdname", "")).toBe(
      "var(--color-text-muted)"
    );
  });
});

describe("isDoneStatus", () => {
  it("matches exactly the success set", () => {
    for (const label of [
      "Done",
      "done",
      "Complete",
      "Completed",
      "Shipped",
      "Finished",
      "Closed",
      "Resolved",
      "Merged",
    ]) {
      expect(isDoneStatus(label)).toBe(true);
    }
  });

  it("rejects near-misses", () => {
    for (const label of ["done-ish", "undone", "Ready", "In Progress", ""]) {
      expect(isDoneStatus(label)).toBe(false);
    }
  });
});

function prop(partial: Partial<PropertyDef> & { id: string }): PropertyDef {
  return { name: partial.id, type: "text", ...partial } as PropertyDef;
}

const prioritySelect = prop({
  id: "prio",
  name: "Priority",
  type: "select",
  options: [
    { id: "o0", label: "P0", color: "#f00" },
    { id: "o1", label: "P1", color: "#fa0" },
    { id: "o2", label: "P2", color: "#0af" },
    { id: "o3", label: "P3", color: "#888" },
  ],
});

describe("findPriorityProperty", () => {
  it("finds selects and numbers named like priority", () => {
    expect(findPriorityProperty([prioritySelect])?.id).toBe("prio");
    const num = prop({ id: "n", name: "priority", type: "number" });
    expect(findPriorityProperty([num])?.id).toBe("n");
    const abbreviated = prop({ id: "p", name: "Prio", type: "select" });
    expect(findPriorityProperty([abbreviated])?.id).toBe("p");
  });

  it("ignores other properties", () => {
    const status = prop({ id: "s", name: "Status", type: "select" });
    const priorityText = prop({ id: "t", name: "Priority", type: "text" });
    expect(findPriorityProperty([status, priorityText])).toBeUndefined();
  });
});

describe("priorityRank", () => {
  it("ranks P0-P3 select labels by number", () => {
    expect(priorityRank(prioritySelect, "o0")).toBe(0);
    expect(priorityRank(prioritySelect, "o1")).toBe(1);
    expect(priorityRank(prioritySelect, "o3")).toBe(3);
  });

  it("ranks word labels", () => {
    const words = prop({
      id: "w",
      name: "Priority",
      type: "select",
      options: [
        { id: "u", label: "Urgent", color: "#f00" },
        { id: "h", label: "High", color: "#fa0" },
        { id: "m", label: "Medium", color: "#0af" },
        { id: "l", label: "Low", color: "#888" },
      ],
    });
    expect(priorityRank(words, "u")).toBe(0);
    expect(priorityRank(words, "h")).toBe(1);
    expect(priorityRank(words, "m")).toBe(2);
    expect(priorityRank(words, "l")).toBe(3);
  });

  it("falls back to option index for unrecognized labels, clamped to 3", () => {
    const custom = prop({
      id: "c",
      name: "Priority",
      type: "select",
      options: [
        { id: "a", label: "Alpha", color: "#f00" },
        { id: "b", label: "Beta", color: "#fa0" },
        { id: "c1", label: "Gamma", color: "#0af" },
        { id: "d", label: "Delta", color: "#888" },
        { id: "e", label: "Epsilon", color: "#444" },
      ],
    });
    expect(priorityRank(custom, "a")).toBe(0);
    expect(priorityRank(custom, "e")).toBe(3);
  });

  it("clamps number cells to 0-3", () => {
    const num = prop({ id: "n", name: "Priority", type: "number" });
    expect(priorityRank(num, 0)).toBe(0);
    expect(priorityRank(num, 2)).toBe(2);
    expect(priorityRank(num, 9)).toBe(3);
    expect(priorityRank(num, -1)).toBe(0);
  });

  it("returns null for empty or unresolvable values", () => {
    expect(priorityRank(prioritySelect, null)).toBeNull();
    expect(priorityRank(prioritySelect, "")).toBeNull();
    expect(priorityRank(prioritySelect, "missing-option")).toBeNull();
    const num = prop({ id: "n", name: "Priority", type: "number" });
    expect(priorityRank(num, "not-a-number")).toBeNull();
  });
});

describe("findIdProperty", () => {
  it("finds text properties named like an ID, excluding the title", () => {
    const idProp = prop({ id: "ref", name: "Ref", type: "text" });
    const title = prop({ id: "title", name: "ID", type: "text" });
    expect(findIdProperty([title, idProp], "title")?.id).toBe("ref");
    expect(findIdProperty([title], "title")).toBeUndefined();
  });

  it("ignores non-text and unrelated names", () => {
    const num = prop({ id: "n", name: "id", type: "number" });
    const notes = prop({ id: "x", name: "Notes", type: "text" });
    expect(findIdProperty([num, notes])).toBeUndefined();
  });
});

describe("findDueProperty", () => {
  it("finds the first date property", () => {
    const created = prop({ id: "d1", name: "Created", type: "date" });
    const due = prop({ id: "d2", name: "Due", type: "date" });
    expect(findDueProperty([prop({ id: "t" }), created, due])?.id).toBe("d1");
    expect(findDueProperty([prop({ id: "t" })])).toBeUndefined();
  });
});
