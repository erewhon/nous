import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Page } from "../../types/page";
import { usePageStore } from "../../stores/pageStore";
import type {
  DatabaseContentV2,
  DatabaseView,
  PropertyType,
  DatabaseSort,
  DatabaseFilter,
  RollupConfig,
  FormulaConfig,
} from "../../types/database";
import {
  migrateDatabaseContent,
  createDefaultDatabaseContent,
} from "../../types/database";
import { DatabaseTable } from "./DatabaseTable";
import { DatabaseToolbar } from "./DatabaseToolbar";
import { DatabaseViewTabs } from "./DatabaseViewTabs";
import { DatabaseList } from "./DatabaseList";
import { DatabaseBoard } from "./DatabaseBoard";
import { DatabaseGallery } from "./DatabaseGallery";
import { DatabaseCalendar } from "./DatabaseCalendar";
import { useRelationContext } from "./useRelationContext";
import * as api from "../../utils/api";
import "./database-styles.css";

interface DatabaseEditorProps {
  // File-based mode (full-page database)
  page?: Page;
  notebookId?: string;
  // Inline mode (embedded in Editor.js block)
  initialContent?: DatabaseContentV2;
  onContentChange?: (content: DatabaseContentV2) => void;
  // Shared
  className?: string;
  compact?: boolean;
}

export function DatabaseEditor({
  page,
  notebookId,
  initialContent,
  onContentChange,
  className,
  compact,
}: DatabaseEditorProps) {
  const isInlineMode = !!initialContent;
  const [content, setContent] = useState<DatabaseContentV2 | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load content
  useEffect(() => {
    if (isInlineMode) {
      // Inline mode: content comes from props, no API loading
      setContent(initialContent!);
      setActiveViewId(initialContent!.views[0]?.id ?? null);
      setIsLoading(false);
      return;
    }
    if (!notebookId || !page) return;
    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.getFileContent(notebookId, page.id);
        if (result.content) {
          const parsed = migrateDatabaseContent(JSON.parse(result.content));
          setContent(parsed);
          setActiveViewId(parsed.views[0]?.id ?? null);
        } else {
          const defaultContent = createDefaultDatabaseContent();
          setContent(defaultContent);
          setActiveViewId(defaultContent.views[0]?.id ?? null);
        }
      } catch (err) {
        if (
          String(err).includes("not found") ||
          String(err).includes("empty")
        ) {
          const defaultContent = createDefaultDatabaseContent();
          setContent(defaultContent);
          setActiveViewId(defaultContent.views[0]?.id ?? null);
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to load database"
          );
        }
      } finally {
        setIsLoading(false);
      }
    };
    loadContent();
  }, [isInlineMode, initialContent, notebookId, page]);

  // Debounced save
  const saveContent = useCallback(
    async (newContent: DatabaseContentV2) => {
      if (isInlineMode) {
        // Inline mode: notify parent directly, no debouncing
        onContentChange?.(newContent);
        return;
      }
      if (!notebookId || !page) return;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          await api.updateFileContent(
            notebookId,
            page.id,
            JSON.stringify(newContent, null, 2)
          );
          setLastSaved(new Date());
        } catch (err) {
          console.error("Failed to save database:", err);
        } finally {
          setIsSaving(false);
        }
      }, 800);
    },
    [isInlineMode, onContentChange, notebookId, page]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Content updater
  const handleUpdateContent = useCallback(
    (updater: (prev: DatabaseContentV2) => DatabaseContentV2) => {
      setContent((prev) => {
        if (!prev) return prev;
        const updated = updater(prev);
        saveContent(updated);
        return updated;
      });
    },
    [saveContent]
  );

  // View updater
  const handleUpdateView = useCallback(
    (updater: (prev: DatabaseView) => DatabaseView) => {
      handleUpdateContent((prev) => ({
        ...prev,
        views: prev.views.map((v) => (v.id === activeViewId ? updater(v) : v)),
      }));
    },
    [handleUpdateContent, activeViewId]
  );

  // Add property — supports relation (with bidirectional setup) and rollup
  const handleAddProperty = useCallback(
    async (
      name: string,
      type: PropertyType,
      relationConfig?: { databasePageId: string },
      rollupConfig?: RollupConfig,
      formulaConfig?: FormulaConfig
    ) => {
      if (type === "relation" && relationConfig && notebookId && page) {
        // Bidirectional: create forward property in this DB, then back-relation in target DB
        const forwardPropId = crypto.randomUUID();
        const backPropId = crypto.randomUUID();

        // 1. Create forward property with backRelationPropertyId
        handleUpdateContent((prev) => ({
          ...prev,
          properties: [
            ...prev.properties,
            {
              id: forwardPropId,
              name,
              type: "relation" as const,
              relationConfig: {
                databasePageId: relationConfig.databasePageId,
                backRelationPropertyId: backPropId,
                direction: "forward" as const,
              },
            },
          ],
        }));

        // 2. Load target DB and add back-relation property
        try {
          const result = await api.getFileContent(
            notebookId,
            relationConfig.databasePageId
          );
          if (result.content) {
            const targetContent = migrateDatabaseContent(
              JSON.parse(result.content)
            );
            const thisDbTitle = page.title || "Untitled";
            const updatedTarget: DatabaseContentV2 = {
              ...targetContent,
              properties: [
                ...targetContent.properties,
                {
                  id: backPropId,
                  name: thisDbTitle,
                  type: "relation" as const,
                  relationConfig: {
                    databasePageId: page.id,
                    backRelationPropertyId: forwardPropId,
                    direction: "back" as const,
                  },
                },
              ],
            };
            await api.updateFileContent(
              notebookId,
              relationConfig.databasePageId,
              JSON.stringify(updatedTarget, null, 2)
            );
          }
        } catch (err) {
          console.error("Failed to create back-relation:", err);
        }
      } else if (type === "rollup" && rollupConfig) {
        handleUpdateContent((prev) => ({
          ...prev,
          properties: [
            ...prev.properties,
            {
              id: crypto.randomUUID(),
              name,
              type: "rollup" as const,
              rollupConfig,
            },
          ],
        }));
      } else if (type === "formula" && formulaConfig) {
        handleUpdateContent((prev) => ({
          ...prev,
          properties: [
            ...prev.properties,
            {
              id: crypto.randomUUID(),
              name,
              type: "formula" as const,
              formulaConfig,
            },
          ],
        }));
      } else {
        handleUpdateContent((prev) => ({
          ...prev,
          properties: [
            ...prev.properties,
            {
              id: crypto.randomUUID(),
              name,
              type,
              ...(relationConfig ? { relationConfig } : {}),
            },
          ],
        }));
      }
    },
    [handleUpdateContent, notebookId, page]
  );

  // Delete property — handles bidirectional cleanup for relations
  const handleDeleteProperty = useCallback(
    async (propertyId: string) => {
      if (!content) return;
      const prop = content.properties.find((p) => p.id === propertyId);

      // If it's a back-relation, don't allow direct deletion
      if (prop?.relationConfig?.direction === "back") {
        alert(
          "This is a back-relation. Delete the source relation in the other database instead."
        );
        return;
      }

      // If forward relation with a back-relation counterpart, remove the back-relation from the target DB
      if (
        prop?.type === "relation" &&
        prop.relationConfig?.backRelationPropertyId &&
        notebookId
      ) {
        try {
          const targetPageId = prop.relationConfig.databasePageId;
          const backPropId = prop.relationConfig.backRelationPropertyId;
          const result = await api.getFileContent(notebookId, targetPageId);
          if (result.content) {
            const targetContent = migrateDatabaseContent(
              JSON.parse(result.content)
            );
            const updatedTarget: DatabaseContentV2 = {
              ...targetContent,
              properties: targetContent.properties.filter(
                (p) => p.id !== backPropId
              ),
            };
            await api.updateFileContent(
              notebookId,
              targetPageId,
              JSON.stringify(updatedTarget, null, 2)
            );
          }
        } catch (err) {
          console.error("Failed to remove back-relation from target DB:", err);
        }
      }

      handleUpdateContent((prev) => ({
        ...prev,
        properties: prev.properties.filter((p) => p.id !== propertyId),
        rows: prev.rows.map((r) => {
          const cells = { ...r.cells };
          delete cells[propertyId];
          return { ...r, cells };
        }),
        views: prev.views.map((v) => ({
          ...v,
          sorts: v.sorts.filter((s) => s.propertyId !== propertyId),
          filters: v.filters.filter((f) => f.propertyId !== propertyId),
        })),
      }));
    },
    [content, notebookId, handleUpdateContent]
  );

  // Update sorts on active view
  const handleUpdateSorts = useCallback(
    (sorts: DatabaseSort[]) => {
      handleUpdateView((prev) => ({ ...prev, sorts }));
    },
    [handleUpdateView]
  );

  // Update filters on active view
  const handleUpdateFilters = useCallback(
    (filters: DatabaseFilter[]) => {
      handleUpdateView((prev) => ({ ...prev, filters }));
    },
    [handleUpdateView]
  );

  // Hooks must be called before any conditional returns
  const relationContext = useRelationContext(notebookId, page?.id, content);

  // Get list of database pages for relation property picker
  const allPages = usePageStore((s) => s.pages);
  const databasePages = allPages.filter(
    (p) => p.pageType === "database" && p.id !== page?.id
  );

  // Lightweight page list for pageLink columns
  const pageLinkPages = useMemo(
    () => allPages.map((p) => ({ id: p.id, title: p.title })),
    [allPages]
  );

  const onNavigatePageLink = useCallback((pageId: string) => {
    usePageStore.getState().selectPage(pageId);
  }, []);

  if (isLoading) {
    return (
      <div className={`db-loading ${className ?? ""}`}>
        <div className="db-loading-spinner" />
        <span>Loading database...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`db-error ${className ?? ""}`}>
        <span>Error: {error}</span>
      </div>
    );
  }

  if (!content) return null;

  const activeView =
    content.views.find((v) => v.id === activeViewId) ?? content.views[0];
  if (!activeView) return null;

  const renderActiveView = () => {
    switch (activeView.type) {
      case "table":
        return (
          <DatabaseTable
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
            relationContext={relationContext}
            pageLinkPages={pageLinkPages}
            onNavigatePageLink={onNavigatePageLink}
          />
        );
      case "list":
        return (
          <DatabaseList
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
            relationContext={relationContext}
            pageLinkPages={pageLinkPages}
            onNavigatePageLink={onNavigatePageLink}
          />
        );
      case "board":
        return (
          <DatabaseBoard
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
            relationContext={relationContext}
            pageLinkPages={pageLinkPages}
            onNavigatePageLink={onNavigatePageLink}
          />
        );
      case "gallery":
        return (
          <DatabaseGallery
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
            relationContext={relationContext}
            pageLinkPages={pageLinkPages}
            onNavigatePageLink={onNavigatePageLink}
          />
        );
      case "calendar":
        return (
          <DatabaseCalendar
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
            relationContext={relationContext}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className={`db-editor ${compact ? "db-editor-compact" : ""} ${className ?? ""}`}>
      {!isInlineMode && (
        <div className="db-save-indicator">
          {isSaving && <span className="db-saving">Saving...</span>}
          {!isSaving && lastSaved && (
            <span className="db-saved">
              Saved at {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
      <DatabaseViewTabs
        views={content.views}
        activeViewId={activeView.id}
        properties={content.properties}
        onSelectView={setActiveViewId}
        onUpdateContent={handleUpdateContent}
      />
      <DatabaseToolbar
        properties={content.properties}
        view={activeView}
        rows={content.rows}
        rowCount={content.rows.length}
        title={page?.title}
        onAddProperty={handleAddProperty}
        onUpdateSorts={handleUpdateSorts}
        onUpdateFilters={handleUpdateFilters}
        onUpdateView={handleUpdateView}
        databasePages={databasePages}
        targetContents={relationContext.targetContents}
        onDeleteProperty={handleDeleteProperty}
        pageLinkPages={pageLinkPages}
        computedValues={relationContext.formulaValues}
      />
      {renderActiveView()}
    </div>
  );
}
