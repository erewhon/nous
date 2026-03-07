import { useThemeStore } from "../../stores/themeStore";

const DAYS_THRESHOLD = 3;

/**
 * Subtle banner suggesting Expert Mode after the user has used the app
 * for a few days in beginner mode. Dismissible and non-intrusive.
 */
export function ExpertModeBanner() {
  const expertMode = useThemeStore((s) => s.expertMode);
  const dismissed = useThemeStore((s) => s.expertModeBannerDismissed);
  const usageDaysCount = useThemeStore((s) => s.usageDaysCount);
  const tourCompleted = useThemeStore((s) => s.tourCompleted);
  const setExpertMode = useThemeStore((s) => s.setExpertMode);
  const setDismissed = useThemeStore((s) => s.setExpertModeBannerDismissed);

  // Don't show if already expert, dismissed, tour not completed, or not enough usage
  if (expertMode || dismissed || !tourCompleted || usageDaysCount < DAYS_THRESHOLD) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border p-4 shadow-lg"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      <div
        className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: "rgba(139, 92, 246, 0.15)" }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8" />
        </svg>
      </div>
      <div className="flex-1">
        <div
          className="text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Ready for more?
        </div>
        <div
          className="mt-0.5 text-xs leading-relaxed"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Enable Expert Mode to unlock collaboration, graph view, actions, plugins, and advanced database features.
        </div>
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={() => {
              setExpertMode(true);
              setDismissed(true);
            }}
            className="rounded-md px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Enable Expert Mode
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded-md px-3 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            Not now
          </button>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 rounded p-0.5 transition-colors hover:bg-[--color-bg-tertiary]"
        style={{ color: "var(--color-text-muted)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
