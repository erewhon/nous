/**
 * Applies plugin-provided decorations (highlights, badges) to editor blocks
 * via CSS injection — no DOM mutation inside contenteditable.
 *
 * Follows the same pattern as useHeaderCollapse: a <style> tag in <head>
 * with attribute selectors targeting [data-id] on block containers.
 */
import { useEffect, useRef, useCallback } from "react";
import { usePluginStore } from "../../stores/pluginStore";

interface Decoration {
  block_id: string;
  type: "highlight" | "badge";
  // highlight fields
  background_color?: string;
  border_color?: string;
  border_width?: number;
  // badge fields
  label?: string;
  badge_color?: string;
  badge_bg?: string;
  position?: "top-right" | "top-left";
}

interface BlockInput {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
}

export function usePluginDecorations({
  enabled,
  blocks,
}: {
  enabled: boolean;
  blocks: BlockInput[];
}) {
  const decorationTypes = usePluginStore((s) => s.decorationTypes);
  const fetchDecorationTypes = usePluginStore((s) => s.fetchDecorationTypes);
  const computeDecorations = usePluginStore((s) => s.computeDecorations);

  const styleRef = useRef<HTMLStyleElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlockHashRef = useRef<string>("");

  // Fetch decoration types once
  useEffect(() => {
    if (enabled) {
      fetchDecorationTypes();
    }
  }, [enabled, fetchDecorationTypes]);

  // Ensure style element exists
  useEffect(() => {
    if (!enabled) return;

    if (!styleRef.current) {
      const style = document.createElement("style");
      style.setAttribute("data-plugin-decorations", "true");
      document.head.appendChild(style);
      styleRef.current = style;
    }

    return () => {
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
    };
  }, [enabled]);

  const applyDecorations = useCallback(
    async (blockData: BlockInput[]) => {
      if (!enabled || decorationTypes.length === 0 || !styleRef.current) return;

      // Collect decorations from all plugins
      const allDecorations: Decoration[] = [];

      for (const dt of decorationTypes) {
        try {
          const result = (await computeDecorations(
            dt.pluginId,
            dt.decorationId,
            blockData
          )) as { decorations?: Decoration[] } | null;
          if (result?.decorations) {
            allDecorations.push(...result.decorations);
          }
        } catch (e) {
          console.error(
            `Plugin decoration '${dt.decorationId}' failed:`,
            e
          );
        }
      }

      // Build CSS rules
      const rules: string[] = [];

      for (const d of allDecorations) {
        const sel = `[data-node-type="blockContainer"][data-id="${CSS.escape(d.block_id)}"]`;

        if (d.type === "highlight") {
          const bg = d.background_color || "transparent";
          const border = d.border_color
            ? `border-left: ${d.border_width || 3}px solid ${d.border_color};`
            : "";
          rules.push(`${sel} > .bn-block-content { background: ${bg}; ${border} border-radius: 2px; transition: background 0.3s; }`);
        }

        if (d.type === "badge" && d.label) {
          const pos = d.position || "top-right";
          const color = d.badge_color || "#888";
          const bg = d.badge_bg || "rgba(255,255,255,0.06)";
          const posCSS =
            pos === "top-left"
              ? "left: 4px; right: auto;"
              : "right: 4px; left: auto;";
          rules.push(
            `${sel} { position: relative; }`,
            `${sel}::after { content: "${d.label.replace(/"/g, '\\"')}"; position: absolute; top: 2px; ${posCSS} font-size: 9px; padding: 1px 5px; border-radius: 3px; background: ${bg}; color: ${color}; pointer-events: none; z-index: 1; line-height: 1.4; }`
          );
        }
      }

      styleRef.current.textContent = rules.join("\n");
    },
    [enabled, decorationTypes, computeDecorations]
  );

  // Debounced recompute on block changes
  useEffect(() => {
    if (!enabled || decorationTypes.length === 0) {
      if (styleRef.current) {
        styleRef.current.textContent = "";
      }
      return;
    }

    // Simple hash to avoid recomputing when blocks haven't changed
    const hash = blocks
      .map((b) => `${b.id}:${b.type}:${JSON.stringify(b.props || {}).length}`)
      .join("|");
    if (hash === lastBlockHashRef.current) return;
    lastBlockHashRef.current = hash;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      applyDecorations(blocks);
    }, 1500);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [enabled, blocks, decorationTypes, applyDecorations]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}
