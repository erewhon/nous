import { useCallback, useRef, useEffect, useState } from "react";
import { Sidebar } from "../Sidebar/Sidebar";
import { EditorArea } from "../Editor/EditorArea";
import { OverviewLayout } from "./OverviewLayout";
import { ResizeHandle } from "./ResizeHandle";
import { useThemeStore } from "../../stores/themeStore";

export function Layout() {
  const uiMode = useThemeStore((state) => state.uiMode);
  const panelWidths = useThemeStore((state) => state.panelWidths);
  const setPanelWidth = useThemeStore((state) => state.setPanelWidth);
  const autoHidePanels = useThemeStore((state) => state.autoHidePanels);
  const panelsHovered = useThemeStore((state) => state.panelsHovered);
  const setPanelsHovered = useThemeStore((state) => state.setPanelsHovered);

  const [sidebarTransitioning, setSidebarTransitioning] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleSidebarResize = useCallback(
    (delta: number) => {
      setPanelWidth("sidebar", panelWidths.sidebar + delta);
    },
    [panelWidths.sidebar, setPanelWidth]
  );

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Handle hover zone mouse enter
  const handleHoverZoneEnter = useCallback(() => {
    if (!autoHidePanels) return;

    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    setSidebarTransitioning(true);
    setPanelsHovered(true);
  }, [autoHidePanels, setPanelsHovered]);

  // Handle sidebar mouse leave
  const handleSidebarLeave = useCallback(() => {
    if (!autoHidePanels) return;

    // Add small delay before hiding to prevent flickering
    hideTimeoutRef.current = window.setTimeout(() => {
      setPanelsHovered(false);
      setSidebarTransitioning(true);
    }, 300);
  }, [autoHidePanels, setPanelsHovered]);

  // Handle sidebar mouse enter (cancel hide timeout)
  const handleSidebarEnter = useCallback(() => {
    if (!autoHidePanels) return;

    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, [autoHidePanels]);

  // Handle transition end
  const handleTransitionEnd = useCallback(() => {
    setSidebarTransitioning(false);
  }, []);

  // Keyboard shortcut to toggle panels visibility (Cmd/Ctrl + \)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        if (autoHidePanels) {
          setPanelsHovered(!panelsHovered);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [autoHidePanels, panelsHovered, setPanelsHovered]);

  // Overview mode: full-width layout without sidebar
  if (uiMode === "overview") {
    return (
      <div className="flex h-screen w-screen overflow-hidden">
        <OverviewLayout />
      </div>
    );
  }

  // Calculate sidebar visibility
  const sidebarVisible = !autoHidePanels || panelsHovered;
  const sidebarWidth = sidebarVisible ? panelWidths.sidebar : 0;

  // Classic mode: sidebar + editor
  return (
    <div className="flex h-screen w-screen overflow-hidden relative">
      {/* Hover zone for auto-hide (only when panels are hidden) */}
      {autoHidePanels && !panelsHovered && (
        <div
          className="absolute left-0 top-0 h-full z-50"
          style={{
            width: "8px",
            cursor: "pointer",
          }}
          onMouseEnter={handleHoverZoneEnter}
        >
          {/* Visual indicator */}
          <div
            className="h-full w-1 transition-opacity hover:opacity-100"
            style={{
              backgroundColor: "var(--color-accent)",
              opacity: 0.3,
            }}
          />
        </div>
      )}

      {/* Sidebar container with transition */}
      <div
        ref={sidebarRef}
        className="flex-shrink-0 overflow-hidden"
        style={{
          width: `${sidebarWidth}px`,
          transition: autoHidePanels ? "width 0.2s ease-in-out" : "none",
        }}
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={handleSidebarLeave}
        onTransitionEnd={handleTransitionEnd}
      >
        {/* Keep sidebar rendered but control visibility for smooth transitions */}
        {(sidebarVisible || sidebarTransitioning) && (
          <div style={{ width: `${panelWidths.sidebar}px` }}>
            <Sidebar width={panelWidths.sidebar} />
          </div>
        )}
      </div>

      {/* Only show resize handle when sidebar is visible and not in auto-hide mode */}
      {!autoHidePanels && (
        <ResizeHandle direction="horizontal" onResize={handleSidebarResize} />
      )}

      <main className="flex-1 overflow-hidden">
        <EditorArea />
      </main>
    </div>
  );
}
