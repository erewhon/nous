import { Sidebar } from "../Sidebar/Sidebar";
import { EditorArea } from "../Editor/EditorArea";
import { OverviewLayout } from "./OverviewLayout";
import { useThemeStore } from "../../stores/themeStore";

export function Layout() {
  const uiMode = useThemeStore((state) => state.uiMode);

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
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <EditorArea />
      </main>
    </div>
  );
}
