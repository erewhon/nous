import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Page } from "../../types/page";
import {
  daemonEventBus,
  type DaemonEvent,
  type DatabaseEventData,
} from "../../utils/daemonEvents";
import { usePageStore, setPendingSavePromise } from "../../stores/pageStore";
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
import { DatabaseChart } from "./DatabaseChart";
import { DatabaseTimeline } from "./DatabaseTimeline";
import { PluginDatabaseView } from "./PluginDatabaseView";
import { useRelationContext } from "./useRelationContext";
import * as api from "../../utils/api";
import "./database-styles.css";

export interface DatabaseUndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  historyCount: number;
  onUndo: () => void;
  onRedo: () => void;
}

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
  // Undo/redo state callback
  onUndoRedoStateChange?: (state: DatabaseUndoRedoState) => void;
}

export function DatabaseEditor({
  page,
  notebookId,
  initialContent,
  onContentChange,
  className,
  compact,
  onUndoRedoStateChange,
}: DatabaseEditorProps) {
  const isInlineMode = !!initialContent;
  const [content, setContent] = useState<DatabaseContentV2 | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest debounced-but-not-yet-saved content, so unmount can flush it (DL-38).
  const pendingContentRef = useRef<DatabaseContentV2 | null>(null);
  // Row ids this editor has loaded — sent with each save so the daemon can
  // re-attach rows another writer added concurrently rather than letting a
  // stale whole-content save delete them (DL-04 row merge).
  const baselineRowIdsRef = useRef<string[]>([]);
  // Set when an external (MCP/daemon) write lands while we have an unsaved
  // local edit. We don't overwrite the in-progress edit immediately; instead
  // we let the pending save flush (the DL-04 merge reconciles it with the
  // external rows) and then refresh from disk to show the merged result.
  const pendingExternalRefreshRef = useRef(false);
  // Latest `refreshFromDisk` impl, so the debounced save's success branch can
  // call it without a forward reference (it's defined further down).
  const refreshFromDiskRef = useRef<() => void>(() => {});

  // Undo/redo stacks
  const MAX_UNDO = 30;
  const undoStackRef = useRef<DatabaseContentV2[]>([]);
  const redoStackRef = useRef<DatabaseContentV2[]>([]);
  const pendingBaselineRef = useRef<DatabaseContentV2 | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(true);
  const [undoRedoVersion, setUndoRedoVersion] = useState(0);

  // Load content
  useEffect(() => {
    if (isInlineMode) {
      // Inline mode: content comes from props, no API loading
      setContent(initialContent!);
      setActiveViewId(initialContent!.views[0]?.id ?? null);
      setIsLoading(false);
      isLoadingRef.current = false;
      return;
    }
    if (!notebookId || !page) return;
    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.getDatabase(notebookId, page.id);
        const parsed = migrateDatabaseContent(result.database);
        setContent(parsed);
        setActiveViewId(parsed.views[0]?.id ?? null);
        baselineRowIdsRef.current = parsed.rows.map((r) => r.id);
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
        isLoadingRef.current = false;
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
      // Mark this as the latest pending content so unmount can flush it (DL-38).
      pendingContentRef.current = newContent;
      saveTimeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          // DL-04: send the loaded row-id baseline so the daemon re-attaches any
          // concurrently-added rows instead of this snapshot deleting them.
          await api.putDatabase(
            notebookId,
            page.id,
            newContent as unknown as Record<string, unknown>,
            baselineRowIdsRef.current
          );
          pendingContentRef.current = null; // saved
          baselineRowIdsRef.current = newContent.rows.map((r) => r.id);
          setLastSaved(new Date());
          // An external write arrived mid-edit; now that our edit is saved
          // (and merged server-side), pull the merged result onto screen.
          if (pendingExternalRefreshRef.current) {
            pendingExternalRefreshRef.current = false;
            refreshFromDiskRef.current();
          }
        } catch (err) {
          console.error("Failed to save database:", err);
        } finally {
          setIsSaving(false);
        }
      }, 800);
    },
    [isInlineMode, onContentChange, notebookId, page]
  );

  // DL-38: flush a pending debounced save on unmount/navigation instead of
  // dropping it. Kept in a ref so the once-only cleanup sees the latest content
  // and page without stale closures, and registered with the save-before-
  // navigate mechanism so selectPage can await it.
  const flushPendingSaveRef = useRef<() => void>(() => {});
  flushPendingSaveRef.current = () => {
    const pending = pendingContentRef.current;
    if (!pending || !notebookId || !page) return;
    pendingContentRef.current = null;
    const p = api
      .putDatabase(
        notebookId,
        page.id,
        pending as unknown as Record<string, unknown>,
        baselineRowIdsRef.current
      )
      .then(() => {})
      .catch((err) =>
        console.error("Failed to flush database save on unmount:", err)
      );
    setPendingSavePromise(p);
  };

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      flushPendingSaveRef.current();
    };
  }, []);

  // Reload content from disk (e.g., after a plugin or MCP server modifies the database).
  // Cancels any pending debounced save to prevent overwriting the fresh data.
  const refreshFromDisk = useCallback(async () => {
    if (isInlineMode || !notebookId || !page) return;
    // Cancel pending save so stale in-memory content doesn't overwrite fresh disk data
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    try {
      const result = await api.getDatabase(notebookId, page.id);
      const parsed = migrateDatabaseContent(result.database);
      setContent(parsed);
      baselineRowIdsRef.current = parsed.rows.map((r) => r.id);
    } catch (err) {
      console.error("Failed to refresh database from disk:", err);
    }
  }, [isInlineMode, notebookId, page]);

  // Keep the ref the debounced save reads pointed at the latest impl.
  refreshFromDiskRef.current = refreshFromDisk;

  // Live-refresh on external database writes (MCP/daemon row add/update/delete).
  // The daemon broadcasts these on its event bus; the previous code listened for
  // a Tauri `mcp-database-updated` event that nothing ever emitted, so an open
  // table stayed stale until you navigated away and back (Bug 2).
  //
  // We subscribe to the row events specifically — `database.updated` is skipped
  // because the editor emits it for its *own* saves, which would cause a refresh
  // loop. If the user has an unsaved edit in flight we don't clobber it: we mark
  // a pending refresh and let the debounced save flush first, so the DL-04 merge
  // reconciles both sides before we reload.
  useEffect(() => {
    if (isInlineMode || !page) return;
    const unsubscribe = daemonEventBus.subscribe((evt: DaemonEvent) => {
      if (
        evt.event !== "database.rows_added" &&
        evt.event !== "database.rows_updated" &&
        evt.event !== "database.rows_deleted"
      ) {
        return;
      }
      const data = evt.data as DatabaseEventData;
      if (data.pageId !== page.id) return;

      if (pendingContentRef.current) {
        // Unsaved local edit pending — defer so we don't discard it.
        pendingExternalRefreshRef.current = true;
      } else {
        refreshFromDisk();
      }
    });
    return unsubscribe;
  }, [isInlineMode, page, refreshFromDisk]);

  // Flush pending baseline into undo stack
  const flushPendingBaseline = useCallback(() => {
    if (pendingBaselineRef.current) {
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
        pendingBaselineRef.current,
      ];
      redoStackRef.current = [];
      pendingBaselineRef.current = null;
      setUndoRedoVersion((v) => v + 1);
    }
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
  }, []);

  // Content updater — captures undo baselines
  const handleUpdateContent = useCallback(
    (updater: (prev: DatabaseContentV2) => DatabaseContentV2) => {
      setContent((prev) => {
        if (!prev) return prev;
        const updated = updater(prev);

        // Undo snapshot: on first call in a burst, capture `prev` as baseline
        if (!isLoadingRef.current && !pendingBaselineRef.current) {
          pendingBaselineRef.current = structuredClone(prev);
        }
        // Reset the quiet timer — after 800ms of quiet, commit baseline
        if (snapshotTimerRef.current) {
          clearTimeout(snapshotTimerRef.current);
        }
        snapshotTimerRef.current = setTimeout(() => {
          if (pendingBaselineRef.current) {
            undoStackRef.current = [
              ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
              pendingBaselineRef.current,
            ];
            redoStackRef.current = [];
            pendingBaselineRef.current = null;
            setUndoRedoVersion((v) => v + 1);
          }
          snapshotTimerRef.current = null;
        }, 800);

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
            // Row-merge write (DL-04): we only change the target's properties,
            // but this is a whole-content write from a snapshot — pass the rows
            // we read as the baseline so a concurrent writer's added rows are
            // re-attached, not clobbered.
            await api.putDatabase(
              notebookId,
              relationConfig.databasePageId,
              updatedTarget as unknown as Record<string, unknown>,
              targetContent.rows.map((r) => r.id)
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
            // Row-merge write (DL-04): whole-content write from a snapshot, so
            // baseline the rows we read to preserve concurrently-added rows.
            await api.putDatabase(
              notebookId,
              targetPageId,
              updatedTarget as unknown as Record<string, unknown>,
              targetContent.rows.map((r) => r.id)
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

  // Undo handler
  const handleUndo = useCallback(() => {
    flushPendingBaseline();
    if (undoStackRef.current.length === 0) return;
    setContent((prev) => {
      if (!prev) return prev;
      const baseline = undoStackRef.current.pop()!;
      redoStackRef.current.push(structuredClone(prev));
      setUndoRedoVersion((v) => v + 1);
      saveContent(baseline);
      return baseline;
    });
  }, [flushPendingBaseline, saveContent]);

  // Redo handler
  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    setContent((prev) => {
      if (!prev) return prev;
      const redoState = redoStackRef.current.pop()!;
      undoStackRef.current.push(structuredClone(prev));
      setUndoRedoVersion((v) => v + 1);
      saveContent(redoState);
      return redoState;
    });
  }, [saveContent]);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z
  useEffect(() => {
    if (isInlineMode) return; // inline databases don't own keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when focused in input/textarea (native undo handles in-cell editing)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey
      ) {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isInlineMode, handleUndo, handleRedo]);

  // Report undo/redo state to parent
  useEffect(() => {
    onUndoRedoStateChange?.({
      canUndo: undoStackRef.current.length > 0 || pendingBaselineRef.current !== null,
      canRedo: redoStackRef.current.length > 0,
      historyCount: undoStackRef.current.length,
      onUndo: handleUndo,
      onRedo: handleRedo,
    });
  }, [undoRedoVersion, onUndoRedoStateChange, handleUndo, handleRedo]);

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
      case "chart":
        return (
          <DatabaseChart
            content={content}
            view={activeView}
            onUpdateView={handleUpdateView}
          />
        );
      case "timeline":
        return (
          <DatabaseTimeline
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
            relationContext={relationContext}
            pageId={page?.id}
          />
        );
      case "plugin":
        return (
          <PluginDatabaseView
            content={content}
            view={activeView}
            onUpdateContent={handleUpdateContent}
            onUpdateView={handleUpdateView}
            relationContext={relationContext}
            notebookId={notebookId}
            onRefreshFromDisk={refreshFromDisk}
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
