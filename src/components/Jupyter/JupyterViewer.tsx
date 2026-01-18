import { useState, useEffect, useMemo } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import type { Page } from "../../types/page";
import {
  JupyterNotebookSchema,
  type JupyterNotebook,
  type JupyterCell,
  type JupyterOutput,
  normalizeSource,
} from "../../types/jupyter";
import * as api from "../../utils/api";
import { useThemeStore } from "../../stores/themeStore";

interface JupyterViewerProps {
  page: Page;
  notebookId: string;
  className?: string;
}

export function JupyterViewer({ page, notebookId, className = "" }: JupyterViewerProps) {
  const [notebook, setNotebook] = useState<JupyterNotebook | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedCells, setCollapsedCells] = useState<Set<number>>(new Set());
  const resolvedMode = useThemeStore((state) => state.resolvedMode);
  const isDark = resolvedMode === "dark";

  // Load notebook content
  useEffect(() => {
    const loadNotebook = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.getFileContent(notebookId, page.id);
        const parsed = JSON.parse(result.content);
        const validated = JupyterNotebookSchema.parse(parsed);
        setNotebook(validated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load notebook");
        console.error("Failed to load Jupyter notebook:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadNotebook();
  }, [notebookId, page.id]);

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
        </div>
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
      </div>

      {/* Notebook content */}
      <div
        className="flex-1 overflow-auto p-4"
        style={{ backgroundColor: isDark ? "#1a1a1a" : "#fafafa" }}
      >
        <div className="max-w-4xl mx-auto space-y-4">
          {notebook.cells.map((cell, index) => (
            <CellRenderer
              key={index}
              cell={cell}
              index={index}
              language={language}
              isCollapsed={collapsedCells.has(index)}
              onToggle={() => toggleCell(index)}
              isDark={isDark}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface CellRendererProps {
  cell: JupyterCell;
  index: number;
  language: string;
  isCollapsed: boolean;
  onToggle: () => void;
  isDark: boolean;
}

function CellRenderer({ cell, index: _index, language, isCollapsed, onToggle, isDark }: CellRendererProps) {
  const source = normalizeSource(cell.source);

  if (cell.cell_type === "markdown") {
    return (
      <div
        className="rounded-lg border overflow-hidden"
        style={{
          backgroundColor: isDark ? "#262626" : "#ffffff",
          borderColor: isDark ? "#333" : "#e5e5e5",
        }}
      >
        <div
          className="px-4 py-2 text-sm prose prose-sm max-w-none dark:prose-invert"
          style={{ color: "var(--color-text-primary)" }}
          dangerouslySetInnerHTML={{ __html: simpleMarkdown(source) }}
        />
      </div>
    );
  }

  if (cell.cell_type === "code") {
    const executionCount = cell.execution_count;
    const outputs = cell.outputs || [];

    return (
      <div
        className="rounded-lg border overflow-hidden"
        style={{
          backgroundColor: isDark ? "#262626" : "#ffffff",
          borderColor: isDark ? "#333" : "#e5e5e5",
        }}
      >
        {/* Cell header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b cursor-pointer"
          style={{
            backgroundColor: isDark ? "#1f1f1f" : "#f5f5f5",
            borderColor: isDark ? "#333" : "#e5e5e5",
          }}
          onClick={onToggle}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-mono"
              style={{ color: isDark ? "#888" : "#666", minWidth: "40px" }}
            >
              [{executionCount ?? " "}]
            </span>
            <span
              className="text-xs"
              style={{ color: isDark ? "#888" : "#666" }}
            >
              Code
            </span>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isDark ? "#888" : "#666"}
            strokeWidth="2"
            style={{
              transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* Cell content */}
        {!isCollapsed && (
          <>
            {/* Code */}
            <div className="overflow-x-auto">
              <pre
                className="p-3 text-sm font-mono"
                style={{
                  backgroundColor: isDark ? "#1e1e1e" : "#f8f8f8",
                  margin: 0,
                }}
              >
                <code
                  dangerouslySetInnerHTML={{
                    __html: highlightCode(source, language),
                  }}
                />
              </pre>
            </div>

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
      className="rounded-lg border overflow-hidden"
      style={{
        backgroundColor: isDark ? "#262626" : "#ffffff",
        borderColor: isDark ? "#333" : "#e5e5e5",
      }}
    >
      <pre
        className="p-3 text-sm font-mono"
        style={{
          color: isDark ? "#888" : "#666",
          margin: 0,
        }}
      >
        {source}
      </pre>
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

// Simple markdown to HTML conversion (basic support)
function simpleMarkdown(text: string): string {
  return text
    // Headers
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    // Code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>")
    // Wrap in paragraph
    .replace(/^(.*)$/s, "<p>$1</p>");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
