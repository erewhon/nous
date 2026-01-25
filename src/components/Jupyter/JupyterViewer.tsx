import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import "katex/dist/katex.min.css";
import type { Page } from "../../types/page";
import {
  JupyterNotebookSchema,
  type JupyterNotebook,
  type JupyterCell,
  type JupyterOutput,
  normalizeSource,
} from "../../types/jupyter";
import { useLinkedFileSync } from "../../hooks/useLinkedFileSync";
import { LinkedFileChangedBanner } from "../LinkedFile";
import * as api from "../../utils/api";
import { useThemeStore } from "../../stores/themeStore";

interface JupyterViewerProps {
  page: Page;
  notebookId: string;
  className?: string;
}

export function JupyterViewer({ page, notebookId, className = "" }: JupyterViewerProps) {
  const [notebook, setNotebook] = useState<JupyterNotebook | null>(null);
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedCells, setCollapsedCells] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<number | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [executingCells, setExecutingCells] = useState<Set<number>>(new Set());
  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const resolvedMode = useThemeStore((state) => state.resolvedMode);
  const isDark = resolvedMode === "dark";

  // Linked file sync detection
  const { isModified, dismiss, markSynced } = useLinkedFileSync(page, notebookId);

  // Reload the notebook file
  const handleReload = useCallback(async () => {
    setIsReloading(true);
    try {
      // Mark the file as synced
      await api.markLinkedFileSynced(notebookId, page.id);
      markSynced();
      // Force reload
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to reload Jupyter notebook:", err);
    } finally {
      setIsReloading(false);
    }
  }, [notebookId, page.id, markSynced]);

  // Check Python availability on mount
  useEffect(() => {
    const checkPython = async () => {
      try {
        const info = await api.checkPythonExecutionAvailable();
        setPythonAvailable(info.available);
      } catch {
        setPythonAvailable(false);
      }
    };
    checkPython();
  }, []);

  // Load notebook content
  useEffect(() => {
    const loadNotebook = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.getFileContent(notebookId, page.id);
        setOriginalContent(result.content);
        const parsed = JSON.parse(result.content);
        const validated = JupyterNotebookSchema.parse(parsed);
        setNotebook(validated);
        setHasUnsavedChanges(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load notebook");
        console.error("Failed to load Jupyter notebook:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadNotebook();
  }, [notebookId, page.id, reloadKey]);

  // Get language from notebook metadata
  const language = useMemo(() => {
    if (!notebook) return "python";
    const langInfo = notebook.metadata?.language_info;
    if (langInfo?.name) return langInfo.name;
    const kernelspec = notebook.metadata?.kernelspec;
    if (kernelspec?.language) return kernelspec.language;
    return "python";
  }, [notebook]);

  const toggleCell = (index: number) => {
    setCollapsedCells((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // Save notebook
  const saveNotebook = useCallback(async () => {
    if (!notebook) return;

    setIsSaving(true);
    try {
      // Reconstruct the notebook JSON preserving original structure
      const originalParsed = JSON.parse(originalContent);
      const updatedNotebook = {
        ...originalParsed,
        cells: notebook.cells.map((cell) => ({
          cell_type: cell.cell_type,
          source: cell.source,
          metadata: cell.metadata || {},
          ...(cell.cell_type === "code" ? {
            execution_count: cell.execution_count ?? null,
            outputs: cell.outputs || [],
          } : {}),
        })),
      };

      const content = JSON.stringify(updatedNotebook, null, 1);
      await api.updateFileContent(notebookId, page.id, content);
      setOriginalContent(content);
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error("Failed to save notebook:", err);
      setError(err instanceof Error ? err.message : "Failed to save notebook");
    } finally {
      setIsSaving(false);
    }
  }, [notebook, originalContent, notebookId, page.id]);

  // Revert to last saved state
  const revertChanges = useCallback(() => {
    if (!originalContent) return;

    try {
      const parsed = JSON.parse(originalContent);
      const validated = JupyterNotebookSchema.parse(parsed);
      setNotebook(validated);
      setHasUnsavedChanges(false);
      setEditingCell(null);
    } catch (err) {
      console.error("Failed to revert changes:", err);
    }
  }, [originalContent]);

  // Update cell source
  const updateCellSource = useCallback((index: number, newSource: string) => {
    if (!notebook) return;

    setNotebook((prev) => {
      if (!prev) return prev;
      const newCells = [...prev.cells];
      // Jupyter stores source as lines with trailing newlines preserved
      // Split by newline and add \n back to each line except the last (if it didn't have one)
      const lines = newSource.split("\n");
      const sourceLines = lines.map((line, i) =>
        i < lines.length - 1 ? line + "\n" : line
      );
      newCells[index] = {
        ...newCells[index],
        source: sourceLines,
      };
      return { ...prev, cells: newCells };
    });
    setHasUnsavedChanges(true);
  }, [notebook]);

  // Add new cell
  const addCell = useCallback((afterIndex: number, cellType: "code" | "markdown") => {
    if (!notebook) return;

    const newCell: JupyterCell = cellType === "code"
      ? {
          cell_type: "code" as const,
          source: [],
          metadata: {},
          execution_count: null,
          outputs: [],
        }
      : {
          cell_type: "markdown" as const,
          source: [],
          metadata: {},
        };

    setNotebook((prev) => {
      if (!prev) return prev;
      const newCells = [...prev.cells];
      newCells.splice(afterIndex + 1, 0, newCell);
      return { ...prev, cells: newCells };
    });
    setEditingCell(afterIndex + 1);
    setHasUnsavedChanges(true);
  }, [notebook]);

  // Delete cell
  const deleteCell = useCallback((index: number) => {
    if (!notebook || notebook.cells.length <= 1) return;

    setNotebook((prev) => {
      if (!prev) return prev;
      const newCells = prev.cells.filter((_, i) => i !== index);
      return { ...prev, cells: newCells };
    });

    // Adjust collapsed cells set
    setCollapsedCells((prev) => {
      const newSet = new Set<number>();
      prev.forEach((i) => {
        if (i < index) newSet.add(i);
        else if (i > index) newSet.add(i - 1);
      });
      return newSet;
    });

    if (editingCell === index) {
      setEditingCell(null);
    } else if (editingCell !== null && editingCell > index) {
      setEditingCell(editingCell - 1);
    }

    setHasUnsavedChanges(true);
  }, [notebook, editingCell]);

  // Move cell
  const moveCell = useCallback((index: number, direction: "up" | "down") => {
    if (!notebook) return;

    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= notebook.cells.length) return;

    setNotebook((prev) => {
      if (!prev) return prev;
      const newCells = [...prev.cells];
      [newCells[index], newCells[newIndex]] = [newCells[newIndex], newCells[index]];
      return { ...prev, cells: newCells };
    });

    // Adjust collapsed cells set
    setCollapsedCells((prev) => {
      const newSet = new Set<number>();
      prev.forEach((i) => {
        if (i === index) newSet.add(newIndex);
        else if (i === newIndex) newSet.add(index);
        else newSet.add(i);
      });
      return newSet;
    });

    if (editingCell === index) {
      setEditingCell(newIndex);
    } else if (editingCell === newIndex) {
      setEditingCell(index);
    }

    setHasUnsavedChanges(true);
  }, [notebook, editingCell]);

  // Change cell type
  const changeCellType = useCallback((index: number, newType: "code" | "markdown") => {
    if (!notebook) return;

    setNotebook((prev) => {
      if (!prev) return prev;
      const newCells = [...prev.cells];
      const currentCell = newCells[index];

      const updatedCell: JupyterCell = newType === "code"
        ? {
            cell_type: "code" as const,
            source: currentCell.source,
            metadata: currentCell.metadata || {},
            execution_count: null,
            outputs: [],
          }
        : {
            cell_type: "markdown" as const,
            source: currentCell.source,
            metadata: currentCell.metadata || {},
          };

      newCells[index] = updatedCell;
      return { ...prev, cells: newCells };
    });
    setHasUnsavedChanges(true);
  }, [notebook]);

  // Execute a code cell
  const executeCell = useCallback(async (index: number) => {
    if (!notebook || !pythonAvailable) return;

    const cell = notebook.cells[index];
    if (cell.cell_type !== "code") return;

    const source = normalizeSource(cell.source);
    if (!source.trim()) return;

    setExecutingCells((prev) => new Set(prev).add(index));

    try {
      const result = await api.executeJupyterCell(source, index);

      // Update cell outputs
      setNotebook((prev) => {
        if (!prev) return prev;
        const newCells = [...prev.cells];
        const currentCell = newCells[index];

        if (currentCell.cell_type === "code") {
          // Convert outputs to Jupyter format
          const outputs: JupyterOutput[] = (result.outputs as unknown[]).map((output: unknown) => {
            const o = output as Record<string, unknown>;
            const outputType = (o.output_type as string) || "stream";

            if (outputType === "stream") {
              return {
                output_type: "stream" as const,
                name: (o.name as "stdout" | "stderr") || "stdout",
                text: o.text as string | string[],
              };
            } else if (outputType === "execute_result") {
              return {
                output_type: "execute_result" as const,
                execution_count: (o.execution_count as number | null) ?? null,
                data: o.data as Record<string, string | string[]>,
                metadata: (o.metadata as Record<string, unknown>) || {},
              };
            } else if (outputType === "display_data") {
              return {
                output_type: "display_data" as const,
                data: o.data as Record<string, string | string[]>,
                metadata: (o.metadata as Record<string, unknown>) || {},
              };
            } else if (outputType === "error") {
              return {
                output_type: "error" as const,
                ename: o.ename as string,
                evalue: o.evalue as string,
                traceback: o.traceback as string[],
              };
            }
            // Fallback
            return {
              output_type: "stream" as const,
              name: "stdout" as const,
              text: String(o),
            };
          });

          newCells[index] = {
            ...currentCell,
            outputs,
            execution_count: result.executionCount,
          };
        }

        return { ...prev, cells: newCells };
      });

      setHasUnsavedChanges(true);
    } catch (err) {
      console.error("Failed to execute cell:", err);
      // Add error output
      setNotebook((prev) => {
        if (!prev) return prev;
        const newCells = [...prev.cells];
        const currentCell = newCells[index];

        if (currentCell.cell_type === "code") {
          newCells[index] = {
            ...currentCell,
            outputs: [{
              output_type: "error" as const,
              ename: "ExecutionError",
              evalue: err instanceof Error ? err.message : "Unknown error",
              traceback: [],
            }],
          };
        }

        return { ...prev, cells: newCells };
      });
      setHasUnsavedChanges(true);
    } finally {
      setExecutingCells((prev) => {
        const newSet = new Set(prev);
        newSet.delete(index);
        return newSet;
      });
    }
  }, [notebook, pythonAvailable]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasUnsavedChanges && !isSaving) {
          saveNotebook();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasUnsavedChanges, isSaving, saveNotebook]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span style={{ color: "var(--color-text-muted)" }}>Loading notebook...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-error)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ color: "var(--color-error)" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!notebook) return null;

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Linked file changed banner */}
      {isModified && (
        <LinkedFileChangedBanner
          onReload={handleReload}
          onDismiss={dismiss}
          isReloading={isReloading}
          fileName={page.title}
        />
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--color-warning)" }}
          >
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            {page.title}
          </span>
          {page.storageMode === "linked" && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-muted)",
              }}
            >
              Linked
            </span>
          )}
          {hasUnsavedChanges && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: "var(--color-warning)",
                color: "#000",
              }}
            >
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
            <span>{notebook.cells.length} cells</span>
            <span>|</span>
            <span>{language}</span>
            {notebook.metadata?.kernelspec?.display_name && (
              <>
                <span>|</span>
                <span>{notebook.metadata.kernelspec.display_name}</span>
              </>
            )}
          </div>
          {/* Revert button */}
          {hasUnsavedChanges && (
            <button
              onClick={revertChanges}
              disabled={isSaving}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-muted)",
                cursor: isSaving ? "not-allowed" : "pointer",
              }}
              title="Revert changes"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Revert
            </button>
          )}
          {/* Save button */}
          <button
            onClick={saveNotebook}
            disabled={!hasUnsavedChanges || isSaving}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors"
            style={{
              backgroundColor: hasUnsavedChanges ? "var(--color-accent)" : "var(--color-bg-tertiary)",
              color: hasUnsavedChanges ? "#fff" : "var(--color-text-muted)",
              opacity: !hasUnsavedChanges || isSaving ? 0.5 : 1,
              cursor: !hasUnsavedChanges || isSaving ? "not-allowed" : "pointer",
            }}
            title="Save (Cmd+S)"
          >
            {isSaving ? (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            )}
            Save
          </button>
        </div>
      </div>

      {/* Notebook content */}
      <div
        className="flex-1 overflow-auto p-4"
        style={{ backgroundColor: isDark ? "#1a1a1a" : "#fafafa" }}
      >
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Add cell button at top */}
          <AddCellButton onAdd={(type) => addCell(-1, type)} isDark={isDark} />

          {notebook.cells.map((cell, index) => (
            <div key={index}>
              <CellEditor
                cell={cell}
                index={index}
                language={language}
                isCollapsed={collapsedCells.has(index)}
                isEditing={editingCell === index}
                isExecuting={executingCells.has(index)}
                canExecute={pythonAvailable === true && cell.cell_type === "code"}
                onToggle={() => toggleCell(index)}
                onEdit={() => setEditingCell(index)}
                onStopEdit={() => setEditingCell(null)}
                onUpdateSource={(source) => updateCellSource(index, source)}
                onDelete={() => deleteCell(index)}
                onMoveUp={() => moveCell(index, "up")}
                onMoveDown={() => moveCell(index, "down")}
                onChangeType={(type) => changeCellType(index, type)}
                onExecute={() => executeCell(index)}
                canMoveUp={index > 0}
                canMoveDown={index < notebook.cells.length - 1}
                canDelete={notebook.cells.length > 1}
                isDark={isDark}
              />
              <AddCellButton onAdd={(type) => addCell(index, type)} isDark={isDark} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface AddCellButtonProps {
  onAdd: (type: "code" | "markdown") => void;
  isDark: boolean;
}

function AddCellButton({ onAdd, isDark }: AddCellButtonProps) {
  const [showOptions, setShowOptions] = useState(false);

  return (
    <div
      className="flex justify-center py-1 group"
      onMouseEnter={() => setShowOptions(true)}
      onMouseLeave={() => setShowOptions(false)}
    >
      <div
        className="flex items-center gap-1 transition-opacity"
        style={{ opacity: showOptions ? 1 : 0 }}
      >
        <button
          onClick={() => onAdd("code")}
          className="flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors"
          style={{
            backgroundColor: isDark ? "#333" : "#e5e5e5",
            color: isDark ? "#aaa" : "#666",
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          Code
        </button>
        <button
          onClick={() => onAdd("markdown")}
          className="flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors"
          style={{
            backgroundColor: isDark ? "#333" : "#e5e5e5",
            color: isDark ? "#aaa" : "#666",
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Markdown
        </button>
      </div>
    </div>
  );
}

interface CellEditorProps {
  cell: JupyterCell;
  index: number;
  language: string;
  isCollapsed: boolean;
  isEditing: boolean;
  isExecuting: boolean;
  canExecute: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onStopEdit: () => void;
  onUpdateSource: (source: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeType: (type: "code" | "markdown") => void;
  onExecute: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  isDark: boolean;
}

function CellEditor({
  cell,
  index: _index,
  language,
  isCollapsed,
  isEditing,
  isExecuting,
  canExecute,
  onToggle,
  onEdit,
  onStopEdit,
  onUpdateSource,
  onDelete,
  onMoveUp,
  onMoveDown,
  onChangeType,
  onExecute,
  canMoveUp,
  canMoveDown,
  canDelete,
  isDark,
}: CellEditorProps) {
  const source = normalizeSource(cell.source);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localSource, setLocalSource] = useState(source);

  // Update local source when cell changes
  useEffect(() => {
    setLocalSource(source);
  }, [source]);

  // Focus textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing]);

  // Auto-resize textarea based on content
  const autoResizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get accurate scrollHeight
      textarea.style.height = "auto";
      // Set height to scrollHeight, with minimum
      const minHeight = 80;
      const newHeight = Math.max(textarea.scrollHeight, minHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

  // Resize textarea when editing starts or content changes
  useEffect(() => {
    if (isEditing) {
      // Small delay to ensure textarea is rendered
      setTimeout(autoResizeTextarea, 0);
    }
  }, [isEditing, localSource, autoResizeTextarea]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape to stop editing
    if (e.key === "Escape") {
      onUpdateSource(localSource);
      onStopEdit();
    }
    // Tab for indentation
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = localSource.substring(0, start) + "    " + localSource.substring(end);
        setLocalSource(newValue);
        // Update cursor position after React re-renders
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 4;
        }, 0);
      }
    }
  };

  const handleBlur = () => {
    onUpdateSource(localSource);
    onStopEdit();
  };

  if (cell.cell_type === "markdown") {
    return (
      <div
        className="rounded-lg border overflow-hidden group"
        style={{
          backgroundColor: isDark ? "#262626" : "#ffffff",
          borderColor: isDark ? "#333" : "#e5e5e5",
        }}
      >
        {/* Cell toolbar */}
        <div
          className="flex items-center justify-between px-3 py-1 border-b opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            backgroundColor: isDark ? "#1f1f1f" : "#f5f5f5",
            borderColor: isDark ? "#333" : "#e5e5e5",
          }}
        >
          <div className="flex items-center gap-1">
            <span className="text-xs" style={{ color: isDark ? "#888" : "#666" }}>
              Markdown
            </span>
            <button
              onClick={() => onChangeType("code")}
              className="px-1.5 py-0.5 text-xs rounded hover:bg-opacity-80"
              style={{
                backgroundColor: isDark ? "#333" : "#e5e5e5",
                color: isDark ? "#aaa" : "#666",
              }}
              title="Convert to code"
            >
              → Code
            </button>
          </div>
          <CellActions
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onDelete={onDelete}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            canDelete={canDelete}
            isDark={isDark}
          />
        </div>

        {/* Content */}
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={localSource}
            onChange={(e) => {
              setLocalSource(e.target.value);
              autoResizeTextarea();
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className="w-full p-4 text-sm font-mono resize-none focus:outline-none"
            style={{
              backgroundColor: isDark ? "#262626" : "#ffffff",
              color: isDark ? "#d4d4d4" : "#333",
              minHeight: "100px",
              overflow: "hidden",
            }}
            placeholder="Enter markdown..."
          />
        ) : (
          <div
            className="px-4 py-2 text-sm cursor-text jupyter-markdown"
            style={{ color: "var(--color-text-primary)" }}
            onClick={onEdit}
          >
            {source ? (
              <MarkdownRenderer content={source} isDark={isDark} />
            ) : (
              <em style={{ color: "var(--color-text-muted)" }}>Empty cell - click to edit</em>
            )}
          </div>
        )}
      </div>
    );
  }

  if (cell.cell_type === "code") {
    const executionCount = cell.execution_count;
    const outputs = cell.outputs || [];

    return (
      <div
        className="rounded-lg border overflow-hidden group"
        style={{
          backgroundColor: isDark ? "#262626" : "#ffffff",
          borderColor: isDark ? "#333" : "#e5e5e5",
        }}
      >
        {/* Cell header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b"
          style={{
            backgroundColor: isDark ? "#1f1f1f" : "#f5f5f5",
            borderColor: isDark ? "#333" : "#e5e5e5",
          }}
        >
          <div className="flex items-center gap-2 cursor-pointer" onClick={onToggle}>
            <span
              className="text-xs font-mono"
              style={{ color: isDark ? "#888" : "#666", minWidth: "40px" }}
            >
              [{executionCount ?? " "}]
            </span>
            <span className="text-xs" style={{ color: isDark ? "#888" : "#666" }}>
              Code
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChangeType("markdown");
              }}
              className="px-1.5 py-0.5 text-xs rounded hover:bg-opacity-80 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                backgroundColor: isDark ? "#333" : "#e5e5e5",
                color: isDark ? "#aaa" : "#666",
              }}
              title="Convert to markdown"
            >
              → MD
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Run button */}
            {canExecute && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExecute();
                }}
                disabled={isExecuting}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors"
                style={{
                  backgroundColor: isExecuting ? (isDark ? "#333" : "#e5e5e5") : (isDark ? "#22c55e" : "#16a34a"),
                  color: isExecuting ? (isDark ? "#888" : "#666") : "#fff",
                  cursor: isExecuting ? "not-allowed" : "pointer",
                }}
                title={isExecuting ? "Running..." : "Run cell (Shift+Enter)"}
              >
                {isExecuting ? (
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                )}
                {isExecuting ? "Running" : "Run"}
              </button>
            )}
            <CellActions
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onDelete={onDelete}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              canDelete={canDelete}
              isDark={isDark}
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isDark ? "#888" : "#666"}
              strokeWidth="2"
              className="cursor-pointer"
              onClick={onToggle}
              style={{
                transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {/* Cell content */}
        {!isCollapsed && (
          <>
            {/* Code editor */}
            {isEditing ? (
              <textarea
                ref={textareaRef}
                value={localSource}
                onChange={(e) => {
                  setLocalSource(e.target.value);
                  autoResizeTextarea();
                }}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                className="w-full p-3 text-sm font-mono resize-none focus:outline-none"
                style={{
                  backgroundColor: isDark ? "#1e1e1e" : "#f8f8f8",
                  color: isDark ? "#d4d4d4" : "#333",
                  minHeight: "80px",
                  overflow: "hidden",
                }}
                spellCheck={false}
              />
            ) : (
              <div className="overflow-x-auto cursor-text" onClick={onEdit}>
                <pre
                  className="p-3 text-sm font-mono"
                  style={{
                    backgroundColor: isDark ? "#1e1e1e" : "#f8f8f8",
                    margin: 0,
                    minHeight: "40px",
                  }}
                >
                  {source ? (
                    <code
                      dangerouslySetInnerHTML={{
                        __html: highlightCode(source, language),
                      }}
                    />
                  ) : (
                    <code style={{ color: isDark ? "#666" : "#999" }}>
                      # Click to edit...
                    </code>
                  )}
                </pre>
              </div>
            )}

            {/* Outputs */}
            {outputs.length > 0 && (
              <div
                className="border-t"
                style={{ borderColor: isDark ? "#333" : "#e5e5e5" }}
              >
                {outputs.map((output, i) => (
                  <OutputRenderer key={i} output={output} isDark={isDark} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Raw cell
  return (
    <div
      className="rounded-lg border overflow-hidden group"
      style={{
        backgroundColor: isDark ? "#262626" : "#ffffff",
        borderColor: isDark ? "#333" : "#e5e5e5",
      }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-3 py-1 border-b opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          backgroundColor: isDark ? "#1f1f1f" : "#f5f5f5",
          borderColor: isDark ? "#333" : "#e5e5e5",
        }}
      >
        <span className="text-xs" style={{ color: isDark ? "#888" : "#666" }}>
          Raw
        </span>
        <CellActions
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDelete={onDelete}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          canDelete={canDelete}
          isDark={isDark}
        />
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={localSource}
          onChange={(e) => {
            setLocalSource(e.target.value);
            autoResizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="w-full p-3 text-sm font-mono resize-none focus:outline-none"
          style={{
            backgroundColor: isDark ? "#262626" : "#ffffff",
            color: isDark ? "#888" : "#666",
            minHeight: "60px",
            overflow: "hidden",
          }}
        />
      ) : (
        <pre
          className="p-3 text-sm font-mono cursor-text"
          style={{
            color: isDark ? "#888" : "#666",
            margin: 0,
          }}
          onClick={onEdit}
        >
          {source || "Click to edit..."}
        </pre>
      )}
    </div>
  );
}

interface CellActionsProps {
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  isDark: boolean;
}

function CellActions({ onMoveUp, onMoveDown, onDelete, canMoveUp, canMoveDown, canDelete, isDark }: CellActionsProps) {
  const buttonStyle = {
    backgroundColor: isDark ? "#333" : "#e5e5e5",
    color: isDark ? "#aaa" : "#666",
  };
  const disabledStyle = {
    ...buttonStyle,
    opacity: 0.4,
    cursor: "not-allowed",
  };

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={onMoveUp}
        disabled={!canMoveUp}
        className="p-1 rounded hover:bg-opacity-80"
        style={canMoveUp ? buttonStyle : disabledStyle}
        title="Move up"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      <button
        onClick={onMoveDown}
        disabled={!canMoveDown}
        className="p-1 rounded hover:bg-opacity-80"
        style={canMoveDown ? buttonStyle : disabledStyle}
        title="Move down"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <button
        onClick={onDelete}
        disabled={!canDelete}
        className="p-1 rounded hover:bg-opacity-80"
        style={canDelete ? { ...buttonStyle, color: isDark ? "#f87171" : "#dc2626" } : disabledStyle}
        title="Delete cell"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}

interface OutputRendererProps {
  output: JupyterOutput;
  isDark: boolean;
}

function OutputRenderer({ output, isDark }: OutputRendererProps) {
  if (output.output_type === "stream") {
    const text = Array.isArray(output.text) ? output.text.join("") : output.text;
    const isError = output.name === "stderr";

    return (
      <pre
        className="p-3 text-sm font-mono whitespace-pre-wrap"
        style={{
          backgroundColor: isError
            ? isDark
              ? "#3d1f1f"
              : "#fff0f0"
            : isDark
            ? "#1a1a1a"
            : "#fafafa",
          color: isError
            ? isDark
              ? "#ff8888"
              : "#cc0000"
            : isDark
            ? "#d4d4d4"
            : "#333",
          margin: 0,
        }}
      >
        {text}
      </pre>
    );
  }

  if (output.output_type === "execute_result" || output.output_type === "display_data") {
    const data = output.data;

    // Check for image data
    if (data["image/png"]) {
      const imageData = Array.isArray(data["image/png"])
        ? data["image/png"].join("")
        : data["image/png"];
      return (
        <div className="p-3">
          <img
            src={`data:image/png;base64,${imageData}`}
            alt="Output"
            className="max-w-full"
          />
        </div>
      );
    }

    if (data["image/jpeg"]) {
      const imageData = Array.isArray(data["image/jpeg"])
        ? data["image/jpeg"].join("")
        : data["image/jpeg"];
      return (
        <div className="p-3">
          <img
            src={`data:image/jpeg;base64,${imageData}`}
            alt="Output"
            className="max-w-full"
          />
        </div>
      );
    }

    // Check for HTML
    if (data["text/html"]) {
      const html = Array.isArray(data["text/html"])
        ? data["text/html"].join("")
        : data["text/html"];
      return (
        <div
          className="p-3 overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    // Plain text fallback
    if (data["text/plain"]) {
      const rawText = data["text/plain"];
      const text = Array.isArray(rawText) ? rawText.join("") : String(rawText);
      return (
        <pre
          className="p-3 text-sm font-mono whitespace-pre-wrap"
          style={{
            backgroundColor: isDark ? "#1a1a1a" : "#fafafa",
            color: isDark ? "#d4d4d4" : "#333",
            margin: 0,
          }}
        >
          {text}
        </pre>
      );
    }

    return null;
  }

  if (output.output_type === "error") {
    return (
      <pre
        className="p-3 text-sm font-mono whitespace-pre-wrap"
        style={{
          backgroundColor: isDark ? "#3d1f1f" : "#fff0f0",
          color: isDark ? "#ff8888" : "#cc0000",
          margin: 0,
        }}
      >
        <strong>{output.ename}: </strong>
        {output.evalue}
        {"\n\n"}
        {output.traceback.join("\n").replace(/\x1b\[[0-9;]*m/g, "")}
      </pre>
    );
  }

  return null;
}

// Simple syntax highlighting using highlight.js
function highlightCode(code: string, language: string): string {
  try {
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    return result.value;
  } catch {
    return escapeHtml(code);
  }
}

// Markdown renderer with LaTeX support for Jupyter cells
interface MarkdownRendererProps {
  content: string;
  isDark: boolean;
}

function MarkdownRenderer({ content, isDark }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[rehypeKatex, rehypeRaw]}
      components={{
        // Headers
        h1: ({ children }) => (
          <h1 className="text-2xl font-bold mt-4 mb-2" style={{ color: "var(--color-text-primary)" }}>
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-xl font-bold mt-3 mb-2" style={{ color: "var(--color-text-primary)" }}>
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-lg font-semibold mt-3 mb-1" style={{ color: "var(--color-text-primary)" }}>
            {children}
          </h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-base font-semibold mt-2 mb-1" style={{ color: "var(--color-text-primary)" }}>
            {children}
          </h4>
        ),
        // Paragraphs
        p: ({ children }) => (
          <p className="my-2 leading-relaxed" style={{ color: "var(--color-text-primary)" }}>
            {children}
          </p>
        ),
        // Lists
        ul: ({ children }) => (
          <ul className="list-disc list-inside my-2 space-y-1" style={{ color: "var(--color-text-primary)" }}>
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside my-2 space-y-1" style={{ color: "var(--color-text-primary)" }}>
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="ml-2">{children}</li>
        ),
        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
            style={{ color: "var(--color-accent)" }}
          >
            {children}
          </a>
        ),
        // Code blocks
        code: ({ className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !className;

          if (isInline) {
            return (
              <code
                className="px-1.5 py-0.5 rounded text-sm font-mono"
                style={{
                  backgroundColor: isDark ? "#333" : "#e5e5e5",
                  color: isDark ? "#e5e5e5" : "#333",
                }}
                {...props}
              >
                {children}
              </code>
            );
          }

          const codeString = String(children).replace(/\n$/, "");
          const language = match ? match[1] : "text";

          return (
            <code
              className="block p-3 rounded text-sm font-mono overflow-x-auto"
              style={{
                backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5",
              }}
              dangerouslySetInnerHTML={{
                __html: highlightCode(codeString, language),
              }}
              {...props}
            />
          );
        },
        // Block quotes
        blockquote: ({ children }) => (
          <blockquote
            className="border-l-4 pl-4 my-2 italic"
            style={{
              borderColor: "var(--color-accent)",
              color: "var(--color-text-secondary)",
            }}
          >
            {children}
          </blockquote>
        ),
        // Tables (GFM)
        table: ({ children }) => (
          <div className="overflow-x-auto my-4">
            <table
              className="min-w-full border-collapse"
              style={{ borderColor: "var(--color-border)" }}
            >
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead
            style={{ backgroundColor: isDark ? "#1f1f1f" : "#f5f5f5" }}
          >
            {children}
          </thead>
        ),
        th: ({ children }) => (
          <th
            className="border px-3 py-2 text-left font-semibold"
            style={{ borderColor: "var(--color-border)" }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            className="border px-3 py-2"
            style={{ borderColor: "var(--color-border)" }}
          >
            {children}
          </td>
        ),
        // Horizontal rule
        hr: () => (
          <hr
            className="my-4"
            style={{ borderColor: "var(--color-border)" }}
          />
        ),
        // Images
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt || ""}
            className="max-w-full my-2 rounded"
          />
        ),
        // Task lists (GFM)
        input: ({ checked }) => (
          <input
            type="checkbox"
            checked={checked}
            disabled
            className="mr-2"
          />
        ),
        // Strikethrough
        del: ({ children }) => (
          <del style={{ color: "var(--color-text-muted)" }}>
            {children}
          </del>
        ),
        // Preformatted text
        pre: ({ children }) => (
          <pre
            className="my-2 rounded overflow-x-auto"
            style={{
              backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5",
            }}
          >
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
