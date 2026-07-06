import type { DatabaseView, PropertyDef } from "../../types/database";

// Phone rendering of table views (see Forge "Spec: Nous Mobile Web
// Experience" §4): below the phone breakpoint a table renders as the card
// list (DatabaseList) with a synthesized view. Filters and sorts carry
// over; the cards show up to three "mobile properties" chosen by
// heuristic — the triage-relevant trio of status-ish select, date, and
// priority-ish number. (Making this a view-config field is a later step.)

export function mobileSecondaryPropertyIds(
  properties: PropertyDef[]
): string[] {
  const primary = properties.find((p) => p.type === "text");
  const candidates = properties.filter((p) => p !== primary);
  const firstOf = (
    type: PropertyDef["type"],
    preferName?: RegExp
  ): string | undefined => {
    const ofType = candidates.filter((p) => p.type === type);
    if (preferName) {
      const preferred = ofType.find((p) => preferName.test(p.name));
      if (preferred) return preferred.id;
    }
    return ofType[0]?.id;
  };

  return [
    firstOf("select", /status|state/i),
    firstOf("date", /due|complete/i),
    firstOf("number", /priorit/i),
  ].filter((id): id is string => id !== undefined);
}

/**
 * Synthesize a list view from a table view for phone rendering. The
 * result is render-only: DatabaseList never writes view config back, so
 * the underlying table view is untouched.
 */
export function toPhoneListView(
  view: DatabaseView,
  properties: PropertyDef[]
): DatabaseView {
  return {
    ...view,
    type: "list",
    config: { secondaryPropertyIds: mobileSecondaryPropertyIds(properties) },
  };
}
