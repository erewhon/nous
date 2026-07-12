/**
 * Custom database view contract — contribute a database view type from the
 * plugin SDK.
 *
 * Contributions are typed ES modules compiled into the app (vetted at merge
 * time — no iframes; see docs/plugin-architecture.md). A contributed view
 * receives rows already filtered and sorted per the view's sorts/filters and
 * a narrow ctx for mutations: it can edit cells, add/delete rows, patch its
 * own view config, and open the row detail sheet — it cannot restructure
 * properties, other views, or do arbitrary rows-array surgery.
 *
 * Storage: a view row `{type: "custom", config: {customViewId, viewConfig}}`
 * in DatabaseContentV2.views. ViewConfigSchema is a passthrough record, so
 * configs survive round-trips even when the contribution is missing or
 * disabled — the host renders a placeholder and never rewrites the config.
 */
import type * as React from "react";
import type { ZodType } from "zod";
import type {
  CellValue,
  DatabaseRow,
  PropertyDef,
} from "../types/database";
import { createDisabledSetStore } from "./enabled-state";

// ─── Contract ───────────────────────────────────────────────────────────────

export interface DatabaseViewCtx {
  /** Resolve a cell, computing formula/rollup/back-relation columns. */
  getCellValue(rowId: string, propertyId: string): CellValue;
  /** Edit a cell (bumps the row's updatedAt like every built-in edit path). */
  updateCell(rowId: string, propertyId: string, value: CellValue): void;
  /** Append a row (property defaults applied, then `cells` merged in). */
  addRow(cells?: Record<string, CellValue>): void;
  deleteRow(rowId: string): void;
  /** Merge a patch into this view's own config (view.config.viewConfig). */
  updateConfig(patch: Record<string, unknown>): void;
  /** Open the row detail sheet. */
  openRow(rowId: string): void;
  readOnly: boolean;
}

export interface CustomDatabaseViewProps {
  /** Rows ALREADY filtered + sorted per the view's sorts/filters. */
  rows: DatabaseRow[];
  properties: PropertyDef[];
  /** `configSchema.parse(view.config.viewConfig)` result (or the raw record). */
  config: unknown;
  ctx: DatabaseViewCtx;
}

export interface CustomDatabaseViewContribution {
  /** View id stored in view.config.customViewId, e.g. "stats". */
  id: string;
  /** Add-menu and default tab label. */
  label: string;
  /** Falls back to the puzzle icon. */
  icon?: React.ComponentType;
  /** Parsed/validated before render; config stays an opaque record in storage. */
  configSchema?: ZodType<unknown>;
  /** Add-menu prerequisite, like board (select) or calendar (date). */
  requires?: "select" | "date" | "number" | null;
  defaultEnabled?: boolean;
  Component: React.ComponentType<CustomDatabaseViewProps>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = new Map<string, CustomDatabaseViewContribution>();

/** Register a custom database view. Idempotent by id. */
export function registerCustomDatabaseView(
  contribution: CustomDatabaseViewContribution,
): void {
  registry.set(contribution.id, contribution);
}

/** All registered custom database views, in registration order. */
export function getCustomDatabaseViews(): CustomDatabaseViewContribution[] {
  return Array.from(registry.values());
}

/** Look up a contribution by its view id. */
export function getCustomDatabaseView(
  id: string,
): CustomDatabaseViewContribution | undefined {
  return registry.get(id);
}

// ─── Enabled state ──────────────────────────────────────────────────────────
//
// Disable never unregisters: existing views keep their tab and config; only
// the add-menu entry and live rendering react (placeholder panel).

export const CUSTOM_DB_VIEWS_DISABLED_KEY = "nous-custom-database-views-disabled";

const enabledStore = createDisabledSetStore(CUSTOM_DB_VIEWS_DISABLED_KEY);

export function getDisabledCustomDatabaseViews(): ReadonlySet<string> {
  return enabledStore.get();
}

export function setCustomDatabaseViewEnabled(id: string, enabled: boolean): void {
  enabledStore.setEnabled(id, enabled);
}

/** React hook: the current disabled set, re-rendering on toggle. */
export function useDisabledCustomDatabaseViews(): ReadonlySet<string> {
  return enabledStore.useDisabled();
}

/** Whether a contribution is active, given its default and any user override. */
export function isCustomDatabaseViewEnabled(
  contribution: CustomDatabaseViewContribution,
  disabledSet: ReadonlySet<string>,
): boolean {
  if (disabledSet.has(contribution.id)) return false;
  return contribution.defaultEnabled !== false;
}
