/**
 * Custom block contract — contribute a BlockNote block type from the
 * plugin SDK.
 *
 * Contributions are typed ES modules compiled into the app (vetted at merge
 * time — no dynamic loading, no iframes; see docs/plugin-architecture.md).
 * The schema is static per build: every registered contribution is always in
 * the schema, and disabling one only hides its slash-menu entry and renders
 * existing instances through a dimmed placeholder — the data is untouched.
 *
 * Complex state lives in a JSON-string prop (BlockNote props are
 * string-valued; see DatabaseBlock's `contentJson`). Anything BlockNote's
 * surface doesn't support — non-string props, custom HTML parsing — is out
 * of contract.
 *
 * Markdown export is Rust-side and does not know about contributed blocks:
 * they are skipped in markdown export. If a contributed block needs export,
 * file a follow-up for a `toMarkdown` hook — don't work around it here.
 *
 * This module must stay dependency-light: the guest editor
 * (collab/guest-editor) imports it into its own bundle, so React is the only
 * runtime dependency allowed (no zustand, no app stores, no Tailwind).
 */
import type * as React from "react";
import { createDisabledSetStore } from "./enabled-state";

// ─── Contract ───────────────────────────────────────────────────────────────

export interface CustomBlockRenderProps {
  /** Current block prop values (always strings). */
  props: Record<string, string>;
  /** Patch block props — wraps editor.updateBlock. */
  updateProps: (patch: Record<string, string>) => void;
  readOnly: boolean;
  ctx: { notebookId?: string; pageId?: string };
  /**
   * For `content: "inline"` blocks only: ref callback marking the element
   * that hosts the block's editable inline content.
   */
  contentRef?: (el: HTMLElement | null) => void;
}

export interface CustomBlockContribution {
  /** Block type name, e.g. "mermaid". Becomes the Editor.js `type` on disk. */
  id: string;
  /** Slash-menu label. */
  title: string;
  /** Slash-menu group. Default "Custom". */
  group?: string;
  /** Slash-menu search aliases. */
  keywords?: string[];
  icon?: React.ComponentType;
  /** BlockNote props are string-valued. */
  propSchema: Record<string, { default: string }>;
  /** Default "none". */
  content?: "none" | "inline";
  /** Whether it's on unless the user disables it. Default true. */
  defaultEnabled?: boolean;
  Render: React.ComponentType<CustomBlockRenderProps>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = new Map<string, CustomBlockContribution>();

/** Register a custom block (built-in or contributed). Idempotent by id. */
export function registerCustomBlock(contribution: CustomBlockContribution): void {
  registry.set(contribution.id, contribution);
}

/** All registered custom blocks, in registration order. */
export function getCustomBlocks(): CustomBlockContribution[] {
  return Array.from(registry.values());
}

/** Look up a contribution by block type id. */
export function getCustomBlock(id: string): CustomBlockContribution | undefined {
  return registry.get(id);
}

// ─── Enabled state ──────────────────────────────────────────────────────────
//
// Reactive without zustand (the guest editor bundle imports this module) via
// useSyncExternalStore. The set of user-disabled ids persists to localStorage;
// everything else defaults from each contribution's `defaultEnabled`.
// Disable NEVER unregisters — the spec stays in the schema so existing
// documents keep loading; only the slash-menu entry and live rendering react.

export const CUSTOM_BLOCKS_DISABLED_KEY = "nous-custom-blocks-disabled";

const enabledStore = createDisabledSetStore(CUSTOM_BLOCKS_DISABLED_KEY);

export function getDisabledCustomBlocks(): ReadonlySet<string> {
  return enabledStore.get();
}

export function setCustomBlockEnabled(id: string, enabled: boolean): void {
  enabledStore.setEnabled(id, enabled);
}

export function subscribeCustomBlockSettings(cb: () => void): () => void {
  return enabledStore.subscribe(cb);
}

/** React hook: the current disabled set, re-rendering on toggle. */
export function useDisabledCustomBlocks(): ReadonlySet<string> {
  return enabledStore.useDisabled();
}

/** Whether a contribution is active, given its default and any user override. */
export function isCustomBlockEnabled(
  contribution: CustomBlockContribution,
  disabledSet: ReadonlySet<string>,
): boolean {
  if (disabledSet.has(contribution.id)) return false;
  return contribution.defaultEnabled !== false;
}
