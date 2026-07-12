/**
 * Daemon (Lua) decorations as a document processor.
 *
 * Replaces usePluginDecorations: instead of a parallel hook with its own
 * debounce and CSS applier, daemon plugins declaring `editor_decoration:`
 * hooks (e.g. writing_analysis) run through the same host as frontend
 * processors — one merge, one CSS applier, one settings toggle. The wire
 * shape converged already (`DaemonDecoration` → `fromDaemonDecoration`).
 *
 * This is a host-side bridge, not an SDK builtin: it needs the Tauri invoke
 * channel, which only the desktop shell provides. On the web build the
 * invokes fail and the processor quietly returns no decorations.
 */
import { invoke } from "../../platform/core";
import {
  fromDaemonDecoration,
  type DaemonDecoration,
  type Decoration,
  type DocumentProcessor,
} from "../../plugin-sdk/document-processor";

interface PluginDecorationType {
  pluginId: string;
  decorationId: string;
  label: string;
  description?: string;
}

let decorationTypes: PluginDecorationType[] | null = null;

async function getDecorationTypes(): Promise<PluginDecorationType[]> {
  if (decorationTypes === null) {
    try {
      decorationTypes = await invoke<PluginDecorationType[]>(
        "get_plugin_decoration_types",
      );
    } catch {
      // Not running under the desktop shell (or plugins disabled).
      decorationTypes = [];
    }
  }
  return decorationTypes;
}

export const daemonDecorationsProcessor: DocumentProcessor = {
  id: "nous.daemon-decorations",
  title: "Plugin decorations (Lua)",
  runtime: "daemon",
  view: "block",
  triggers: ["edit", "index"],
  // The old usePluginDecorations debounced 1500ms; keep that pacing so
  // typing doesn't hammer the Lua VM.
  debounceMs: 1500,
  process: async (ctx) => {
    const types = await getDecorationTypes();
    if (types.length === 0 || ctx.signal.aborted) return {};

    const decorations: Decoration[] = [];
    for (const dt of types) {
      if (ctx.signal.aborted) return {};
      try {
        const result = await invoke<{ decorations?: DaemonDecoration[] } | null>(
          "compute_plugin_decorations",
          {
            pluginId: dt.pluginId,
            decorationId: dt.decorationId,
            blocks: ctx.blocks,
          },
        );
        for (const d of result?.decorations ?? []) {
          const normalized = fromDaemonDecoration(d);
          if (normalized) decorations.push(normalized);
        }
      } catch (e) {
        console.error(`Daemon decoration '${dt.decorationId}' failed:`, e);
      }
    }
    return { decorations };
  },
};
