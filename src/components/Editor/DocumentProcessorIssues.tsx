/**
 * Generic surfacing for document-processor results — the user-facing half of the
 * contribution point's diagnostics + actions. Renders a small collapsible chip
 * in the corner of the editor (outside the contenteditable, so it's WebKitGTK-
 * safe and never fights the editor's render). Any processor's diagnostics and
 * quick-fix actions show here; the broken-wiki-link "Create page" action is the
 * first consumer.
 */
import { useState } from "react";
import type { Severity } from "../../plugin-sdk/document-processor";
import type { DocumentProcessorResults } from "./useDocumentProcessors";

function severityIcon(s: Severity): string {
  switch (s) {
    case "error":
      return "⛔";
    case "warning":
      return "⚠";
    case "hint":
      return "💡";
    default:
      return "ℹ";
  }
}

export function DocumentProcessorIssues({
  results,
}: {
  results: DocumentProcessorResults;
}) {
  const [expanded, setExpanded] = useState(false);
  const { diagnostics, actions } = results;
  const count = diagnostics.length || actions.length;
  if (count === 0) return null;

  const label = `${count} ${count === 1 ? "suggestion" : "suggestions"}`;

  return (
    <div className="absolute bottom-3 right-3 z-40 max-w-xs text-left">
      {expanded ? (
        <div
          className="rounded-lg border p-3 space-y-2 shadow-md"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {label}
            </span>
            <button
              onClick={() => setExpanded(false)}
              className="text-xs leading-none px-1"
              style={{ color: "var(--color-text-muted)" }}
              title="Collapse suggestions"
              aria-label="Collapse suggestions"
            >
              ×
            </button>
          </div>

          {diagnostics.length > 0 && (
            <ul className="space-y-1">
              {diagnostics.map((d, i) => (
                <li
                  key={`${d.source}:${i}`}
                  className="text-xs flex gap-1.5"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <span aria-hidden>{severityIcon(d.severity)}</span>
                  <span>{d.message}</span>
                </li>
              ))}
            </ul>
          )}

          {actions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {actions.map((a) => (
                <button
                  key={a.id}
                  onClick={() => void a.run()}
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{
                    backgroundColor: "var(--color-accent, #3b82f6)",
                    color: "#fff",
                  }}
                >
                  {a.title}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="rounded-full border px-2.5 py-1 text-xs flex items-center gap-1.5 shadow-sm transition-colors"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
          title="Show document suggestions"
        >
          <span aria-hidden>⚠</span>
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}
