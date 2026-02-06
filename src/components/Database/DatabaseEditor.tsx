import { useState, useEffect, useCallback, useRef } from "react";
import type { Page } from "../../types/page";
import type {
  DatabaseContent,
  PropertyType,
  DatabaseSort,
  DatabaseFilter,
} from "../../types/database";
import { DatabaseContentSchema, createDefaultDatabaseContent } from "../../types/database";
import { DatabaseTable } from "./DatabaseTable";
import { DatabaseToolbar } from "./DatabaseToolbar";
import * as api from "../../utils/api";
import "./database-styles.css";

interface DatabaseEditorProps {
  page: Page;
  notebookId: string;
  className?: string;
}

export function DatabaseEditor({ page, notebookId, className }: DatabaseEditorProps) {
  const [content, setContent] = useState<DatabaseContent | null>(null);
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
          const parsed = DatabaseContentSchema.parse(JSON.parse(result.content));
          setContent(parsed);
        } else {
          setContent(createDefaultDatabaseContent());
        }
      } catch (err) {
        // If file not found or empty, create default content
        if (String(err).includes("not found") || String(err).includes("empty")) {
          setContent(createDefaultDatabaseContent());
        } else {
          setError(err instanceof Error ? err.message : "Failed to load database");
        }
      } finally {
        setIsLoading(false);
      }
    };
    loadContent();
  }, [notebookId, page.id]);

  // Debounced save
  const saveContent = useCallback(
    async (newContent: DatabaseContent) => {
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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Content updater
  const handleUpdateContent = useCallback(
    (updater: (prev: DatabaseContent) => DatabaseContent) => {
      setContent((prev) => {
        if (!prev) return prev;
        const updated = updater(prev);
        saveContent(updated);
        return updated;
      });
    },
    [saveContent]
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

  // Update sorts
  const handleUpdateSorts = useCallback(
    (sorts: DatabaseSort[]) => {
      handleUpdateContent((prev) => ({ ...prev, sorts }));
    },
    [handleUpdateContent]
  );

  // Update filters
  const handleUpdateFilters = useCallback(
    (filters: DatabaseFilter[]) => {
      handleUpdateContent((prev) => ({ ...prev, filters }));
    },
    [handleUpdateContent]
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
      <DatabaseToolbar
        properties={content.properties}
        sorts={content.sorts}
        filters={content.filters}
        rowCount={content.rows.length}
        onAddProperty={handleAddProperty}
        onUpdateSorts={handleUpdateSorts}
        onUpdateFilters={handleUpdateFilters}
      />
      <DatabaseTable content={content} onUpdateContent={handleUpdateContent} />
    </div>
  );
}
