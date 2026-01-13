import { useState, useEffect } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import {
  exportNotebookZip,
  importNotebookZip,
  listBackups,
  createNotebookBackup,
  deleteBackup,
  getBackupMetadata,
  type BackupInfo,
} from "../../utils/api";
import { useNotebookStore } from "../../stores/notebookStore";
import type { Notebook } from "../../types/notebook";

interface BackupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BackupDialog({ isOpen, onClose }: BackupDialogProps) {
  const [activeTab, setActiveTab] = useState<"export" | "import" | "backups">("export");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { notebooks, loadNotebooks } = useNotebookStore();

  useEffect(() => {
    if (isOpen && activeTab === "backups") {
      loadBackups();
    }
  }, [isOpen, activeTab]);

  const loadBackups = async () => {
    try {
      setIsLoading(true);
      const backupList = await listBackups();
      setBackups(backupList);
    } catch (err) {
      setError(`Failed to load backups: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async (notebook: Notebook) => {
    try {
      setError(null);
      setSuccess(null);

      const safeName = notebook.name.replace(/[/\\?%*:|"<>]/g, "-");
      const path = await save({
        defaultPath: `${safeName}.katt.zip`,
        filters: [{ name: "Katt Backup", extensions: ["zip"] }],
      });

      if (!path) return;

      setIsLoading(true);
      const info = await exportNotebookZip(notebook.id, path);
      setSuccess(`Exported "${info.notebookName}" with ${info.pageCount} pages`);
    } catch (err) {
      setError(`Export failed: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    try {
      setError(null);
      setSuccess(null);

      const path = await open({
        multiple: false,
        filters: [{ name: "Katt Backup", extensions: ["zip"] }],
      });

      if (!path) return;

      setIsLoading(true);

      // Show backup info before importing
      const info = await getBackupMetadata(path);
      const confirmImport = window.confirm(
        `Import notebook "${info.notebookName}"?\n\n` +
          `Contains ${info.pageCount} pages and ${info.assetCount} assets.\n` +
          `Created: ${new Date(info.createdAt).toLocaleString()}`
      );

      if (!confirmImport) {
        setIsLoading(false);
        return;
      }

      const notebook = await importNotebookZip(path);
      await loadNotebooks();
      setSuccess(`Imported "${notebook.name}" successfully`);
    } catch (err) {
      setError(`Import failed: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBackup = async (notebook: Notebook) => {
    try {
      setError(null);
      setSuccess(null);
      setIsLoading(true);

      const info = await createNotebookBackup(notebook.id);
      setSuccess(`Auto-backup created for "${info.notebookName}"`);
      await loadBackups();
    } catch (err) {
      setError(`Backup failed: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteBackup = async (backup: BackupInfo) => {
    const confirmDelete = window.confirm(
      `Delete backup of "${backup.notebookName}"?\n\n` +
        `Created: ${new Date(backup.createdAt).toLocaleString()}\n` +
        `This action cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      setError(null);
      setIsLoading(true);
      await deleteBackup(backup.path);
      setSuccess(`Backup deleted`);
      await loadBackups();
    } catch (err) {
      setError(`Delete failed: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestoreBackup = async (backup: BackupInfo) => {
    const confirmRestore = window.confirm(
      `Restore notebook from backup?\n\n` +
        `Notebook: "${backup.notebookName}"\n` +
        `Created: ${new Date(backup.createdAt).toLocaleString()}\n` +
        `Pages: ${backup.pageCount}\n\n` +
        `This will create a new notebook (existing data won't be affected).`
    );

    if (!confirmRestore) return;

    try {
      setError(null);
      setIsLoading(true);
      const notebook = await importNotebookZip(backup.path);
      await loadNotebooks();
      setSuccess(`Restored "${notebook.name}" successfully`);
    } catch (err) {
      setError(`Restore failed: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative flex h-[600px] w-full max-w-2xl overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-panel)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div
          className="w-48 flex-shrink-0 border-r p-4"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <div className="mb-6">
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Backup
            </h2>
          </div>

          <nav className="space-y-1">
            {[
              { id: "export" as const, label: "Export", icon: <IconUpload /> },
              { id: "import" as const, label: "Import", icon: <IconDownload /> },
              { id: "backups" as const, label: "Auto-Backups", icon: <IconArchive /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor:
                    activeTab === tab.id
                      ? "rgba(139, 92, 246, 0.1)"
                      : "transparent",
                  color:
                    activeTab === tab.id
                      ? "var(--color-accent)"
                      : "var(--color-text-secondary)",
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col">
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-6 py-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h3
              className="text-base font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {activeTab === "export" && "Export Notebook"}
              {activeTab === "import" && "Import Notebook"}
              {activeTab === "backups" && "Auto-Backups"}
            </h3>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              style={{ color: "var(--color-text-muted)" }}
            >
              <IconX />
            </button>
          </div>

          {/* Status Messages */}
          {(error || success) && (
            <div className="px-6 pt-4">
              {error && (
                <div
                  className="rounded-lg p-3 text-sm"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "var(--color-error)",
                  }}
                >
                  {error}
                </div>
              )}
              {success && (
                <div
                  className="rounded-lg p-3 text-sm"
                  style={{
                    backgroundColor: "rgba(34, 197, 94, 0.1)",
                    color: "var(--color-success)",
                  }}
                >
                  {success}
                </div>
              )}
            </div>
          )}

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "export" && (
              <ExportTab
                notebooks={notebooks}
                isLoading={isLoading}
                onExport={handleExport}
                onCreateBackup={handleCreateBackup}
              />
            )}
            {activeTab === "import" && (
              <ImportTab isLoading={isLoading} onImport={handleImport} />
            )}
            {activeTab === "backups" && (
              <BackupsTab
                backups={backups}
                isLoading={isLoading}
                onRestore={handleRestoreBackup}
                onDelete={handleDeleteBackup}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Export Tab
function ExportTab({
  notebooks,
  isLoading,
  onExport,
  onCreateBackup,
}: {
  notebooks: Notebook[];
  isLoading: boolean;
  onExport: (notebook: Notebook) => void;
  onCreateBackup: (notebook: Notebook) => void;
}) {
  return (
    <div className="space-y-4">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Export a notebook as a ZIP file to back it up or transfer to another device.
      </p>

      {notebooks.length === 0 ? (
        <div
          className="py-8 text-center text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          No notebooks to export
        </div>
      ) : (
        <div className="space-y-2">
          {notebooks.map((notebook) => (
            <div
              key={notebook.id}
              className="flex items-center justify-between rounded-lg border p-4"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-secondary)",
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{notebook.icon || "📓"}</span>
                <div>
                  <div
                    className="font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {notebook.name}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Updated {new Date(notebook.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onCreateBackup(notebook)}
                  disabled={isLoading}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    color: "var(--color-text-secondary)",
                  }}
                  title="Create auto-backup"
                >
                  <IconArchive />
                </button>
                <button
                  onClick={() => onExport(notebook)}
                  disabled={isLoading}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                    opacity: isLoading ? 0.5 : 1,
                  }}
                >
                  Export
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Import Tab
function ImportTab({
  isLoading,
  onImport,
}: {
  isLoading: boolean;
  onImport: () => void;
}) {
  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Import a notebook from a Katt backup file (.zip).
      </p>

      <div
        className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="mb-4 rounded-full p-4"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        >
          <IconDownload size={32} />
        </div>
        <h4
          className="mb-2 text-lg font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Import Backup
        </h4>
        <p
          className="mb-6 text-center text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Select a .zip backup file to import
        </p>
        <button
          onClick={onImport}
          disabled={isLoading}
          className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Importing..." : "Choose File"}
        </button>
      </div>
    </div>
  );
}

// Backups Tab
function BackupsTab({
  backups,
  isLoading,
  onRestore,
  onDelete,
}: {
  backups: BackupInfo[];
  isLoading: boolean;
  onRestore: (backup: BackupInfo) => void;
  onDelete: (backup: BackupInfo) => void;
}) {
  return (
    <div className="space-y-4">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Auto-backups are stored locally. Use the archive button in the Export tab to create new backups.
      </p>

      {isLoading ? (
        <div
          className="py-8 text-center text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Loading backups...
        </div>
      ) : backups.length === 0 ? (
        <div
          className="py-8 text-center text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          No auto-backups found
        </div>
      ) : (
        <div className="space-y-2">
          {backups.map((backup, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-lg border p-4"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-secondary)",
              }}
            >
              <div>
                <div
                  className="font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {backup.notebookName}
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {new Date(backup.createdAt).toLocaleString()} • {backup.pageCount} pages • {backup.assetCount} assets
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onRestore(backup)}
                  disabled={isLoading}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  Restore
                </button>
                <button
                  onClick={() => onDelete(backup)}
                  disabled={isLoading}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    color: "var(--color-error)",
                  }}
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Icons
function IconUpload() {
  return (
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
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconDownload({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconArchive() {
  return (
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
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function IconX() {
  return (
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
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconTrash() {
  return (
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
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
