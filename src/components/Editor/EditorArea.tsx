import { useMemo, useCallback, useState, useEffect } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import { PageList } from "./PageList";
import { BlockEditor } from "./BlockEditor";
import { PageHeader } from "./PageHeader";
import { BacklinksPanel } from "./BacklinksPanel";
import type { EditorData } from "../../types/page";
import "./editor-styles.css";

export function EditorArea() {
  const { selectedNotebookId, notebooks } = useNotebookStore();
  const { pages, selectedPageId, selectPage, updatePageContent } =
    usePageStore();
  const { updatePageLinks, buildLinksFromPages } = useLinkStore();
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const selectedNotebook = notebooks.find((n) => n.id === selectedNotebookId);
  const notebookPages = pages.filter(
    (p) => p.notebookId === selectedNotebookId
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

  // Handle wiki link clicks - navigate to page by title
  const handleLinkClick = useCallback(
    (pageTitle: string) => {
      const targetPage = notebookPages.find(
        (p) => p.title.toLowerCase() === pageTitle.toLowerCase()
      );
      if (targetPage) {
        selectPage(targetPage.id);
      }
    },
    [notebookPages, selectPage]
  );

  if (!selectedNotebook) {
    return (
      <div className="flex h-full items-center justify-center bg-[--color-bg-primary]">
        <div className="text-center">
          <div className="mb-4 text-6xl opacity-20">📓</div>
          <h2 className="mb-2 text-xl text-[--color-text-primary]">
            Welcome to Katt
          </h2>
          <p className="text-[--color-text-muted]">
            Select a notebook or create a new one to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Page list panel */}
      <div className="w-56 flex-shrink-0 border-r border-[--color-border] bg-[--color-bg-secondary]">
        <PageList
          pages={notebookPages}
          selectedPageId={selectedPageId}
          onSelectPage={selectPage}
          notebookId={selectedNotebook.id}
        />
      </div>

      {/* Editor panel */}
      <div className="flex flex-1 flex-col overflow-hidden bg-[--color-bg-primary]">
        {selectedPage ? (
          <>
            <PageHeader
              page={selectedPage}
              isSaving={isSaving}
              lastSaved={lastSaved}
            />
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <BlockEditor
                key={selectedPage.id}
                initialData={editorData}
                onSave={handleSave}
                onLinkClick={handleLinkClick}
                className="min-h-[calc(100vh-300px)]"
              />

              {/* Backlinks panel */}
              <BacklinksPanel
                pageTitle={selectedPage.title}
                notebookId={selectedNotebook.id}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-4xl opacity-20">📄</div>
              <p className="text-[--color-text-muted]">
                Select a page or create a new one
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
