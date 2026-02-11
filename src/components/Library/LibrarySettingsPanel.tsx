/**
 * LibrarySettingsPanel component
 *
 * Panel for managing libraries in settings dialog.
 */

import { useState, useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSyncStore } from "../../stores/syncStore";
import type { LibraryStats } from "../../types/library";
import type { SyncMode, AuthType } from "../../types/sync";
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

  const {
    testConnection,
    configureLibrary,
    disableLibrary,
    syncLibraryNow,
    isTestingConnection,
    testConnectionResult,
    clearTestResult,
    isConfiguring,
    isLibrarySyncing,
  } = useSyncStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [stats, setStats] = useState<Record<string, LibraryStats>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Cloud sync state
  const [showSyncConfig, setShowSyncConfig] = useState(false);
  const [syncServerUrl, setSyncServerUrl] = useState("");
  const [syncUsername, setSyncUsername] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncBasePath, setSyncBasePath] = useState("");
  const [syncMode, setSyncMode] = useState<SyncMode>("manual");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{
    notebook_id: string;
    notebook_name: string;
    current: number;
    total: number;
    message: string;
    phase: string;
  } | null>(null);

  useEffect(() => {
    fetchLibraries();
  }, [fetchLibraries]);

  // Listen for sync-progress events during library sync
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<{
        notebook_id: string;
        notebook_name: string;
        current: number;
        total: number;
        message: string;
        phase: string;
      }>("sync-progress", (event) => {
        if (event.payload.phase === "complete") {
          setSyncProgress(null);
        } else {
          setSyncProgress(event.payload);
        }
      });
    };

    if (isLibrarySyncing) {
      setupListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
      setSyncProgress(null);
    };
  }, [isLibrarySyncing]);

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

    if (!confirm(`Delete library "${library.name}"? This will not delete the notebooks, only remove the library from Nous.`)) {
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

      {/* Cloud Sync for Active Library */}
      {currentLibrary && (
        <div className="space-y-3 pt-2">
          <h3
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Cloud Sync
          </h3>
          <p
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Sync all notebooks in the active library to a WebDAV server.
          </p>

          <div
            className="rounded-md border p-3"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
            }}
          >
            {/* Sync configured - show status */}
            {currentLibrary.syncConfig?.enabled ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: "rgba(34, 197, 94, 0.15)",
                        color: "rgb(34, 197, 94)",
                      }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Sync Enabled
                    </span>
                  </div>
                </div>

                <div className="text-xs space-y-1" style={{ color: "var(--color-text-muted)" }}>
                  <div>
                    Server: <span style={{ color: "var(--color-text-secondary)" }}>{currentLibrary.syncConfig.serverUrl}</span>
                  </div>
                  <div>
                    Base Path: <span style={{ color: "var(--color-text-secondary)" }}>{currentLibrary.syncConfig.remoteBasePath}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    Mode:{" "}
                    <select
                      value={currentLibrary.syncConfig.syncMode}
                      onChange={async (e) => {
                        const newMode = e.target.value as SyncMode;
                        const interval = newMode === "periodic"
                          ? (currentLibrary.syncConfig?.syncInterval || 900)
                          : undefined;
                        try {
                          await api.librarySyncUpdateConfig(currentLibrary.id, newMode, interval);
                          fetchLibraries();
                        } catch (err) {
                          setSyncError(err instanceof Error ? err.message : "Failed to update sync mode");
                        }
                      }}
                      className="rounded border px-1.5 py-0.5 text-xs outline-none"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      <option value="manual">Manual</option>
                      <option value="onsave">On Save</option>
                      <option value="periodic">Periodic</option>
                    </select>
                  </div>
                  {currentLibrary.syncConfig.syncMode === "periodic" && (
                    <div className="flex items-center gap-1">
                      Interval:{" "}
                      <select
                        value={currentLibrary.syncConfig.syncInterval || 900}
                        onChange={async (e) => {
                          const interval = parseInt(e.target.value, 10);
                          try {
                            await api.librarySyncUpdateConfig(currentLibrary.id, "periodic", interval);
                            fetchLibraries();
                          } catch (err) {
                            setSyncError(err instanceof Error ? err.message : "Failed to update sync interval");
                          }
                        }}
                        className="rounded border px-1.5 py-0.5 text-xs outline-none"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        <option value={300}>5 minutes</option>
                        <option value={600}>10 minutes</option>
                        <option value={900}>15 minutes</option>
                        <option value={1800}>30 minutes</option>
                        <option value={3600}>1 hour</option>
                        <option value={7200}>2 hours</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!currentLibrary) return;
                      setSyncError(null);
                      setSyncResult(null);
                      try {
                        const result = await syncLibraryNow(currentLibrary.id);
                        fetchLibraries();
                        if (result.success) {
                          const parts = [];
                          if (result.pagesPushed > 0) parts.push(`${result.pagesPushed} pages pushed`);
                          if (result.pagesPulled > 0) parts.push(`${result.pagesPulled} pages pulled`);
                          if (result.conflictsResolved > 0) parts.push(`${result.conflictsResolved} conflicts resolved`);
                          if (result.assetsPushed > 0) parts.push(`${result.assetsPushed} assets pushed`);
                          if (result.assetsPulled > 0) parts.push(`${result.assetsPulled} assets pulled`);
                          setSyncResult(
                            parts.length > 0
                              ? `Sync complete: ${parts.join(", ")}`
                              : "Sync complete (no changes)"
                          );
                        } else {
                          setSyncError(result.error || "Sync failed");
                        }
                      } catch (e) {
                        setSyncError(e instanceof Error ? e.message : "Sync failed");
                      }
                    }}
                    disabled={isLibrarySyncing}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    {isLibrarySyncing ? "Syncing..." : "Sync All Now"}
                  </button>
                  <button
                    onClick={async () => {
                      if (!currentLibrary) return;
                      if (confirm("Disable cloud sync for this library? All notebook sync configs managed by the library will be cleared.")) {
                        setSyncError(null);
                        try {
                          await disableLibrary(currentLibrary.id);
                          fetchLibraries();
                        } catch (e) {
                          setSyncError(e instanceof Error ? e.message : "Failed to disable sync");
                        }
                      }
                    }}
                    className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Disable
                  </button>
                </div>

                {syncProgress && (
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                        <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>
                          {syncProgress.notebook_name}
                        </span>
                        {" \u2014 "}
                        {syncProgress.message}
                      </span>
                      {syncProgress.total > 0 && (
                        <span className="text-xs font-medium" style={{ color: "var(--color-text-primary)" }}>
                          {syncProgress.current} / {syncProgress.total}
                        </span>
                      )}
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: "var(--color-border)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          backgroundColor: "var(--color-accent)",
                          width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {syncResult && (
                  <p className="text-xs" style={{ color: "rgb(34, 197, 94)" }}>{syncResult}</p>
                )}
                {syncError && (
                  <p className="text-xs" style={{ color: "var(--color-error)" }}>{syncError}</p>
                )}
              </div>
            ) : (
              <>
                {/* Not configured - show form or button */}
                {!showSyncConfig ? (
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Not configured
                    </span>
                    <button
                      onClick={() => {
                        setShowSyncConfig(true);
                        setSyncBasePath(`/nous-sync/${currentLibrary.name.toLowerCase().replace(/\s+/g, "-")}`);
                      }}
                      className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                      style={{
                        backgroundColor: "var(--color-accent)",
                        color: "white",
                      }}
                    >
                      Configure
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                        WebDAV Server URL
                      </label>
                      <input
                        type="text"
                        value={syncServerUrl}
                        onChange={(e) => setSyncServerUrl(e.target.value)}
                        placeholder="https://cloud.example.com/remote.php/dav/files/user/"
                        className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                        style={{
                          backgroundColor: "var(--color-bg-primary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                        Base Remote Path
                      </label>
                      <input
                        type="text"
                        value={syncBasePath}
                        onChange={(e) => setSyncBasePath(e.target.value)}
                        placeholder="/nous-sync/my-library"
                        className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                        style={{
                          backgroundColor: "var(--color-bg-primary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                        Username
                      </label>
                      <input
                        type="text"
                        value={syncUsername}
                        onChange={(e) => setSyncUsername(e.target.value)}
                        placeholder="username"
                        className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                        style={{
                          backgroundColor: "var(--color-bg-primary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                        Password / App Token
                      </label>
                      <input
                        type="password"
                        value={syncPassword}
                        onChange={(e) => setSyncPassword(e.target.value)}
                        placeholder="password"
                        className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                        style={{
                          backgroundColor: "var(--color-bg-primary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                        Sync Mode
                      </label>
                      <select
                        value={syncMode}
                        onChange={(e) => setSyncMode(e.target.value as SyncMode)}
                        className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                        style={{
                          backgroundColor: "var(--color-bg-primary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        <option value="manual">Manual</option>
                        <option value="onsave">On Save</option>
                        <option value="periodic">Periodic</option>
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          setSyncError(null);
                          const result = await testConnection(syncServerUrl, syncUsername, syncPassword);
                          if (!result) {
                            const { error } = useSyncStore.getState();
                            setSyncError(error || "Connection failed. Check your URL and credentials.");
                          }
                        }}
                        disabled={isTestingConnection || !syncServerUrl || !syncUsername || !syncPassword}
                        className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {isTestingConnection ? "Testing..." : testConnectionResult === true ? "Connected!" : "Test Connection"}
                      </button>
                      <button
                        onClick={async () => {
                          if (!currentLibrary) return;
                          setSyncError(null);
                          try {
                            await configureLibrary(currentLibrary.id, {
                              serverUrl: syncServerUrl,
                              remoteBasePath: syncBasePath || `/nous-sync/${currentLibrary.id}`,
                              username: syncUsername,
                              password: syncPassword,
                              authType: "basic" as AuthType,
                              syncMode,
                            });
                            setShowSyncConfig(false);
                            clearTestResult();
                            fetchLibraries();
                          } catch (e) {
                            setSyncError(e instanceof Error ? e.message : "Failed to enable sync");
                          }
                        }}
                        disabled={isConfiguring || !syncServerUrl || !syncUsername || !syncPassword}
                        className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                        style={{
                          backgroundColor: "var(--color-accent)",
                          color: "white",
                        }}
                      >
                        {isConfiguring ? "Enabling..." : "Enable Sync"}
                      </button>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          setShowSyncConfig(false);
                          setSyncServerUrl("");
                          setSyncUsername("");
                          setSyncPassword("");
                          setSyncBasePath("");
                          setSyncError(null);
                          clearTestResult();
                        }}
                        className="text-xs transition-colors"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Cancel
                      </button>
                    </div>

                    {testConnectionResult === true && (
                      <p className="text-xs text-green-500">Connection successful!</p>
                    )}
                    {syncError && (
                      <p className="text-xs" style={{ color: "var(--color-error)" }}>{syncError}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
