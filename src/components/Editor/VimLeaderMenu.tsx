import { leaderKeyLabel, type VimLeaderState } from "./vim/vimLeader";

interface VimLeaderMenuProps {
  state: VimLeaderState | null;
}

/**
 * which-key-style popup for the vim `<leader>` (Space) menu. Lists the leader
 * bindings; the next keypress runs one. Rendered from vimStore state — the
 * ProseMirror plugin owns the keystroke logic.
 */
export function VimLeaderMenu({ state }: VimLeaderMenuProps) {
  if (!state) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-3">
      <div
        className="w-full max-w-md overflow-hidden rounded-lg border font-mono text-sm shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div
          className="border-b px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          Leader
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {state.bindings.map((b) => (
            <div
              key={b.key}
              className="flex items-center gap-3 px-3 py-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <kbd
                className="rounded px-1.5 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-accent)",
                  minWidth: "1.5rem",
                  textAlign: "center",
                }}
              >
                {leaderKeyLabel(b.key)}
              </kbd>
              <span>{b.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
