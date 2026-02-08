import { useState, useEffect, useCallback } from "react";
import {
  getNotebookTags,
  renameTag,
  mergeTags,
  deleteTag,
  type TagInfo,
} from "../../utils/api";
import { usePageStore } from "../../stores/pageStore";

interface TagManagerProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string | null;
}

type Mode = "view" | "rename" | "merge" | "delete";

export function TagManager({ isOpen, onClose, notebookId }: TagManagerProps) {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { loadPages } = usePageStore();

  const fetchTags = useCallback(async () => {
    if (!notebookId) return;

    setIsLoading(true);
    setError(null);
    try {
      const tagList = await getNotebookTags(notebookId);
      setTags(tagList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tags");
    } finally {
      setIsLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    if (isOpen && notebookId) {
      fetchTags();
      setMode("view");
      setSelectedTag(null);
      setSelectedTags([]);
      setNewTagName("");
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, notebookId, fetchTags]);

  const handleRename = async () => {
    if (!notebookId || !selectedTag || !newTagName.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const count = await renameTag(notebookId, selectedTag, newTagName.trim());
      setSuccessMessage(`Renamed "${selectedTag}" to "${newTagName}" in ${count} page(s)`);
      await fetchTags();
      await loadPages(notebookId);
      setMode("view");
      setSelectedTag(null);
      setNewTagName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename tag");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!notebookId || selectedTags.length < 2 || !newTagName.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const count = await mergeTags(notebookId, selectedTags, newTagName.trim());
      setSuccessMessage(
        `Merged ${selectedTags.length} tags into "${newTagName}" in ${count} page(s)`
      );
      await fetchTags();
      await loadPages(notebookId);
      setMode("view");
      setSelectedTags([]);
      setNewTagName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge tags");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!notebookId || !selectedTag) return;

    setIsLoading(true);
    setError(null);
    try {
      const count = await deleteTag(notebookId, selectedTag);
      setSuccessMessage(`Deleted "${selectedTag}" from ${count} page(s)`);
      await fetchTags();
      await loadPages(notebookId);
      setMode("view");
      setSelectedTag(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete tag");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTagSelection = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="relative z-10 w-full max-w-lg rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Manage Tags
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-96 overflow-y-auto p-6">
          {/* Messages */}
          {error && (
            <div
              className="mb-4 rounded-lg p-3 text-sm"
              style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}
            >
              {error}
            </div>
          )}
          {successMessage && (
            <div
              className="mb-4 rounded-lg p-3 text-sm"
              style={{ backgroundColor: "rgba(34, 197, 94, 0.1)", color: "#22c55e" }}
            >
              {successMessage}
            </div>
          )}

          {/* Mode buttons */}
          {mode === "view" && (
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setMode("rename")}
                disabled={tags.length === 0}
                className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/10 disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Rename
              </button>
              <button
                onClick={() => setMode("merge")}
                disabled={tags.length < 2}
                className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/10 disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Merge
              </button>
              <button
                onClick={() => setMode("delete")}
                disabled={tags.length === 0}
                className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/10 disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Delete
              </button>
            </div>
          )}

          {/* Mode-specific UI */}
          {mode === "rename" && (
            <div className="mb-4 space-y-3">
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Select a tag to rename:
              </p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => {
                      setSelectedTag(tag.name);
                      setNewTagName(tag.name);
                    }}
                    className="rounded-full px-3 py-1 text-sm transition-colors"
                    style={{
                      backgroundColor:
                        selectedTag === tag.name
                          ? "rgba(139, 92, 246, 0.3)"
                          : "rgba(139, 92, 246, 0.1)",
                      color: "var(--color-accent)",
                      border:
                        selectedTag === tag.name
                          ? "1px solid var(--color-accent)"
                          : "1px solid transparent",
                    }}
                  >
                    {tag.name} ({tag.count})
                  </button>
                ))}
              </div>
              {selectedTag && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="New tag name"
                    className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-500"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                  <button
                    onClick={handleRename}
                    disabled={!newTagName.trim() || isLoading}
                    className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    {isLoading ? "..." : "Rename"}
                  </button>
                  <button
                    onClick={() => {
                      setMode("view");
                      setSelectedTag(null);
                      setNewTagName("");
                    }}
                    className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-white/10"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === "merge" && (
            <div className="mb-4 space-y-3">
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Select tags to merge (at least 2):
              </p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => toggleTagSelection(tag.name)}
                    className="rounded-full px-3 py-1 text-sm transition-colors"
                    style={{
                      backgroundColor: selectedTags.includes(tag.name)
                        ? "rgba(139, 92, 246, 0.3)"
                        : "rgba(139, 92, 246, 0.1)",
                      color: "var(--color-accent)",
                      border: selectedTags.includes(tag.name)
                        ? "1px solid var(--color-accent)"
                        : "1px solid transparent",
                    }}
                  >
                    {tag.name} ({tag.count})
                  </button>
                ))}
              </div>
              {selectedTags.length >= 2 && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Target tag name"
                    className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-500"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                  <button
                    onClick={handleMerge}
                    disabled={!newTagName.trim() || isLoading}
                    className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    {isLoading ? "..." : "Merge"}
                  </button>
                  <button
                    onClick={() => {
                      setMode("view");
                      setSelectedTags([]);
                      setNewTagName("");
                    }}
                    className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-white/10"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === "delete" && (
            <div className="mb-4 space-y-3">
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Select a tag to delete:
              </p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => setSelectedTag(tag.name)}
                    className="rounded-full px-3 py-1 text-sm transition-colors"
                    style={{
                      backgroundColor:
                        selectedTag === tag.name
                          ? "rgba(239, 68, 68, 0.3)"
                          : "rgba(139, 92, 246, 0.1)",
                      color: selectedTag === tag.name ? "#ef4444" : "var(--color-accent)",
                      border:
                        selectedTag === tag.name
                          ? "1px solid #ef4444"
                          : "1px solid transparent",
                    }}
                  >
                    {tag.name} ({tag.count})
                  </button>
                ))}
              </div>
              {selectedTag && (
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                    Delete "{selectedTag}" from all pages?
                  </span>
                  <button
                    onClick={handleDelete}
                    disabled={isLoading}
                    className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: "#ef4444",
                      color: "white",
                    }}
                  >
                    {isLoading ? "..." : "Delete"}
                  </button>
                  <button
                    onClick={() => {
                      setMode("view");
                      setSelectedTag(null);
                    }}
                    className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-white/10"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tag list (view mode) */}
          {mode === "view" && (
            <>
              {isLoading ? (
                <div
                  className="py-8 text-center text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Loading tags...
                </div>
              ) : tags.length === 0 ? (
                <div
                  className="py-8 text-center text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  No tags in this notebook yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {(() => {
                    // Group tags into tree structure
                    const rootTags: TagInfo[] = [];
                    const childMap = new Map<string, TagInfo[]>();
                    for (const tag of tags) {
                      const parts = tag.name.split("/");
                      if (parts.length === 1) {
                        rootTags.push(tag);
                      } else {
                        const parent = parts.slice(0, -1).join("/");
                        if (!childMap.has(parent)) childMap.set(parent, []);
                        childMap.get(parent)!.push(tag);
                      }
                    }
                    // Also include tags whose parent doesn't exist at root level
                    for (const tag of tags) {
                      const parts = tag.name.split("/");
                      if (parts.length > 1) {
                        const parent = parts.slice(0, -1).join("/");
                        if (!tags.some((t) => t.name === parent) && !rootTags.includes(tag)) {
                          rootTags.push(tag);
                        }
                      }
                    }

                    function renderTag(tag: TagInfo, indent: number) {
                      const children = childMap.get(tag.name) || [];
                      return (
                        <div key={tag.name}>
                          <span
                            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm"
                            style={{
                              marginLeft: `${indent * 16}px`,
                              backgroundColor: "rgba(139, 92, 246, 0.1)",
                              color: "var(--color-accent)",
                            }}
                          >
                            {tag.name.split("/").pop()}
                            <span
                              className="text-xs"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              {tag.count}
                            </span>
                          </span>
                          {children.map((child) => renderTag(child, indent + 1))}
                        </div>
                      );
                    }

                    return rootTags.map((tag) => renderTag(tag, 0));
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
