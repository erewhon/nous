import { useCallback } from "react";
import { Sidebar } from "../Sidebar/Sidebar";
import { EditorArea } from "../Editor/EditorArea";
import { OverviewLayout } from "./OverviewLayout";
import { ResizeHandle } from "./ResizeHandle";
import { useThemeStore } from "../../stores/themeStore";

export function Layout() {
  const uiMode = useThemeStore((state) => state.uiMode);
  const panelWidths = useThemeStore((state) => state.panelWidths);
  const setPanelWidth = useThemeStore((state) => state.setPanelWidth);

  const handleSidebarResize = useCallback(
    (delta: number) => {
      setPanelWidth("sidebar", panelWidths.sidebar + delta);
    },
    [panelWidths.sidebar, setPanelWidth]
  );

  // Overview mode: full-width layout without sidebar
  if (uiMode === "overview") {
    return (
      <div className="flex h-screen w-screen overflow-hidden">
        <OverviewLayout />
      </div>
    );
  }

  // Classic mode: sidebar + editor
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar width={panelWidths.sidebar} />
      <ResizeHandle direction="horizontal" onResize={handleSidebarResize} />
      <main className="flex-1 overflow-hidden">
        <EditorArea />
      </main>
    </div>
  );
}
