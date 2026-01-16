/**
 * LibrarySettingsPanel component
 *
 * Panel for managing libraries in settings dialog.
 */

import { useState, useEffect } from "react";
import { useLibraryStore } from "../../stores/libraryStore";
import type { LibraryStats } from "../../types/library";
import * as api from "../../utils/api";

export function LibrarySettingsPanel() {
  const {
    libraries,
    currentLibrary,
    fetchLibraries,
    createLibrary,
    updateLibrary,
    deleteLibrary,
    switchLibrary,
  } = useLibraryStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [stats, setStats] = useState<Record<string, LibraryStats>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchLibraries();
  }, [fetchLibraries]);

  // Load stats for all libraries
  useEffect(() => {
    async function loadStats() {
      const newStats: Record<string, LibraryStats> = {};
      for (const lib of libraries) {
        try {
          const s = await api.getLibraryStats(lib.id);
          newStats[lib.id] = s;
        } catch (e) {
          // Ignore errors
        }
      }
      setStats(newStats);
    }
    if (libraries.length > 0) {
      loadStats();
    }
  }, [libraries]);

  const handlePickFolder = async () => {
    try {
      const path = await api.pickLibraryFolder();
      if (path) {
        setNewPath(path);
        setPathError(null);
        // Validate the path
        try {
          await api.validateLibraryPath(path);
        } catch (e) {
          setPathError(e instanceof Error ? e.message : "Invalid path");
        }
      }
    } catch (e) {
      console.error("Failed to pick folder:", e);
    }
  };

  const handleCreateLibrary = async () => {
    if (!newName.trim() || !newPath.trim()) return;

    setIsLoading(true);
    try {
      await createLibrary(newName.trim(), newPath.trim());
      setNewName("");
      setNewPath("");
      setIsCreating(false);
      setPathError(null);
    } catch (e) {
      setPathError(e instanceof Error ? e.message : "Failed to create library");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateLibrary = async (id: string) => {
    if (!editName.trim()) return;

    setIsLoading(true);
    try {
      await updateLibrary(id, { name: editName.trim() });
      setEditingId(null);
      setEditName("");
    } catch (e) {
      console.error("Failed to update library:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteLibrary = async (id: string) => {
    const library = libraries.find((l) => l.id === id);
    if (!library || library.isDefault) return;

    if (!confirm(`Delete library "${library.name}"? This will not delete the notebooks, only remove the library from Katt.`)) {
      return;
    }

    setIsLoading(true);
    try {
      await deleteLibrary(id);
    } catch (e) {
      console.error("Failed to delete library:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchLibrary = async (id: string) => {
    if (id === currentLibrary?.id) return;

    setIsLoading(true);
    try {
      await switchLibrary(id);
      window.location.reload();
    } catch (e) {
      console.error("Failed to switch library:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Libraries
        </h3>
        {!isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-accent)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Library
          </button>
        )}
      </div>

      <p
        className="text-xs"
        style={{ color: "var(--color-text-muted)" }}
      >
        Libraries are collections of notebooks stored in different locations. Each library has its own storage path.
      </p>

      {/* Create new library form */}
      {isCreating && (
        <div
          className="rounded-md border p-3 space-y-3"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Library"
              className="w-full rounded-md border px-2.5 py-1.5 text-sm"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Location
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPath}
                onChange={(e) => {
                  setNewPath(e.target.value);
                  setPathError(null);
                }}
                placeholder="/path/to/library"
                className="flex-1 rounded-md border px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: "var(--color-bg-primary)",
                  borderColor: pathError ? "var(--color-error)" : "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
              <button
                onClick={handlePickFolder}
                className="px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-[--color-bg-tertiary]"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Browse...
              </button>
            </div>
            {pathError && (
              <p className="text-xs mt-1" style={{ color: "var(--color-error)" }}>
                {pathError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setIsCreating(false);
                setNewName("");
                setNewPath("");
                setPathError(null);
              }}
              className="px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateLibrary}
              disabled={!newName.trim() || !newPath.trim() || isLoading}
              className="px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Library list */}
      <div className="space-y-2">
        {libraries.map((library) => (
          <div
            key={library.id}
            className="rounded-md border p-3"
            style={{
              backgroundColor:
                library.id === currentLibrary?.id
                  ? "var(--color-bg-secondary)"
                  : "var(--color-bg-primary)",
              borderColor:
                library.id === currentLibrary?.id
                  ? "var(--color-accent)"
                  : "var(--color-border)",
            }}
          >
            {editingId === library.id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 rounded-md border px-2 py-1 text-sm"
                  style={{
                    backgroundColor: "var(--color-bg-primary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                  autoFocus
                />
                <button
                  onClick={() => handleUpdateLibrary(library.id)}
                  disabled={!editName.trim() || isLoading}
                  className="px-2 py-1 text-xs rounded transition-colors"
                  style={{ color: "var(--color-accent)" }}
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setEditName("");
                  }}
                  className="px-2 py-1 text-xs rounded transition-colors"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{library.icon || "📚"}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className="font-medium text-sm"
                          style={{ color: "var(--color-text-primary)" }}
                        >
                          {library.name}
                        </span>
                        {library.isDefault && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: "var(--color-bg-tertiary)",
                              color: "var(--color-text-muted)",
                            }}
                          >
                            Default
                          </span>
                        )}
                        {library.id === currentLibrary?.id && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: "var(--color-accent)",
                              color: "white",
                            }}
                          >
                            Active
                          </span>
                        )}
                      </div>
                      <p
                        className="text-xs truncate max-w-[250px]"
                        style={{ color: "var(--color-text-muted)" }}
                        title={library.path}
                      >
                        {library.path}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {library.id !== currentLibrary?.id && (
                      <button
                        onClick={() => handleSwitchLibrary(library.id)}
                        disabled={isLoading}
                        className="p-1.5 rounded transition-colors hover:bg-[--color-bg-tertiary]"
                        style={{ color: "var(--color-text-muted)" }}
                        title="Switch to this library"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="9 10 4 15 9 20" />
                          <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditingId(library.id);
                        setEditName(library.name);
                      }}
                      className="p-1.5 rounded transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{ color: "var(--color-text-muted)" }}
                      title="Edit name"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                    {!library.isDefault && (
                      <button
                        onClick={() => handleDeleteLibrary(library.id)}
                        disabled={isLoading}
                        className="p-1.5 rounded transition-colors hover:bg-[--color-bg-tertiary]"
                        style={{ color: "var(--color-error)" }}
                        title="Remove library"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {stats[library.id] && (
                  <div
                    className="flex gap-4 mt-2 text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <span>{stats[library.id].notebookCount} notebooks</span>
                    <span>{formatSize(stats[library.id].totalSizeBytes)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
