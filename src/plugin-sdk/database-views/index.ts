/**
 * Built-in custom database views.
 *
 * Calling registerBuiltinDatabaseViews() registers the view contributions
 * that ship with Nous. The database editor host calls it before reading the
 * registry. New built-ins register here.
 */
import { registerCustomDatabaseView } from "../custom-database-view";
import { statsView } from "./stats";
import { heatmapView } from "./heatmap";

let registered = false;

/** Register all built-in custom database views. Idempotent. */
export function registerBuiltinDatabaseViews(): void {
  if (registered) return;
  registered = true;
  registerCustomDatabaseView(statsView);
  registerCustomDatabaseView(heatmapView);
}
