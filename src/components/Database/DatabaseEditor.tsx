import { useState, useEffect, useCallback, useRef } from "react";
import type { Page } from "../../types/page";
import type {
  DatabaseContentV2,
  DatabaseView,
  PropertyType,
  DatabaseSort,
  DatabaseFilter,
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
import * as api from "../../utils/api";
import "./database-styles.css";

interface DatabaseEditorProps {
  page: Page;
  notebookId: string;
  className?: string;
}

export function DatabaseEditor({
  page,
  notebookId,
  className,
}: DatabaseEditorProps) {
  const [content, setContent] = useState<DatabaseContentV2 | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load content
  useEffect(() => {
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
  }, [notebookId, page.id]);

  // Debounced save
  const saveContent = useCallback(
    async (newContent: DatabaseContentV2) => {
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
    [notebookId, page.id]
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

  // Add property
  const handleAddProperty = useCallback(
    (name: string, type: PropertyType) => {
      handleUpdateContent((prev) => ({
        ...prev,
        properties: [
          ...prev.properties,
          { id: crypto.randomUUID(), name, type },
        ],
      }));
    },
    [handleUpdateContent]
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
          />
        );
      case "list":
        return (
          <DatabaseList
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
          />
        );
      case "board":
        return (
          <DatabaseBoard
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
          />
        );
      case "gallery":
        return (
          <DatabaseGallery
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
          />
        );
      case "calendar":
        return (
          <DatabaseCalendar
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className={`db-editor ${className ?? ""}`}>
      <div className="db-save-indicator">
        {isSaving && <span className="db-saving">Saving...</span>}
        {!isSaving && lastSaved && (
          <span className="db-saved">
            Saved at {lastSaved.toLocaleTimeString()}
          </span>
        )}
      </div>
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
        rowCount={content.rows.length}
        onAddProperty={handleAddProperty}
        onUpdateSorts={handleUpdateSorts}
        onUpdateFilters={handleUpdateFilters}
        onUpdateView={handleUpdateView}
      />
      {renderActiveView()}
    </div>
  );
}
