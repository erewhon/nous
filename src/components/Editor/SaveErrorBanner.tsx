import { usePageStore } from "../../stores/pageStore";

/**
 * Persistent banner shown when the most recent page-content save failed, so a
 * failed or timed-out save is never silent (DL-22/24/25). The edit itself is
 * kept dirty and retried in the background by the editor; this just makes the
 * failure visible so the user knows their changes aren't on disk yet.
 */
export function SaveErrorBanner() {
  const saveError = usePageStore((s) => s.saveError);
  const clearSaveError = usePageStore((s) => s.clearSaveError);

  if (!saveError) return null;

  return (
    <div
      role="alert"
      className="fixed left-1/2 top-3 z-[1000] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-red-400/40 bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
    >
      <span className="font-medium">Changes not saved — retrying.</span>
      <span className="truncate text-white/80">{saveError}</span>
      <button
        type="button"
        onClick={clearSaveError}
        className="ml-1 shrink-0 rounded px-1.5 text-white/80 hover:bg-white/20 hover:text-white"
        aria-label="Dismiss save error"
      >
        ✕
      </button>
    </div>
  );
}
