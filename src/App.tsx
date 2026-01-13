import { useState, useCallback } from "react";
import { Layout } from "./components/Layout/Layout";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { GraphView } from "./components/Graph/GraphView";
import { AIChatPanel } from "./components/AI";
import { WebResearchPanel } from "./components/WebResearch";
import { SettingsDialog } from "./components/Settings";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useAppInit } from "./hooks/useAppInit";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNotebookStore } from "./stores/notebookStore";
import { usePageStore } from "./stores/pageStore";
import { exportPageToFile } from "./utils/api";
import { save } from "@tauri-apps/plugin-dialog";

function App() {
  useAppInit();

  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showWebResearch, setShowWebResearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"ai" | "web-research">("ai");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { selectedNotebookId, createNotebook } = useNotebookStore();
  const { pages, selectedPageId, createPage, selectPage, deletePage, duplicatePage } = usePageStore();

  // Get the selected page
  const selectedPage = pages.find((p) => p.id === selectedPageId);

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

  const handleOpenSettings = useCallback((tab?: "ai" | "web-research") => {
    if (tab) setSettingsTab(tab);
    setShowSettings(true);
  }, []);

  // Export current page to markdown
  const handleExportPage = useCallback(async () => {
    if (!selectedPage || !selectedNotebookId) return;

    const suggestedName = selectedPage.title?.replace(/[/\\?%*:|"<>]/g, "-") || "page";
    const path = await save({
      defaultPath: `${suggestedName}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) {
      await exportPageToFile(selectedNotebookId, selectedPage.id, path);
    }
  }, [selectedPage, selectedNotebookId]);

  // Duplicate current page
  const handleDuplicatePage = useCallback(() => {
    if (!selectedPage || !selectedNotebookId) return;
    duplicatePage(selectedNotebookId, selectedPage.id);
  }, [selectedPage, selectedNotebookId, duplicatePage]);

  // Delete current page (shows confirmation first)
  const handleDeletePage = useCallback(() => {
    if (!selectedPage) return;
    setShowDeleteConfirm(true);
  }, [selectedPage]);

  // Confirm delete
  const handleConfirmDelete = useCallback(() => {
    if (!selectedPage || !selectedNotebookId) return;
    deletePage(selectedNotebookId, selectedPage.id);
    setShowDeleteConfirm(false);
  }, [selectedPage, selectedNotebookId, deletePage]);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    onCommandPalette: () => setShowCommandPalette(true),
    onNewPage: handleNewPage,
    onNewNotebook: handleNewNotebook,
    onGraph: () => setShowGraph(true),
    onAI: () => setShowAI((prev) => !prev),
    onWebResearch: () => setShowWebResearch((prev) => !prev),
    onSettings: () => setShowSettings((prev) => !prev),
    onExportPage: handleExportPage,
    onDuplicatePage: handleDuplicatePage,
    onDeletePage: handleDeletePage,
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

      {/* AI Chat Panel */}
      <AIChatPanel
        isOpen={showAI}
        onClose={() => setShowAI(false)}
        onOpenSettings={() => handleOpenSettings("ai")}
      />

      {/* Web Research Panel */}
      <WebResearchPanel
        isOpen={showWebResearch}
        onClose={() => setShowWebResearch(false)}
        onOpenSettings={() => handleOpenSettings("web-research")}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        initialTab={settingsTab}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Page"
        message={`Are you sure you want to delete "${selectedPage?.title || "this page"}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}

export default App;
