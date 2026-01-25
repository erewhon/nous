import { memo } from "react";

interface LinkedFileChangedBannerProps {
  /** Callback when user clicks reload */
  onReload: () => void;
  /** Callback when user dismisses the banner */
  onDismiss: () => void;
  /** Whether reload is in progress */
  isReloading?: boolean;
  /** File name to display (optional) */
  fileName?: string;
}

/**
 * Banner shown when a linked file has been modified externally.
 */
export const LinkedFileChangedBanner = memo(function LinkedFileChangedBanner({
  onReload,
  onDismiss,
  isReloading = false,
  fileName,
}: LinkedFileChangedBannerProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
      style={{
        backgroundColor: "rgba(251, 191, 36, 0.15)",
        borderBottom: "1px solid rgba(251, 191, 36, 0.3)",
        color: "var(--color-text-primary)",
      }}
    >
      <div className="flex items-center gap-2">
        {/* Warning icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "rgb(251, 191, 36)" }}
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>
          {fileName ? (
            <>
              <strong>{fileName}</strong> has been modified externally.
            </>
          ) : (
            "This file has been modified externally."
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onReload}
          disabled={isReloading}
          className="flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "rgb(251, 191, 36)",
            color: "rgb(0, 0, 0)",
            opacity: isReloading ? 0.6 : 1,
          }}
        >
          {isReloading ? (
            <>
              <svg
                className="animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Reloading...
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              Reload
            </>
          )}
        </button>
        <button
          onClick={onDismiss}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-black/10"
          title="Dismiss"
          style={{ color: "var(--color-text-muted)" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
});
