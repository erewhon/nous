import { useMemo, useCallback, useState, useEffect } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import { PageList } from "./PageList";
import { BlockEditor } from "./BlockEditor";
import { PageHeader } from "./PageHeader";
import { BacklinksPanel } from "./BacklinksPanel";
import { SimilarPagesPanel } from "./SimilarPagesPanel";
import type { EditorData } from "../../types/page";
import "./editor-styles.css";

export function EditorArea() {
  const { selectedNotebookId, notebooks } = useNotebookStore();
  const { pages, selectedPageId, selectPage, updatePageContent, loadPages, createPage } =
    usePageStore();
  const { updatePageLinks, buildLinksFromPages } = useLinkStore();
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const selectedNotebook = notebooks.find((n) => n.id === selectedNotebookId);

  // Load pages when notebook selection changes
  useEffect(() => {
    if (selectedNotebookId) {
      loadPages(selectedNotebookId);
    }
  }, [selectedNotebookId, loadPages]);

  // Memoize filtered pages to prevent infinite re-renders
  const notebookPages = useMemo(
    () => pages.filter((p) => p.notebookId === selectedNotebookId),
    [pages, selectedNotebookId]
  );
  const selectedPage = pages.find((p) => p.id === selectedPageId);

  // Build links when pages change
  useEffect(() => {
    if (notebookPages.length > 0) {
      buildLinksFromPages(notebookPages);
    }
  }, [notebookPages, buildLinksFromPages]);

  // Convert page content to Editor.js format
  const editorData: OutputData | undefined = useMemo(() => {
    if (!selectedPage?.content) return undefined;
    return {
      time: selectedPage.content.time,
      version: selectedPage.content.version,
      blocks: selectedPage.content.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        data: block.data as Record<string, unknown>,
      })),
    };
  }, [selectedPage?.id, selectedPage?.content]);

  // Handle save
  const handleSave = useCallback(
    async (data: OutputData) => {
      if (!selectedNotebookId || !selectedPageId || !selectedPage) return;

      setIsSaving(true);
      try {
        const editorData: EditorData = {
          time: data.time,
          version: data.version,
          blocks: data.blocks.map((block) => ({
            id: block.id ?? crypto.randomUUID(),
            type: block.type,
            data: block.data as Record<string, unknown>,
          })),
        };

        await updatePageContent(selectedNotebookId, selectedPageId, editorData);

        // Update links after save
        updatePageLinks({
          ...selectedPage,
          content: editorData,
        });

        setLastSaved(new Date());
      } finally {
        setIsSaving(false);
      }
    },
    [
      selectedNotebookId,
      selectedPageId,
      selectedPage,
      updatePageContent,
      updatePageLinks,
    ]
  );

  // Handle wiki link clicks - navigate to page by title, or create if doesn't exist
  const handleLinkClick = useCallback(
    async (pageTitle: string) => {
      let targetPage = notebookPages.find(
        (p) => p.title.toLowerCase() === pageTitle.toLowerCase()
      );

      if (targetPage) {
        selectPage(targetPage.id);
        return;
      }

      // Page doesn't exist - create it
      if (selectedNotebookId) {
        await createPage(selectedNotebookId, pageTitle);
        // After creation, the new page should be selected automatically by createPage
        // and pages will be updated, so we need to find and select it
        // The createPage action sets selectedPageId to the new page
      }
    },
    [notebookPages, selectPage, selectedNotebookId, createPage]
  );

  if (!selectedNotebook) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <div className="text-center max-w-md px-8">
          <div
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg"
            style={{
              background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-tertiary))",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </div>
          <h2
            className="mb-3 text-2xl font-bold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Welcome to Katt
          </h2>
          <p
            className="leading-relaxed"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Your personal notebook for capturing ideas, organizing thoughts, and building knowledge.
          </p>
          <p
            className="mt-4 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Select a notebook from the sidebar or create a new one to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Page list panel */}
      <div
        className="w-64 flex-shrink-0 border-r"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <PageList
          pages={notebookPages}
          selectedPageId={selectedPageId}
          onSelectPage={selectPage}
          notebookId={selectedNotebook.id}
        />
      </div>

      {/* Editor panel */}
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        {selectedPage ? (
          <>
            <PageHeader
              page={selectedPage}
              isSaving={isSaving}
              lastSaved={lastSaved}
            />
            <div className="flex-1 overflow-y-auto px-16 py-10">
              <div className="mx-auto max-w-3xl">
                <BlockEditor
                  key={selectedPage.id}
                  initialData={editorData}
                  onSave={handleSave}
                  onLinkClick={handleLinkClick}
                  notebookId={selectedNotebook.id}
                  pages={notebookPages.map((p) => ({ id: p.id, title: p.title }))}
                  className="min-h-[calc(100vh-300px)]"
                />

                {/* Backlinks panel */}
                <BacklinksPanel
                  pageTitle={selectedPage.title}
                  notebookId={selectedNotebook.id}
                />

                {/* Similar Pages panel (AI-powered) */}
                <SimilarPagesPanel
                  page={selectedPage}
                  notebookId={selectedNotebook.id}
                  allPages={notebookPages}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-sm px-8">
              <div
                className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-xl"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
              </div>
              <p style={{ color: "var(--color-text-secondary)" }}>
                Select a page from the sidebar or create a new one
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
