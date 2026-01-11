import { Sidebar } from "../Sidebar/Sidebar";
import { EditorArea } from "../Editor/EditorArea";

export function Layout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <EditorArea />
      </main>
    </div>
  );
}
