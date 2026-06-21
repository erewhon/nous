import type { VimCommandLineState } from "./vim/vimExCommands";

interface VimCommandLineProps {
  state: VimCommandLineState | null;
}

/**
 * Floating vim command line (noice-style): a `:` prompt bar pinned to the
 * bottom of the editor, with a completion dropdown above it. Rendered from
 * vimStore state; the ProseMirror plugin owns the keystroke logic.
 */
export function VimCommandLine({ state }: VimCommandLineProps) {
  if (!state) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-3">
      <div
        className="w-full max-w-2xl overflow-hidden rounded-lg border font-mono text-sm shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
      >
        {state.completions.length > 0 && (
          <div
            className="max-h-48 overflow-y-auto border-b py-1"
            style={{ borderColor: "var(--color-border)" }}
          >
            {state.completions.map((c, i) => (
              <div
                key={c.name}
                className="flex items-center justify-between gap-4 px-3 py-1"
                style={{
                  backgroundColor:
                    i === state.completionIndex
                      ? "var(--color-accent)"
                      : "transparent",
                  color:
                    i === state.completionIndex
                      ? "#ffffff"
                      : "var(--color-text-secondary)",
                }}
              >
                <span className="font-semibold">:{c.name}</span>
                <span
                  className="truncate text-xs"
                  style={{
                    color:
                      i === state.completionIndex
                        ? "rgba(255,255,255,0.8)"
                        : "var(--color-text-muted)",
                  }}
                >
                  {c.description}
                </span>
              </div>
            ))}
          </div>
        )}
        <div
          className="flex items-center px-3 py-2"
          style={{ color: "var(--color-text-primary)" }}
        >
          <span
            className="mr-0.5 select-none"
            style={{ color: "var(--color-accent)" }}
          >
            :
          </span>
          <span className="whitespace-pre">{state.buffer}</span>
          {/* Block cursor */}
          <span
            className="ml-px inline-block w-[2px] animate-pulse self-stretch"
            style={{ backgroundColor: "var(--color-text-primary)" }}
          />
        </div>
      </div>
    </div>
  );
}
