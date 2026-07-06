import { describe, it, expect } from "vitest";
import {
  mobileSecondaryPropertyIds,
  toPhoneListView,
} from "./mobileListView";
import type { DatabaseView, PropertyDef } from "../../types/database";

const prop = (
  id: string,
  type: PropertyDef["type"],
  name = id
): PropertyDef => ({ id, name, type } as PropertyDef);

describe("mobileSecondaryPropertyIds", () => {
  it("picks the triage trio: select, date, number", () => {
    const props = [
      prop("title", "text"),
      prop("status", "select"),
      prop("done", "checkbox"),
      prop("priority", "number"),
      prop("completed", "date"),
      prop("phase", "select"),
      prop("estimate", "number"),
    ];
    expect(mobileSecondaryPropertyIds(props)).toEqual([
      "status",
      "completed",
      "priority",
    ]);
  });

  it("prefers name matches (Status/Priority) over property order", () => {
    // Property order puts Project and Estimate first — the triage-relevant
    // Status/Priority must still win (this is the Project Tasks shape).
    const props = [
      prop("task", "text", "Task"),
      prop("project", "select", "Project"),
      prop("status", "select", "Status"),
      prop("estimate", "number", "Estimate"),
      prop("priority", "number", "Priority"),
      prop("completed", "date", "Completed"),
    ];
    expect(mobileSecondaryPropertyIds(props)).toEqual([
      "status",
      "completed",
      "priority",
    ]);
  });

  it("omits missing types instead of padding", () => {
    const props = [prop("title", "text"), prop("status", "select")];
    expect(mobileSecondaryPropertyIds(props)).toEqual(["status"]);
  });

  it("never selects the primary text property", () => {
    const props = [prop("title", "text"), prop("notes", "text")];
    expect(mobileSecondaryPropertyIds(props)).toEqual([]);
  });
});

describe("toPhoneListView", () => {
  it("keeps id/filters/sorts and swaps type + config", () => {
    const view: DatabaseView = {
      id: "v1",
      name: "All Tasks",
      type: "table",
      sorts: [{ propertyId: "priority", direction: "asc" }],
      filters: [
        { propertyId: "status", operator: "isNot", value: "done-id" },
      ],
      config: {},
    } as DatabaseView;
    const props = [
      prop("title", "text"),
      prop("status", "select"),
      prop("priority", "number"),
    ];

    const listView = toPhoneListView(view, props);
    expect(listView.type).toBe("list");
    expect(listView.id).toBe("v1");
    expect(listView.sorts).toEqual(view.sorts);
    expect(listView.filters).toEqual(view.filters);
    expect(listView.config).toEqual({
      secondaryPropertyIds: ["status", "priority"],
    });
    // Source view untouched
    expect(view.type).toBe("table");
  });
});
