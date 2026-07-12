/**
 * Host runtime for document processors in the BlockNote editor.
 *
 * Builds a read-only ProcessorContext from the live editor document, runs the
 * enabled processors on the right triggers (mount/index change, debounced
 * edits), merges their results, and applies decorations.
 *
 * Decorations are applied with a single injected <style> element scoped to
 * this editor instance — the WebKitGTK-safe technique from the Editor.js path.
 * Processors never mutate the document, so there's no save churn, collab
 * interaction, or re-render fight. Diagnostics and actions are returned for a
 * future surfacing UI (a problems panel / quick-fix menu).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getDocumentProcessors,
  isProcessorEnabled,
  useProcessorSettings,
  type Action,
  type Decoration,
  type Diagnostic,
  type InlineRef,
  type ProcessorContext,
} from "../../plugin-sdk/document-processor";
import { registerBuiltinProcessors } from "../../plugin-sdk/processors";
import { registerDocumentProcessor } from "../../plugin-sdk/document-processor";
import { daemonDecorationsProcessor } from "./daemonDecorationsProcessor";
import {
  buildDecorationCss,
  buildTitleResolver,
  buildText,
  collectInlines,
  type AnyBlock,
} from "./documentProcessorUtils";

registerBuiltinProcessors();
// Host-side bridge: daemon (Lua) editor_decoration plugins run through the
// same processor pipeline as frontend processors.
registerDocumentProcessor(daemonDecorationsProcessor);

// ─── Hook ───────────────────────────────────────────────────────────────────

interface EditorLike {
  document: unknown;
}

interface UseDocumentProcessorsOptions {
  editor: EditorLike;
  pageId?: string;
  notebookId?: string;
  /** Candidate pages for title resolution (notebook-scoped {id,title}). */
  pages?: ReadonlyArray<{ id: string; title: string }>;
  /** Optional capability: create a page from a broken-link "Create page" action. */
  onCreatePage?: (title: string) => void | Promise<void>;
  /** Master switch (e.g. disabled in read-only or while loading). Default true. */
  enabled?: boolean;
}

export interface DocumentProcessorResults {
  diagnostics: Diagnostic[];
  actions: Action[];
}

export function useDocumentProcessors({
  editor,
  pageId,
  notebookId,
  pages,
  onCreatePage,
  enabled = true,
}: UseDocumentProcessorsOptions): {
  results: DocumentProcessorResults;
  scheduleRun: () => void;
  runNow: () => void;
} {
  const disabled = useProcessorSettings((s) => s.disabled);
  const [results, setResults] = useState<DocumentProcessorResults>({
    diagnostics: [],
    actions: [],
  });

  // Latest values in refs so the stable callbacks below don't go stale.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const onCreatePageRef = useRef(onCreatePage);
  onCreatePageRef.current = onCreatePage;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const styleElRef = useRef<HTMLStyleElement | null>(null);
  // Signature of the last results we pushed to state, so a debounced run that
  // produces the same diagnostics/actions doesn't re-render the editor. The
  // editor is re-render-sensitive (WebKitGTK), and decorations apply to the
  // DOM directly regardless of this state.
  const resultsSigRef = useRef("");

  // One injected <style> element per editor instance.
  useEffect(() => {
    const el = document.createElement("style");
    el.dataset.docProcessors = pageId ?? "unknown";
    document.head.appendChild(el);
    styleElRef.current = el;
    return () => {
      el.remove();
      styleElRef.current = null;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      abortRef.current?.abort();
    };
  }, [pageId]);

  const applyDecorations = useCallback(
    (decorations: Decoration[]) => {
      const el = styleElRef.current;
      if (!el) return;
      el.textContent = buildDecorationCss(decorations, pageId);
    },
    [pageId],
  );

  const runNow = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // If processors are off entirely, clear any prior decorations/results.
    if (!enabledRef.current) {
      applyDecorations([]);
      setResults({ diagnostics: [], actions: [] });
      return;
    }

    const active = getDocumentProcessors().filter((p) =>
      isProcessorEnabled(p, disabledRef.current),
    );
    if (active.length === 0) {
      applyDecorations([]);
      setResults({ diagnostics: [], actions: [] });
      return;
    }

    // Supersede any in-flight async run.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let blocks: ReadonlyArray<AnyBlock> = [];
    try {
      const doc = editorRef.current.document;
      if (Array.isArray(doc)) blocks = doc as AnyBlock[];
    } catch {
      return;
    }

    const inlines: InlineRef[] = [];
    collectInlines(blocks, inlines);

    const ctx: ProcessorContext = {
      pageId,
      notebookId,
      blocks,
      inlines,
      text: buildText(inlines),
      resolvePageByTitle: buildTitleResolver(pagesRef.current),
      createPage: onCreatePageRef.current,
      signal: controller.signal,
    };

    const mergedDecorations: Decoration[] = [];
    const mergedDiagnostics: Diagnostic[] = [];
    const mergedActions: Action[] = [];

    Promise.all(
      active.map(async (processor) => {
        try {
          const result = await processor.process(ctx);
          if (controller.signal.aborted) return;
          if (result.decorations) mergedDecorations.push(...result.decorations);
          if (result.diagnostics) mergedDiagnostics.push(...result.diagnostics);
          if (result.actions) mergedActions.push(...result.actions);
        } catch (e) {
          console.error(`Document processor "${processor.id}" failed:`, e);
        }
      }),
    ).then(() => {
      if (controller.signal.aborted) return;
      applyDecorations(mergedDecorations);
      const sig = `${mergedDiagnostics.length}:${mergedActions.length}`;
      if (sig !== resultsSigRef.current) {
        resultsSigRef.current = sig;
        setResults({ diagnostics: mergedDiagnostics, actions: mergedActions });
      }
    });
  }, [pageId, notebookId, applyDecorations]);

  // Debounced "edit" trigger. Uses the smallest declared debounce so any
  // edit-triggered processor gets a timely run; per-processor debounce
  // refinement is a future optimization.
  const debounceMs = useMemo(() => {
    const vals = getDocumentProcessors()
      .filter((p) => p.triggers.includes("edit"))
      .map((p) => p.debounceMs ?? 350);
    return vals.length ? Math.min(...vals) : 350;
  }, []);

  const scheduleRun = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(runNow, debounceMs);
  }, [runNow, debounceMs]);

  // "index" trigger: re-run when the page set, enabled flags, or editor change.
  useEffect(() => {
    runNow();
  }, [runNow, pages, disabled, enabled]);

  return { results, scheduleRun, runNow };
}
