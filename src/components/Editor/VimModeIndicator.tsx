import type { VimMode } from "./useVimMode";

interface VimModeIndicatorProps {
  mode: VimMode;
  pendingKeys?: string;
  className?: string;
}

const MODE_LABELS: Record<VimMode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
};

const MODE_COLORS: Record<VimMode, { bg: string; text: string }> = {
  normal: {
    bg: "var(--color-accent)",
    text: "#ffffff",
  },
  insert: {
    bg: "var(--color-success)",
    text: "#000000",
  },
  visual: {
    bg: "var(--color-warning)",
    text: "#000000",
  },
};

/**
 * Visual indicator for the current VI mode (Normal, Insert, Visual)
 * Displays in the bottom-left corner of the editor
 */
export function VimModeIndicator({
  mode,
  pendingKeys,
  className = "",
}: VimModeIndicatorProps) {
  const colors = MODE_COLORS[mode];

  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1 font-mono text-xs font-bold ${className}`}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    >
      <span>-- {MODE_LABELS[mode]} --</span>
      {pendingKeys && (
        <span
          className="rounded px-1"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.2)",
          }}
        >
          {pendingKeys}
        </span>
      )}
    </div>
  );
}
