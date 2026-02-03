import { useState, useEffect } from "react";
import { useExternalSourceStore } from "../../stores/externalSourceStore";
import { useToastStore } from "../../stores/toastStore";
import type {
  ExternalSource,
  ExternalFileFormat,
  ResolvedFileInfo,
} from "../../types/externalSource";
import { EXTERNAL_FILE_FORMATS } from "../../types/externalSource";

export function ExternalSourcesSettings() {
  const {
    sources,
    isLoading,
    error,
    previewFiles,
    isPreviewLoading,
    loadSources,
    createSource,
    updateSource,
    deleteSource,
    loadPreviewFiles,
    previewPathPattern,
    clearPreview,
    clearError,
  } = useExternalSourceStore();

  const toast = useToastStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSource, setEditingSource] = useState<ExternalSource | null>(null);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);

  // Load sources on mount
  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // Show error toast
  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, toast, clearError]);

  const handleAddSource = async (
    name: string,
    pathPattern: string,
    fileFormats: ExternalFileFormat[]
  ) => {
    try {
      await createSource(name, pathPattern, { fileFormats });
      setShowAddForm(false);
      toast.success("External source added");
    } catch (err) {
      // Error already handled by store
    }
  };

  const handleUpdateSource = async (
    sourceId: string,
    name: string,
    pathPattern: string,
    fileFormats: ExternalFileFormat[]
  ) => {
    try {
      await updateSource(sourceId, { name, pathPattern, fileFormats });
      setEditingSource(null);
      toast.success("External source updated");
    } catch (err) {
      // Error already handled by store
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm("Are you sure you want to delete this external source?")) {
      return;
    }
    try {
      await deleteSource(sourceId);
      toast.success("External source deleted");
    } catch (err) {
      // Error already handled by store
    }
  };

  const handleToggleEnabled = async (source: ExternalSource) => {
    try {
      await updateSource(source.id, { enabled: !source.enabled });
    } catch (err) {
      // Error already handled by store
    }
  };

  const handlePreview = async (sourceId: string) => {
    if (expandedSourceId === sourceId) {
      setExpandedSourceId(null);
      clearPreview();
    } else {
      setExpandedSourceId(sourceId);
      await loadPreviewFiles(sourceId);
    }
  };

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Register external file paths as sources that can be processed by Actions
        with AI summarization.
      </p>

      {/* Add Source Button */}
      {!showAddForm && !editingSource && (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
          }}
        >
          <IconPlus size={16} />
          Add External Source
        </button>
      )}

      {/* Add Form */}
      {showAddForm && (
        <SourceForm
          onSubmit={handleAddSource}
          onCancel={() => setShowAddForm(false)}
          onPreview={previewPathPattern}
          previewFiles={previewFiles}
          isPreviewLoading={isPreviewLoading}
          clearPreview={clearPreview}
          isLoading={isLoading}
        />
      )}

      {/* Edit Form */}
      {editingSource && (
        <SourceForm
          source={editingSource}
          onSubmit={(name, pathPattern, fileFormats) =>
            handleUpdateSource(editingSource.id, name, pathPattern, fileFormats)
          }
          onCancel={() => {
            setEditingSource(null);
            clearPreview();
          }}
          onPreview={previewPathPattern}
          previewFiles={previewFiles}
          isPreviewLoading={isPreviewLoading}
          clearPreview={clearPreview}
          isLoading={isLoading}
        />
      )}

      {/* Sources List */}
      {sources.length > 0 && !showAddForm && !editingSource && (
        <div className="space-y-3">
          {sources.map((source) => (
            <div
              key={source.id}
              className="rounded-lg border"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-secondary)",
              }}
            >
              {/* Source Header */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <button
                    onClick={() => handlePreview(source.id)}
                    className="p-1 rounded transition-colors"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {expandedSourceId === source.id ? (
                      <IconChevronDown size={16} />
                    ) : (
                      <IconChevronRight size={16} />
                    )}
                  </button>
                  <IconFolder
                    size={20}
                    style={{
                      color: source.enabled
                        ? "var(--color-accent)"
                        : "var(--color-text-muted)",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="font-medium truncate"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {source.name}
                    </div>
                    <div
                      className="text-xs truncate"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {source.pathPattern}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Format badges */}
                  <div className="flex gap-1">
                    {source.fileFormats.length > 0 ? (
                      source.fileFormats.map((format) => (
                        <span
                          key={format}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {format}
                        </span>
                      ))
                    ) : (
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        all
                      </span>
                    )}
                  </div>
                  {/* Enable/disable toggle */}
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      onChange={() => handleToggleEnabled(source)}
                      className="peer sr-only"
                    />
                    <div
                      className="h-5 w-9 rounded-full"
                      style={{
                        backgroundColor: source.enabled
                          ? "var(--color-accent)"
                          : "var(--color-bg-tertiary)",
                      }}
                    >
                      <span
                        className="absolute left-[2px] top-[2px] h-4 w-4 rounded-full transition-transform"
                        style={{
                          backgroundColor: "white",
                          transform: source.enabled
                            ? "translateX(16px)"
                            : "translateX(0)",
                        }}
                      />
                    </div>
                  </label>
                  {/* Edit button */}
                  <button
                    onClick={() => setEditingSource(source)}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: "var(--color-text-secondary)" }}
                    title="Edit source"
                  >
                    <IconRefresh size={16} />
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteSource(source.id)}
                    className="p-1.5 rounded transition-colors hover:bg-red-500/10"
                    style={{ color: "var(--color-text-secondary)" }}
                    title="Delete source"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>

              {/* Expanded Preview */}
              {expandedSourceId === source.id && (
                <div
                  className="border-t px-4 py-3"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {isPreviewLoading ? (
                    <div
                      className="text-sm text-center py-4"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Loading files...
                    </div>
                  ) : previewFiles.length > 0 ? (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      <div
                        className="text-xs mb-2"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {previewFiles.length} file(s) matched
                      </div>
                      {previewFiles.map((file) => (
                        <FilePreviewItem key={file.path} file={file} />
                      ))}
                    </div>
                  ) : (
                    <div
                      className="text-sm text-center py-4"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      No files matched
                    </div>
                  )}
                </div>
              )}

              {/* Last processed info */}
              {source.lastProcessed && (
                <div
                  className="border-t px-4 py-2 text-xs"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  Last processed:{" "}
                  {new Date(source.lastProcessed).toLocaleString()}
                  {source.processedFiles.length > 0 && (
                    <span> ({source.processedFiles.length} files)</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {sources.length === 0 && !showAddForm && !isLoading && (
        <div
          className="text-center py-8 rounded-lg border"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
          }}
        >
          <IconFolder
            size={48}
            className="mx-auto mb-3"
            style={{ color: "var(--color-text-muted)" }}
          />
          <p
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            No external sources configured
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: "var(--color-text-muted)" }}
          >
            Add sources to process external files with Actions
          </p>
        </div>
      )}
    </div>
  );
}

// Source Form Component
function SourceForm({
  source,
  onSubmit,
  onCancel,
  onPreview,
  previewFiles,
  isPreviewLoading,
  clearPreview,
  isLoading,
}: {
  source?: ExternalSource;
  onSubmit: (
    name: string,
    pathPattern: string,
    fileFormats: ExternalFileFormat[]
  ) => void;
  onCancel: () => void;
  onPreview: (
    pathPattern: string,
    fileFormats?: ExternalFileFormat[]
  ) => Promise<ResolvedFileInfo[]>;
  previewFiles: ResolvedFileInfo[];
  isPreviewLoading: boolean;
  clearPreview: () => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState(source?.name || "");
  const [pathPattern, setPathPattern] = useState(source?.pathPattern || "");
  const [fileFormats, setFileFormats] = useState<ExternalFileFormat[]>(
    source?.fileFormats || []
  );
  const [showPreview, setShowPreview] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !pathPattern.trim()) return;
    onSubmit(name.trim(), pathPattern.trim(), fileFormats);
  };

  const handlePreview = async () => {
    if (!pathPattern.trim()) return;
    setShowPreview(true);
    await onPreview(pathPattern.trim(), fileFormats.length > 0 ? fileFormats : undefined);
  };

  const handleFormatToggle = (format: ExternalFileFormat) => {
    setFileFormats((prev) =>
      prev.includes(format)
        ? prev.filter((f) => f !== format)
        : [...prev, format]
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border p-4"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
      }}
    >
      <div className="flex items-center justify-between">
        <h4
          className="font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          {source ? "Edit External Source" : "Add External Source"}
        </h4>
        <button
          type="button"
          onClick={() => {
            onCancel();
            clearPreview();
          }}
          className="p-1 rounded transition-colors"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <IconX size={16} />
        </button>
      </div>

      {/* Name */}
      <div>
        <label
          className="block text-sm mb-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Research Notes"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
          }}
          required
        />
      </div>

      {/* Path Pattern */}
      <div>
        <label
          className="block text-sm mb-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Path Pattern
        </label>
        <input
          type="text"
          value={pathPattern}
          onChange={(e) => setPathPattern(e.target.value)}
          placeholder="e.g., ~/research/*.json"
          className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
          }}
          required
        />
        <p
          className="text-xs mt-1"
          style={{ color: "var(--color-text-muted)" }}
        >
          Supports glob patterns (*, **) and ~ for home directory
        </p>
      </div>

      {/* File Formats */}
      <div>
        <label
          className="block text-sm mb-2"
          style={{ color: "var(--color-text-secondary)" }}
        >
          File Formats (leave empty for all)
        </label>
        <div className="flex gap-2 flex-wrap">
          {EXTERNAL_FILE_FORMATS.map((format) => (
            <label
              key={format.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={fileFormats.includes(format.value)}
                onChange={() => handleFormatToggle(format.value)}
                className="rounded"
              />
              <span
                className="text-sm"
                style={{ color: "var(--color-text-primary)" }}
              >
                {format.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Preview Button */}
      <button
        type="button"
        onClick={handlePreview}
        disabled={!pathPattern.trim() || isPreviewLoading}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          color: "var(--color-text-secondary)",
        }}
      >
        <IconRefresh size={14} className={isPreviewLoading ? "animate-spin" : ""} />
        Preview Files
      </button>

      {/* Preview Results */}
      {showPreview && (
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-primary)",
          }}
        >
          {isPreviewLoading ? (
            <div
              className="text-sm text-center py-2"
              style={{ color: "var(--color-text-muted)" }}
            >
              Loading...
            </div>
          ) : previewFiles.length > 0 ? (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              <div
                className="text-xs mb-2"
                style={{ color: "var(--color-text-muted)" }}
              >
                {previewFiles.length} file(s) matched
              </div>
              {previewFiles.slice(0, 10).map((file) => (
                <FilePreviewItem key={file.path} file={file} compact />
              ))}
              {previewFiles.length > 10 && (
                <div
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  ...and {previewFiles.length - 10} more
                </div>
              )}
            </div>
          ) : (
            <div
              className="text-sm text-center py-2"
              style={{ color: "var(--color-text-muted)" }}
            >
              No files matched
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isLoading || !name.trim() || !pathPattern.trim()}
          className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
          }}
        >
          {source ? "Update" : "Add"} Source
        </button>
        <button
          type="button"
          onClick={() => {
            onCancel();
            clearPreview();
          }}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// File Preview Item Component
function FilePreviewItem({
  file,
  compact = false,
}: {
  file: ResolvedFileInfo;
  compact?: boolean;
}) {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className={`flex items-center gap-2 ${compact ? "py-0.5" : "py-1"}`}
    >
      <IconFile
        size={compact ? 12 : 14}
        style={{ color: "var(--color-text-muted)" }}
      />
      <span
        className={`flex-1 truncate font-mono ${compact ? "text-xs" : "text-sm"}`}
        style={{ color: "var(--color-text-primary)" }}
        title={file.path}
      >
        {file.path.split("/").pop()}
      </span>
      <span
        className="text-xs"
        style={{ color: "var(--color-text-muted)" }}
      >
        {formatBytes(file.sizeBytes)}
      </span>
    </div>
  );
}

// Icons
function IconPlus({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconTrash({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function IconFolder({
  size = 16,
  style,
  className,
}: {
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconFile({
  size = 16,
  style,
}: {
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function IconRefresh({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function IconChevronDown({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconChevronRight({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconX({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
