import { describe, expect, it } from "vitest";

import {
  BUILT_IN_OBJECT_TYPES,
  ObjectTypeSchema,
  createDatabaseFromObjectType,
  createDefaultRow,
} from "./database";

const events = BUILT_IN_OBJECT_TYPES.find((t) => t.name === "Events");

describe("Events object template", () => {
  it("is registered and schema-valid", () => {
    expect(events).toBeDefined();
    expect(() => ObjectTypeSchema.parse(events)).not.toThrow();
  });

  it("defines the calendar-oriented property set", () => {
    const types = Object.fromEntries(
      events!.properties.map((p) => [p.name, p.type]),
    );
    expect(types).toEqual({
      Title: "text",
      Date: "date",
      "End Date": "date",
      "All Day": "checkbox",
      Location: "text",
      Notes: "text",
    });
  });

  it("creates a database defaulting to a calendar view keyed on Date", () => {
    const content = createDatabaseFromObjectType(events!);

    expect(content.version).toBe(2);
    expect(content.rows).toEqual([]);

    const dateProp = content.properties.find((p) => p.name === "Date")!;
    const view = content.views[0];
    expect(view.type).toBe("calendar");
    expect(view.name).toBe("Calendar");
    expect(view.config).toEqual({ datePropertyId: dateProp.id });
    expect(view.sorts).toEqual([{ propertyId: dateProp.id, direction: "asc" }]);
  });

  it("seeds All Day to false on new rows", () => {
    const content = createDatabaseFromObjectType(events!);
    const allDay = content.properties.find((p) => p.name === "All Day")!;

    const row = createDefaultRow(content.properties);
    expect(row.cells[allDay.id]).toBe(false);
  });
});
