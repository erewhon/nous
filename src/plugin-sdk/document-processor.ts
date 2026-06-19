/**
 * Document processor contract — Nous's LSP-style extension point.
 *
 * A document processor receives a read-only view of the current page and
 * returns annotations: decorations (visual overlays), diagnostics
 * (structured problems), actions (user-triggered fixes), and suggestions
 * (content insertions). It NEVER mutates the document directly — mirroring
 * how a language server's diagnostics don't rewrite your file. Auto-fixes
 * happen only when the user invokes an `Action`.
 *
 * This same contract is intended to describe both frontend processors
 * (TypeScript, run live in the editor) and daemon processors (Lua, run on
 * write). Only the frontend runtime exists today; `runtime` declares intent.
 *
 * See docs/plugin-architecture.md for the design rationale.
 */
import { create } from "zustand";

// ─── Positions ────────────────────────────────────────────────────────────

/** A point in the document, addressed by block (+ optional text offset). */
export interface DocPosition {
  blockId: string;
  /** Character offset within the block's text, for processors using the text view. */
  offset?: number;
}

/** A span in the document. Omitting start/end targets the whole block. */
export interface DocRange {
  blockId: string;
  start?: number;
  end?: number;
}

// ─── Result kinds ─────────────────────────────────────────────────────────

/**
 * A visual overlay the host renders.
 *
 * `inline-attr` matches every inline span carrying `attr="value"` and applies
 * `style` to it via an injected stylesheet — no DOM mutation, survives
 * re-render. This is the only kind the frontend host applies today; `range`
 * is reserved for a future ProseMirror-decoration applier.
 */
export type Decoration =
  | {
      kind: "inline-attr";
      /** Attribute present on the inline span, e.g. "data-page-title". */
      attr: string;
      /** Attribute value to match. */
      value: string;
      /** CSS declarations applied to matching spans (camel or kebab keys). */
      style: Record<string, string>;
    }
  | {
      kind: "range";
      range: DocRange;
      /** CSS class applied to the range (requires the range applier). */
      className: string;
    };

export type Severity = "error" | "warning" | "info" | "hint";

export interface Diagnostic {
  range: DocRange;
  severity: Severity;
  message: string;
  /** Processor id that produced this. */
  source: string;
}

export interface Action {
  id: string;
  title: string;
  /** Optionally anchor the action to a diagnostic/decoration location. */
  attachedTo?: DocRange;
  run: () => void | Promise<void>;
}

export interface Suggestion {
  position: DocPosition;
  text: string;
  label?: string;
}

export interface ProcessorResult {
  decorations?: Decoration[];
  diagnostics?: Diagnostic[];
  actions?: Action[];
  suggestions?: Suggestion[];
}

// ─── Context passed to a processor ──────────────────────────────────────────

/** Normalized, read-only view of a single inline content item. */
export interface InlineRef {
  blockId: string;
  /** Inline type, e.g. "text", "link", "wikiLink", "blockRef". */
  type: string;
  /** Plain text of this item (for custom inlines, a sensible label). */
  text: string;
  /** Typed props for custom inline content (e.g. wikiLink's pageTitle/pageId). */
  props?: Record<string, unknown>;
}

export interface ProcessorContext {
  pageId?: string;
  notebookId?: string;
  /** Block view: the document's blocks, read-only (BlockNote block objects). */
  blocks: ReadonlyArray<unknown>;
  /** Flat inline view across all blocks (the "text" half of the dual view). */
  inlines: ReadonlyArray<InlineRef>;
  /** Whole-document plain text (newline-joined per block). */
  text: string;
  /** Resolve a page by title within the current notebook. null if none exists. */
  resolvePageByTitle: (title: string) => { id: string; title: string } | null;
  /** Create a page with the given title, if the host wired the capability. */
  createPage?: (title: string) => void | Promise<void>;
  /** Aborted when a newer run supersedes this one — bail out of async work. */
  signal: AbortSignal;
}

// ─── Processor definition ───────────────────────────────────────────────────

export type ProcessorTrigger = "edit" | "save" | "invoke" | "index";

export interface DocumentProcessor {
  id: string;
  title: string;
  /** Where it runs. Only "frontend" is supported today. */
  runtime?: "frontend" | "daemon";
  /** Which view it primarily reads — informational for now. */
  view?: "block" | "text" | "both";
  /**
   * What re-runs it:
   *  - "edit": debounced after the user types
   *  - "save": after a save
   *  - "invoke": only when triggered explicitly
   *  - "index": when a dependency like the page index changes
   */
  triggers: ProcessorTrigger[];
  /** Debounce for the "edit" trigger (ms). Default 350. */
  debounceMs?: number;
  /** Whether it's on unless the user disables it. Default true. */
  defaultEnabled?: boolean;
  process: (ctx: ProcessorContext) => ProcessorResult | Promise<ProcessorResult>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = new Map<string, DocumentProcessor>();

/** Register a document processor (built-in or contributed). Idempotent by id. */
export function registerDocumentProcessor(processor: DocumentProcessor): void {
  registry.set(processor.id, processor);
}

/** All registered processors, in registration order. */
export function getDocumentProcessors(): DocumentProcessor[] {
  return Array.from(registry.values());
}

// ─── Enabled state ──────────────────────────────────────────────────────────
//
// Reactive so a settings toggle takes effect on the next run without an editor
// remount. The set of user-disabled ids is persisted to localStorage so a
// toggle survives a restart; everything else defaults from each processor's
// `defaultEnabled`.

export const DISABLED_STORAGE_KEY = "nous-document-processors-disabled";

function loadDisabled(): Set<string> {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(DISABLED_STORAGE_KEY)
        : null;
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function saveDisabled(disabled: ReadonlySet<string>): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DISABLED_STORAGE_KEY, JSON.stringify([...disabled]));
    }
  } catch {
    // best-effort; an unavailable/full localStorage just loses persistence
  }
}

interface ProcessorSettingsStore {
  /** Ids the user has explicitly disabled. */
  disabled: Set<string>;
  setEnabled: (id: string, enabled: boolean) => void;
}

export const useProcessorSettings = create<ProcessorSettingsStore>((set) => ({
  disabled: loadDisabled(),
  setEnabled: (id, enabled) =>
    set((state) => {
      const next = new Set(state.disabled);
      if (enabled) next.delete(id);
      else next.add(id);
      saveDisabled(next);
      return { disabled: next };
    }),
}));

/** Whether a processor should run, given its default and any user override. */
export function isProcessorEnabled(
  processor: DocumentProcessor,
  disabled: ReadonlySet<string>,
): boolean {
  if (disabled.has(processor.id)) return false;
  return processor.defaultEnabled !== false;
}
