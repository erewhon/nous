import { useState, useCallback } from "react";
import { Layout } from "./components/Layout/Layout";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { GraphView } from "./components/Graph/GraphView";
import { useAppInit } from "./hooks/useAppInit";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNotebookStore } from "./stores/notebookStore";
import { usePageStore } from "./stores/pageStore";

function App() {
  useAppInit();

  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showGraph, setShowGraph] = useState(false);

  const { selectedNotebookId, createNotebook } = useNotebookStore();
  const { createPage, selectPage } = usePageStore();

  const handleNewPage = useCallback(() => {
    if (selectedNotebookId) {
      createPage(selectedNotebookId, "Untitled");
    }
  }, [selectedNotebookId, createPage]);

  const handleNewNotebook = useCallback(() => {
    createNotebook("New Notebook");
  }, [createNotebook]);

  const handleGraphNodeClick = useCallback(
    (pageId: string) => {
      selectPage(pageId);
      setShowGraph(false);
    },
    [selectPage]
  );

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    onCommandPalette: () => setShowCommandPalette(true),
    onNewPage: handleNewPage,
    onNewNotebook: handleNewNotebook,
    onGraph: () => setShowGraph(true),
  });

  return (
    <>
      <Layout />

      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onOpenGraph={() => setShowGraph(true)}
      />

      {/* Graph View */}
      {showGraph && (
        <GraphView
          onClose={() => setShowGraph(false)}
          onNodeClick={handleGraphNodeClick}
        />
      )}
    </>
  );
}

export default App;
