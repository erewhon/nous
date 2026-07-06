import { useEffect } from "react";
import { useMobileStore } from "../../stores/mobileStore";
import { usePageStore } from "../../stores/pageStore";
import { SidebarAccordionPanel } from "../Sidebar";

/**
 * Phone navigation drawer: slide-in overlay hosting the notebooks /
 * sections / pages accordion (the same component rail mode uses), replacing
 * the inline sidebar + panels that are hidden below the phone breakpoint.
 * See Forge "Spec: Nous Mobile Web Experience" §2.
 */
export function MobileDrawer() {
  const drawerOpen = useMobileStore((s) => s.drawerOpen);
  const closeDrawer = useMobileStore((s) => s.closeDrawer);
  const selectedPageId = usePageStore((s) => s.selectedPageId);

  // Selecting a page is the end of a navigation — get out of the way.
  useEffect(() => {
    if (selectedPageId) closeDrawer();
  }, [selectedPageId, closeDrawer]);

  if (!drawerOpen) return null;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-label="Navigation drawer">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={closeDrawer}
      />
      {/* Panel */}
      <div
        className="absolute left-0 top-0 h-full w-[85vw] max-w-[340px] flex flex-col shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 56px)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Browse
          </span>
          <button
            onClick={closeDrawer}
            aria-label="Close drawer"
            className="flex items-center justify-center rounded-lg"
            style={{ width: 44, height: 44, color: "var(--color-text-secondary)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarAccordionPanel activeSection="pages" widthOverride="100%" />
        </div>
      </div>
    </div>
  );
}
