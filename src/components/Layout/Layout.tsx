import { useCallback, useRef, useEffect, useState } from "react";
import { Sidebar } from "../Sidebar/Sidebar";
import { SidebarRail, type RailSection } from "../Sidebar/SidebarRail";
import { SidebarAccordionPanel } from "../Sidebar/SidebarAccordionPanel";
import { StudySidebar } from "../Sidebar/StudySidebar";
import { EditorArea } from "../Editor/EditorArea";
import { OverviewLayout } from "./OverviewLayout";
import { ResizeHandle } from "./ResizeHandle";
import { useThemeStore } from "../../stores/themeStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { useIsPhone } from "../../hooks/useIsPhone";
import { useMobileBackStack } from "../../hooks/useMobileBackStack";
import { MobileNav, MobileDrawer } from "../Mobile";

// Phone shell: single full-screen pane + bottom nav + navigation drawer.
// Split out so the desktop Layout's hooks don't run on phones and vice
// versa (see Forge "Spec: Nous Mobile Web Experience").
function MobileLayout() {
  useMobileBackStack();
  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden relative">
      <main className="flex-1 overflow-hidden">
        <EditorArea />
      </main>
      <MobileNav />
      <MobileDrawer />
    </div>
  );
}

export function Layout() {
  const isPhone = useIsPhone();
  const uiMode = useThemeStore((state) => state.uiMode);
  const sidebarMode = useThemeStore((state) => state.sidebarMode);
  const panelWidths = useThemeStore((state) => state.panelWidths);
  const setPanelWidth = useThemeStore((state) => state.setPanelWidth);
  const autoHidePanels = useThemeStore((state) => state.autoHidePanels);
  const panelsHovered = useThemeStore((state) => state.panelsHovered);
  const setPanelsHovered = useThemeStore((state) => state.setPanelsHovered);
  const zenMode = useThemeStore((state) => state.zenMode);

  const { notebooks, selectedNotebookId } = useNotebookStore();
  const selectedNotebook = notebooks.find((n) => n.id === selectedNotebookId);

  // Rail mode state
  const [railActiveSection, setRailActiveSection] = useState<RailSection>(null);

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

  // Phone breakpoint: single-pane shell with drawer + bottom nav.
  if (isPhone) {
    return <MobileLayout />;
  }

  // Overview mode: full-width layout without sidebar
  if (uiMode === "overview") {
    return (
      <div className="flex h-screen w-screen overflow-hidden">
        <OverviewLayout />
      </div>
    );
  }

  // Calculate sidebar visibility (hidden in zen mode)
  const sidebarVisible = !zenMode && (!autoHidePanels || panelsHovered);
  const sidebarWidth = sidebarVisible ? panelWidths.sidebar : 0;

  // Rail mode
  if (sidebarMode === "rail") {
    const railVisible = !zenMode && (!autoHidePanels || panelsHovered);

    return (
      <div className="flex h-screen w-screen overflow-hidden relative">
        {/* Hover zone for auto-hide in rail mode */}
        {autoHidePanels && !panelsHovered && !zenMode && (
          <div
            className="absolute left-0 top-0 h-full z-50"
            style={{ width: "8px", cursor: "pointer" }}
            onMouseEnter={handleHoverZoneEnter}
          >
            <div
              className="h-full w-1 transition-opacity hover:opacity-100"
              style={{ backgroundColor: "var(--color-accent)", opacity: 0.3 }}
            />
          </div>
        )}

        {/* Rail + Accordion container */}
        <div
          ref={sidebarRef}
          className="flex flex-shrink-0 overflow-hidden h-full"
          style={{
            width: railVisible ? (railActiveSection ? `${48 + panelWidths.sidebar}px` : "48px") : "0px",
            transition: autoHidePanels ? "width 0.2s ease-in-out" : "none",
          }}
          onMouseEnter={handleSidebarEnter}
          onMouseLeave={handleSidebarLeave}
          onTransitionEnd={handleTransitionEnd}
        >
          {(railVisible || sidebarTransitioning) && (
            <div className="flex h-full" style={{ width: railActiveSection ? `${48 + panelWidths.sidebar}px` : "48px" }}>
              <SidebarRail
                activeSection={railActiveSection}
                onSectionClick={setRailActiveSection}
                sectionsEnabled={selectedNotebook?.sectionsEnabled ?? false}
              />
              {railActiveSection && (
                <SidebarAccordionPanel activeSection={railActiveSection} />
              )}
            </div>
          )}
        </div>

        <main className="flex-1 overflow-hidden">
          <EditorArea />
        </main>
      </div>
    );
  }

  // Classic mode: sidebar + editor
  return (
    <div className="flex h-screen w-screen overflow-hidden relative">
      {/* Hover zone for auto-hide (only when panels are hidden, not in zen mode) */}
      {autoHidePanels && !panelsHovered && !zenMode && (
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
        className="flex-shrink-0 overflow-hidden h-full"
        style={{
          width: `${sidebarWidth}px`,
          transition: autoHidePanels ? "width 0.2s ease-in-out" : "none",
        }}
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={handleSidebarLeave}
        onTransitionEnd={handleTransitionEnd}
      >
        {/* Keep sidebar rendered but control visibility for smooth transitions.
            "study" reuses the classic full-mode width/resize plumbing. */}
        {(sidebarVisible || sidebarTransitioning) && (
          <div style={{ width: `${panelWidths.sidebar}px`, height: "100%" }}>
            {sidebarMode === "study" ? (
              <StudySidebar width={panelWidths.sidebar} />
            ) : (
              <Sidebar width={panelWidths.sidebar} />
            )}
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
