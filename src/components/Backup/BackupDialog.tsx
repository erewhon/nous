import { useState, useEffect } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  exportNotebookZip,
  importNotebookZip,
  listBackups,
  createNotebookBackup,
  deleteBackup,
  getBackupMetadata,
  getBackupSettings,
  updateBackupSettings,
  runScheduledBackup,
  previewNotionExport,
  importNotionExport,
  previewObsidianVault,
  importObsidianVault,
  previewEvernoteEnex,
  importEvernoteEnex,
  previewScrivenerProject,
  importScrivenerProject,
  previewOrgmode,
  importOrgmode,
  previewJoplinImport,
  importJoplin,
  type BackupInfo,
  type BackupSettings,
  type BackupFrequency,
  type NotionImportPreview,
  type ObsidianImportPreview,
  type EvernoteImportPreview,
  type ScrivenerImportPreview,
  type OrgmodeImportPreview,
  type JoplinImportPreview,
} from "../../utils/api";
import { useNotebookStore } from "../../stores/notebookStore";
import { useToastStore } from "../../stores/toastStore";
import type { Notebook } from "../../types/notebook";

interface BackupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ImportTab = "export" | "import" | "notion" | "obsidian" | "evernote" | "scrivener" | "orgmode" | "joplin" | "backups" | "schedule";

export function BackupDialog({ isOpen, onClose }: BackupDialogProps) {
  const [activeTab, setActiveTab] = useState<ImportTab>("export");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Notion import state
  const [notionPreview, setNotionPreview] = useState<NotionImportPreview | null>(null);
  const [notionZipPath, setNotionZipPath] = useState<string | null>(null);
  const [notionNotebookName, setNotionNotebookName] = useState("");

  // Obsidian import state
  const [obsidianPreview, setObsidianPreview] = useState<ObsidianImportPreview | null>(null);
  const [obsidianVaultPath, setObsidianVaultPath] = useState<string | null>(null);
  const [obsidianNotebookName, setObsidianNotebookName] = useState("");

  // Evernote import state
  const [evernotePreview, setEvernotePreview] = useState<EvernoteImportPreview | null>(null);
  const [evernoteEnexPath, setEvernoteEnexPath] = useState<string | null>(null);
  const [evernoteNotebookName, setEvernoteNotebookName] = useState("");

  // Scrivener import state
  const [scrivenerPreview, setScrivenerPreview] = useState<ScrivenerImportPreview | null>(null);
  const [scrivenerProjectPath, setScrivenerProjectPath] = useState<string | null>(null);
  const [scrivenerNotebookName, setScrivenerNotebookName] = useState("");

  // Org-mode import state
  const [orgmodePreview, setOrgmodePreview] = useState<OrgmodeImportPreview | null>(null);
  const [orgmodeSourcePath, setOrgmodeSourcePath] = useState<string | null>(null);
  const [orgmodeNotebookName, setOrgmodeNotebookName] = useState("");

  // Joplin import state
  const [joplinPreview, setJoplinPreview] = useState<JoplinImportPreview | null>(null);
  const [joplinSourcePath, setJoplinSourcePath] = useState<string | null>(null);
  const [joplinNotebookName, setJoplinNotebookName] = useState("");

  // Import progress state
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    message: string;
  } | null>(null);

  // Backup schedule state
  const [backupSettings, setBackupSettings] = useState<BackupSettings | null>(null);

  const { notebooks, loadNotebooks } = useNotebookStore();
  const toast = useToastStore();

  useEffect(() => {
    if (isOpen && activeTab === "backups") {
      loadBackups();
    }
    if (isOpen && activeTab === "schedule") {
      loadBackupSettings();
    }
  }, [isOpen, activeTab]);

  // Listen for import progress events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<{ current: number; total: number; message: string }>(
        "import-progress",
        (event) => {
          setImportProgress(event.payload);
        }
      );
    };

    if (isOpen) {
      setupListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
      setImportProgress(null);
    };
  }, [isOpen]);

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

  const loadBackupSettings = async () => {
    try {
      setIsLoading(true);
      const settings = await getBackupSettings();
      setBackupSettings(settings);
    } catch (err) {
      setError(`Failed to load backup settings: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveBackupSettings = async (settings: BackupSettings) => {
    try {
      setIsLoading(true);
      setError(null);
      const updated = await updateBackupSettings(settings);
      setBackupSettings(updated);
      toast.success("Backup schedule saved");
    } catch (err) {
      const message = `Failed to save backup settings: ${err}`;
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunBackupNow = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const results = await runScheduledBackup();
      if (results.length === 0) {
        toast.info("No notebooks to backup");
      } else {
        toast.success(`Backed up ${results.length} notebook${results.length > 1 ? "s" : ""}`);
      }
      // Reload backups list
      await loadBackups();
    } catch (err) {
      const message = `Backup failed: ${err}`;
      setError(message);
      toast.error(message);
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
      const message = `Exported "${info.notebookName}" with ${info.pageCount} pages`;
      setSuccess(message);
      toast.success(message);
    } catch (err) {
      const message = `Export failed: ${err}`;
      setError(message);
      toast.error(message);
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
      const message = `Imported "${notebook.name}" successfully`;
      setSuccess(message);
      toast.success(message);
    } catch (err) {
      const message = `Import failed: ${err}`;
      setError(message);
      toast.error(message);
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
      const message = `Auto-backup created for "${info.notebookName}"`;
      setSuccess(message);
      toast.success(message);
      await loadBackups();
    } catch (err) {
      const message = `Backup failed: ${err}`;
      setError(message);
      toast.error(message);
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

  // Notion Import handlers
  const handleNotionSelectFile = async () => {
    try {
      setError(null);
      setSuccess(null);
      setNotionPreview(null);
      setNotionZipPath(null);

      const path = await open({
        multiple: false,
        filters: [{ name: "Notion Export", extensions: ["zip"] }],
      });

      if (!path) return;

      setIsLoading(true);
      const preview = await previewNotionExport(path);
      setNotionPreview(preview);
      setNotionZipPath(path);
      setNotionNotebookName(preview.suggestedName);
    } catch (err) {
      setError(`Failed to read Notion export: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNotionImport = async () => {
    if (!notionZipPath) return;

    try {
      setError(null);
      setSuccess(null);
      setImportProgress(null);
      setIsLoading(true);

      const notebook = await importNotionExport(
        notionZipPath,
        notionNotebookName || undefined
      );
      await loadNotebooks();
      setSuccess(`Imported "${notebook.name}" from Notion successfully`);

      // Reset state
      setNotionPreview(null);
      setNotionZipPath(null);
      setNotionNotebookName("");
    } catch (err) {
      setError(`Notion import failed: ${err}`);
    } finally {
      setIsLoading(false);
      setImportProgress(null);
    }
  };

  const handleNotionCancel = () => {
    setNotionPreview(null);
    setNotionZipPath(null);
    setNotionNotebookName("");
    setError(null);
  };

  // Obsidian Import handlers
  const handleObsidianSelectFolder = async () => {
    try {
      setError(null);
      setSuccess(null);
      setObsidianPreview(null);
      setObsidianVaultPath(null);

      const path = await open({
        directory: true,
        multiple: false,
      });

      if (!path) return;

      setIsLoading(true);
      const preview = await previewObsidianVault(path);
      setObsidianPreview(preview);
      setObsidianVaultPath(path);
      setObsidianNotebookName(preview.suggestedName);
    } catch (err) {
      setError(`Failed to read Obsidian vault: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleObsidianImport = async () => {
    if (!obsidianVaultPath) return;

    try {
      setError(null);
      setSuccess(null);
      setImportProgress(null);
      setIsLoading(true);

      const notebook = await importObsidianVault(
        obsidianVaultPath,
        obsidianNotebookName || undefined
      );
      await loadNotebooks();
      setSuccess(`Imported "${notebook.name}" from Obsidian successfully`);

      setObsidianPreview(null);
      setObsidianVaultPath(null);
      setObsidianNotebookName("");
    } catch (err) {
      setError(`Obsidian import failed: ${err}`);
    } finally {
      setIsLoading(false);
      setImportProgress(null);
    }
  };

  const handleObsidianCancel = () => {
    setObsidianPreview(null);
    setObsidianVaultPath(null);
    setObsidianNotebookName("");
    setError(null);
  };

  // Evernote Import handlers
  const handleEvernoteSelectFile = async () => {
    try {
      setError(null);
      setSuccess(null);
      setEvernotePreview(null);
      setEvernoteEnexPath(null);

      const path = await open({
        multiple: false,
        filters: [{ name: "Evernote Export", extensions: ["enex"] }],
      });

      if (!path) return;

      setIsLoading(true);
      const preview = await previewEvernoteEnex(path);
      setEvernotePreview(preview);
      setEvernoteEnexPath(path);
      setEvernoteNotebookName(preview.suggestedName);
    } catch (err) {
      setError(`Failed to read Evernote export: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEvernoteImport = async () => {
    if (!evernoteEnexPath) return;

    try {
      setError(null);
      setSuccess(null);
      setImportProgress(null);
      setIsLoading(true);

      const notebook = await importEvernoteEnex(
        evernoteEnexPath,
        evernoteNotebookName || undefined
      );
      await loadNotebooks();
      setSuccess(`Imported "${notebook.name}" from Evernote successfully`);

      setEvernotePreview(null);
      setEvernoteEnexPath(null);
      setEvernoteNotebookName("");
    } catch (err) {
      setError(`Evernote import failed: ${err}`);
    } finally {
      setIsLoading(false);
      setImportProgress(null);
    }
  };

  const handleEvernoteCancel = () => {
    setEvernotePreview(null);
    setEvernoteEnexPath(null);
    setEvernoteNotebookName("");
    setError(null);
  };

  // Scrivener Import handlers
  const handleScrivenerSelectFolder = async () => {
    try {
      setError(null);
      setSuccess(null);
      setScrivenerPreview(null);
      setScrivenerProjectPath(null);

      const path = await open({
        directory: true,
        multiple: false,
      });

      if (!path) return;

      setIsLoading(true);
      const preview = await previewScrivenerProject(path);
      setScrivenerPreview(preview);
      setScrivenerProjectPath(path);
      setScrivenerNotebookName(preview.projectTitle);
    } catch (err) {
      setError(`Failed to read Scrivener project: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScrivenerImport = async () => {
    if (!scrivenerProjectPath) return;

    try {
      setError(null);
      setSuccess(null);
      setImportProgress(null);
      setIsLoading(true);

      const notebook = await importScrivenerProject(
        scrivenerProjectPath,
        scrivenerNotebookName || undefined
      );
      await loadNotebooks();
      setSuccess(`Imported "${notebook.name}" from Scrivener successfully`);

      setScrivenerPreview(null);
      setScrivenerProjectPath(null);
      setScrivenerNotebookName("");
    } catch (err) {
      setError(`Scrivener import failed: ${err}`);
    } finally {
      setIsLoading(false);
      setImportProgress(null);
    }
  };

  const handleScrivenerCancel = () => {
    setScrivenerPreview(null);
    setScrivenerProjectPath(null);
    setScrivenerNotebookName("");
    setError(null);
  };

  // Org-mode Import handlers
  const handleOrgmodeSelectSource = async () => {
    try {
      setError(null);
      setSuccess(null);
      setOrgmodePreview(null);
      setOrgmodeSourcePath(null);

      // Allow selecting either a file or directory
      const path = await open({
        multiple: false,
        filters: [{ name: "Org-mode files", extensions: ["org"] }],
      });

      if (!path) return;

      setIsLoading(true);
      const preview = await previewOrgmode(path);
      setOrgmodePreview(preview);
      setOrgmodeSourcePath(path);
      setOrgmodeNotebookName(preview.suggestedName);
    } catch (err) {
      setError(`Failed to read org-mode file: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOrgmodeSelectFolder = async () => {
    try {
      setError(null);
      setSuccess(null);
      setOrgmodePreview(null);
      setOrgmodeSourcePath(null);

      const path = await open({
        directory: true,
        multiple: false,
      });

      if (!path) return;

      setIsLoading(true);
      const preview = await previewOrgmode(path);
      setOrgmodePreview(preview);
      setOrgmodeSourcePath(path);
      setOrgmodeNotebookName(preview.suggestedName);
    } catch (err) {
      setError(`Failed to read org-mode folder: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOrgmodeImport = async () => {
    if (!orgmodeSourcePath) return;

    try {
      setError(null);
      setSuccess(null);
      setImportProgress(null);
      setIsLoading(true);

      const notebook = await importOrgmode(
        orgmodeSourcePath,
        orgmodeNotebookName || undefined
      );
      await loadNotebooks();
      setSuccess(`Imported "${notebook.name}" from Org-mode successfully`);

      setOrgmodePreview(null);
      setOrgmodeSourcePath(null);
      setOrgmodeNotebookName("");
    } catch (err) {
      setError(`Org-mode import failed: ${err}`);
    } finally {
      setIsLoading(false);
      setImportProgress(null);
    }
  };

  const handleOrgmodeCancel = () => {
    setOrgmodePreview(null);
    setOrgmodeSourcePath(null);
    setOrgmodeNotebookName("");
    setError(null);
  };

  // Joplin Import handlers
  const handleJoplinSelectFile = async () => {
    try {
      setError(null);
      setSuccess(null);
      setJoplinPreview(null);
      setJoplinSourcePath(null);

      const path = await open({
        multiple: false,
        filters: [{ name: "Joplin Export", extensions: ["jex", "tar"] }],
      });

      if (!path) return;

      setIsLoading(true);
      const preview = await previewJoplinImport(path);
      setJoplinPreview(preview);
      setJoplinSourcePath(path);
      setJoplinNotebookName(preview.suggestedName);
    } catch (err) {
      setError(`Failed to read Joplin export: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoplinSelectFolder = async () => {
    try {
      setError(null);
      setSuccess(null);
      setJoplinPreview(null);
      setJoplinSourcePath(null);

      const path = await open({
        directory: true,
        multiple: false,
      });

      if (!path) return;

      setIsLoading(true);
      const preview = await previewJoplinImport(path);
      setJoplinPreview(preview);
      setJoplinSourcePath(path);
      setJoplinNotebookName(preview.suggestedName);
    } catch (err) {
      setError(`Failed to read Joplin RAW export: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoplinImport = async () => {
    if (!joplinSourcePath) return;

    try {
      setError(null);
      setSuccess(null);
      setImportProgress(null);
      setIsLoading(true);

      const notebook = await importJoplin(
        joplinSourcePath,
        joplinNotebookName || undefined
      );
      await loadNotebooks();
      setSuccess(`Imported "${notebook.name}" from Joplin successfully`);

      setJoplinPreview(null);
      setJoplinSourcePath(null);
      setJoplinNotebookName("");
    } catch (err) {
      setError(`Joplin import failed: ${err}`);
    } finally {
      setIsLoading(false);
      setImportProgress(null);
    }
  };

  const handleJoplinCancel = () => {
    setJoplinPreview(null);
    setJoplinSourcePath(null);
    setJoplinNotebookName("");
    setError(null);
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
              { id: "notion" as const, label: "Notion", icon: <IconNotion /> },
              { id: "obsidian" as const, label: "Obsidian", icon: <IconObsidian /> },
              { id: "evernote" as const, label: "Evernote", icon: <IconEvernote /> },
              { id: "scrivener" as const, label: "Scrivener", icon: <IconScrivener /> },
              { id: "orgmode" as const, label: "Org-mode", icon: <IconOrgmode /> },
              { id: "joplin" as const, label: "Joplin", icon: <IconJoplin /> },
              { id: "backups" as const, label: "Auto-Backups", icon: <IconArchive /> },
              { id: "schedule" as const, label: "Schedule", icon: <IconClock /> },
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
              {activeTab === "notion" && "Import from Notion"}
              {activeTab === "obsidian" && "Import from Obsidian"}
              {activeTab === "evernote" && "Import from Evernote"}
              {activeTab === "scrivener" && "Import from Scrivener"}
              {activeTab === "orgmode" && "Import from Org-mode"}
              {activeTab === "joplin" && "Import from Joplin"}
              {activeTab === "backups" && "Auto-Backups"}
              {activeTab === "schedule" && "Scheduled Backups"}
            </h3>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              style={{ color: "var(--color-text-muted)" }}
            >
              <IconX />
            </button>
          </div>

          {/* Status Messages and Progress */}
          {(error || success || importProgress) && (
            <div className="px-6 pt-4 space-y-2">
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
              {importProgress && (
                <div
                  className="rounded-lg p-3"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="text-sm"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {importProgress.message}
                    </span>
                    <span
                      className="text-sm font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {importProgress.current} / {importProgress.total}
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-150"
                      style={{
                        backgroundColor: "var(--color-accent)",
                        width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
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
            {activeTab === "notion" && (
              <NotionImportTab
                isLoading={isLoading}
                preview={notionPreview}
                notebookName={notionNotebookName}
                onSelectFile={handleNotionSelectFile}
                onImport={handleNotionImport}
                onCancel={handleNotionCancel}
                onNameChange={setNotionNotebookName}
              />
            )}
            {activeTab === "obsidian" && (
              <ObsidianImportTab
                isLoading={isLoading}
                preview={obsidianPreview}
                notebookName={obsidianNotebookName}
                onSelectFolder={handleObsidianSelectFolder}
                onImport={handleObsidianImport}
                onCancel={handleObsidianCancel}
                onNameChange={setObsidianNotebookName}
              />
            )}
            {activeTab === "evernote" && (
              <EvernoteImportTab
                isLoading={isLoading}
                preview={evernotePreview}
                notebookName={evernoteNotebookName}
                onSelectFile={handleEvernoteSelectFile}
                onImport={handleEvernoteImport}
                onCancel={handleEvernoteCancel}
                onNameChange={setEvernoteNotebookName}
              />
            )}
            {activeTab === "scrivener" && (
              <ScrivenerImportTab
                isLoading={isLoading}
                preview={scrivenerPreview}
                notebookName={scrivenerNotebookName}
                onSelectFolder={handleScrivenerSelectFolder}
                onImport={handleScrivenerImport}
                onCancel={handleScrivenerCancel}
                onNameChange={setScrivenerNotebookName}
              />
            )}
            {activeTab === "orgmode" && (
              <OrgmodeImportTab
                isLoading={isLoading}
                preview={orgmodePreview}
                notebookName={orgmodeNotebookName}
                onSelectFile={handleOrgmodeSelectSource}
                onSelectFolder={handleOrgmodeSelectFolder}
                onImport={handleOrgmodeImport}
                onCancel={handleOrgmodeCancel}
                onNameChange={setOrgmodeNotebookName}
              />
            )}
            {activeTab === "joplin" && (
              <JoplinImportTab
                isLoading={isLoading}
                preview={joplinPreview}
                notebookName={joplinNotebookName}
                onSelectFile={handleJoplinSelectFile}
                onSelectFolder={handleJoplinSelectFolder}
                onImport={handleJoplinImport}
                onCancel={handleJoplinCancel}
                onNameChange={setJoplinNotebookName}
              />
            )}
            {activeTab === "backups" && (
              <BackupsTab
                backups={backups}
                isLoading={isLoading}
                onRestore={handleRestoreBackup}
                onDelete={handleDeleteBackup}
              />
            )}
            {activeTab === "schedule" && (
              <ScheduleTab
                settings={backupSettings}
                notebooks={notebooks}
                isLoading={isLoading}
                onSave={handleSaveBackupSettings}
                onRunNow={handleRunBackupNow}
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

// Schedule Tab
function ScheduleTab({
  settings,
  notebooks,
  isLoading,
  onSave,
  onRunNow,
}: {
  settings: BackupSettings | null;
  notebooks: Notebook[];
  isLoading: boolean;
  onSave: (settings: BackupSettings) => void;
  onRunNow: () => void;
}) {
  const [localSettings, setLocalSettings] = useState<BackupSettings>({
    enabled: false,
    frequency: "daily",
    time: "02:00",
    maxBackupsPerNotebook: 5,
    notebookIds: [],
  });
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
      setHasChanges(false);
    }
  }, [settings]);

  const handleChange = <K extends keyof BackupSettings>(key: K, value: BackupSettings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleNotebookToggle = (notebookId: string) => {
    setLocalSettings((prev) => {
      const newIds = prev.notebookIds.includes(notebookId)
        ? prev.notebookIds.filter((id) => id !== notebookId)
        : [...prev.notebookIds, notebookId];
      return { ...prev, notebookIds: newIds };
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    onSave(localSettings);
    setHasChanges(false);
  };

  const dayOfWeekOptions = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
  ];

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Configure automatic backups to run on a schedule.
      </p>

      {/* Enable/Disable Toggle */}
      <div
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
            Enable Scheduled Backups
          </div>
          <div
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Automatically backup notebooks at the configured time
          </div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={localSettings.enabled}
            onChange={(e) => handleChange("enabled", e.target.checked)}
            className="peer sr-only"
          />
          <div
            className="h-6 w-11 rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:transition-all"
            style={{
              backgroundColor: localSettings.enabled ? "var(--color-accent)" : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute left-[2px] top-[2px] h-5 w-5 rounded-full transition-transform"
              style={{
                backgroundColor: "white",
                transform: localSettings.enabled ? "translateX(20px)" : "translateX(0)",
              }}
            />
          </div>
        </label>
      </div>

      {/* Schedule Settings */}
      <div
        className="space-y-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          opacity: localSettings.enabled ? 1 : 0.5,
        }}
      >
        <h4
          className="font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Schedule
        </h4>

        {/* Frequency */}
        <div className="flex items-center gap-4">
          <label
            className="w-24 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Frequency
          </label>
          <select
            value={localSettings.frequency}
            onChange={(e) => handleChange("frequency", e.target.value as BackupFrequency)}
            disabled={!localSettings.enabled}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
            }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {/* Day of Week (for weekly) */}
        {localSettings.frequency === "weekly" && (
          <div className="flex items-center gap-4">
            <label
              className="w-24 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Day
            </label>
            <select
              value={localSettings.dayOfWeek ?? 0}
              onChange={(e) => handleChange("dayOfWeek", parseInt(e.target.value))}
              disabled={!localSettings.enabled}
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            >
              {dayOfWeekOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Day of Month (for monthly) */}
        {localSettings.frequency === "monthly" && (
          <div className="flex items-center gap-4">
            <label
              className="w-24 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Day
            </label>
            <select
              value={localSettings.dayOfMonth ?? 1}
              onChange={(e) => handleChange("dayOfMonth", parseInt(e.target.value))}
              disabled={!localSettings.enabled}
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Time */}
        <div className="flex items-center gap-4">
          <label
            className="w-24 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Time
          </label>
          <input
            type="time"
            value={localSettings.time}
            onChange={(e) => handleChange("time", e.target.value)}
            disabled={!localSettings.enabled}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>

        {/* Max Backups */}
        <div className="flex items-center gap-4">
          <label
            className="w-24 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Keep
          </label>
          <select
            value={localSettings.maxBackupsPerNotebook}
            onChange={(e) => handleChange("maxBackupsPerNotebook", parseInt(e.target.value))}
            disabled={!localSettings.enabled}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
            }}
          >
            <option value={3}>Last 3 backups</option>
            <option value={5}>Last 5 backups</option>
            <option value={10}>Last 10 backups</option>
            <option value={20}>Last 20 backups</option>
          </select>
        </div>
      </div>

      {/* Notebook Selection */}
      <div
        className="space-y-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          opacity: localSettings.enabled ? 1 : 0.5,
        }}
      >
        <div className="flex items-center justify-between">
          <h4
            className="font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Notebooks
          </h4>
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {localSettings.notebookIds.length === 0
              ? "All notebooks"
              : `${localSettings.notebookIds.length} selected`}
          </span>
        </div>

        <p
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Select specific notebooks to backup, or leave all unchecked to backup everything.
        </p>

        <div className="space-y-2 max-h-40 overflow-y-auto">
          {notebooks.map((notebook) => (
            <label
              key={notebook.id}
              className="flex items-center gap-3 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={localSettings.notebookIds.includes(notebook.id)}
                onChange={() => handleNotebookToggle(notebook.id)}
                disabled={!localSettings.enabled}
                className="rounded"
              />
              <span className="text-lg">{notebook.icon || "📓"}</span>
              <span
                className="text-sm"
                style={{ color: "var(--color-text-primary)" }}
              >
                {notebook.name}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Status */}
      {settings && (
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
          }}
        >
          <h4
            className="font-medium mb-2"
            style={{ color: "var(--color-text-primary)" }}
          >
            Status
          </h4>
          <div className="space-y-1 text-sm">
            <div style={{ color: "var(--color-text-secondary)" }}>
              Last backup:{" "}
              <span style={{ color: "var(--color-text-primary)" }}>
                {settings.lastBackup
                  ? new Date(settings.lastBackup).toLocaleString()
                  : "Never"}
              </span>
            </div>
            {settings.enabled && settings.nextBackup && (
              <div style={{ color: "var(--color-text-secondary)" }}>
                Next backup:{" "}
                <span style={{ color: "var(--color-text-primary)" }}>
                  {new Date(settings.nextBackup).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={isLoading || !hasChanges}
          className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          style={{
            backgroundColor: hasChanges ? "var(--color-accent)" : "var(--color-bg-tertiary)",
            color: hasChanges ? "white" : "var(--color-text-muted)",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Saving..." : "Save Settings"}
        </button>
        <button
          onClick={onRunNow}
          disabled={isLoading}
          className="rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Running..." : "Backup Now"}
        </button>
      </div>
    </div>
  );
}

// Notion Import Tab
function NotionImportTab({
  isLoading,
  preview,
  notebookName,
  onSelectFile,
  onImport,
  onCancel,
  onNameChange,
}: {
  isLoading: boolean;
  preview: NotionImportPreview | null;
  notebookName: string;
  onSelectFile: () => void;
  onImport: () => void;
  onCancel: () => void;
  onNameChange: (name: string) => void;
}) {
  if (!preview) {
    return (
      <div className="space-y-6">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Import pages from a Notion export. Export your Notion workspace as Markdown &amp; CSV,
          then select the ZIP file below.
        </p>

        <div
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="mb-4 rounded-full p-4"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <IconNotion size={32} />
          </div>
          <h4
            className="mb-2 text-lg font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Import from Notion
          </h4>
          <p
            className="mb-6 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Select a Notion export ZIP file
          </p>
          <button
            onClick={onSelectFile}
            disabled={isLoading}
            className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {isLoading ? "Loading..." : "Choose File"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Review the import preview and confirm.
      </p>

      {/* Preview Stats */}
      <div
        className="grid grid-cols-2 gap-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.pageCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Pages
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.assetCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Images
          </div>
        </div>
        {preview.databaseCount > 0 && (
          <>
            <div>
              <div
                className="text-2xl font-bold"
                style={{ color: "var(--color-accent)" }}
              >
                {preview.databaseCount}
              </div>
              <div
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Databases
              </div>
            </div>
            <div>
              <div
                className="text-2xl font-bold"
                style={{ color: "var(--color-accent)" }}
              >
                {preview.databaseRowCount}
              </div>
              <div
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Database rows
              </div>
            </div>
          </>
        )}
      </div>

      {/* Page Preview */}
      {preview.pages.length > 0 && (
        <div>
          <h4
            className="mb-2 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Sample Pages
          </h4>
          <div
            className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            {preview.pages.map((page, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span>{page.isDatabaseRow ? "📊" : page.hasImages ? "🖼️" : "📄"}</span>
                <span className="truncate">{page.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{
            backgroundColor: "rgba(234, 179, 8, 0.1)",
            color: "var(--color-warning)",
          }}
        >
          <strong>Warnings:</strong>
          <ul className="mt-1 list-disc pl-4">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Notebook Name */}
      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Notebook Name
        </label>
        <input
          type="text"
          value={notebookName}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-lg border px-4 py-2 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
          }}
          placeholder="Enter notebook name"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onImport}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Importing..." : "Import Notebook"}
        </button>
      </div>
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

function IconClock() {
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconNotion({ size = 16 }: { size?: number }) {
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
      <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M14 4v6h6" />
      <path d="M8 12h4" />
      <path d="M8 16h6" />
    </svg>
  );
}

function IconObsidian({ size = 16 }: { size?: number }) {
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
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
      <line x1="12" y1="22" x2="12" y2="15.5" />
      <polyline points="22 8.5 12 15.5 2 8.5" />
    </svg>
  );
}

function IconEvernote({ size = 16 }: { size?: number }) {
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
      <path d="M12 3c-1.2 0-2.4.6-3 1.7A3.6 3.6 0 0 0 4.6 9c-1.3 1-2.1 2.6-2.1 4.2a5 5 0 0 0 10 0" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
      <path d="M16 8h2a3 3 0 0 1 3 3v6a4 4 0 0 1-4 4h-6" />
    </svg>
  );
}

function IconScrivener({ size = 16 }: { size?: number }) {
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
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

// Obsidian Import Tab
function ObsidianImportTab({
  isLoading,
  preview,
  notebookName,
  onSelectFolder,
  onImport,
  onCancel,
  onNameChange,
}: {
  isLoading: boolean;
  preview: ObsidianImportPreview | null;
  notebookName: string;
  onSelectFolder: () => void;
  onImport: () => void;
  onCancel: () => void;
  onNameChange: (name: string) => void;
}) {
  if (!preview) {
    return (
      <div className="space-y-6">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Import pages from an Obsidian vault. Select your vault folder to begin.
        </p>

        <div
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="mb-4 rounded-full p-4"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <IconObsidian size={32} />
          </div>
          <h4
            className="mb-2 text-lg font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Import from Obsidian
          </h4>
          <p
            className="mb-6 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Select your Obsidian vault folder
          </p>
          <button
            onClick={onSelectFolder}
            disabled={isLoading}
            className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {isLoading ? "Loading..." : "Choose Folder"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Review the import preview and confirm.
      </p>

      <div
        className="grid grid-cols-3 gap-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.pageCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Pages
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.assetCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Assets
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.folderCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Folders
          </div>
        </div>
      </div>

      {preview.pages.length > 0 && (
        <div>
          <h4
            className="mb-2 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Sample Pages
          </h4>
          <div
            className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            {preview.pages.map((page, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span>{page.hasWikiLinks ? "🔗" : "📄"}</span>
                <span className="truncate">{page.title}</span>
                {page.tags.length > 0 && (
                  <span className="text-xs opacity-60">
                    {page.tags.slice(0, 2).map(t => `#${t}`).join(" ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{
            backgroundColor: "rgba(234, 179, 8, 0.1)",
            color: "var(--color-warning)",
          }}
        >
          <strong>Warnings:</strong>
          <ul className="mt-1 list-disc pl-4">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Notebook Name
        </label>
        <input
          type="text"
          value={notebookName}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-lg border px-4 py-2 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
          }}
          placeholder="Enter notebook name"
        />
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onImport}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Importing..." : "Import Notebook"}
        </button>
      </div>
    </div>
  );
}

// Evernote Import Tab
function EvernoteImportTab({
  isLoading,
  preview,
  notebookName,
  onSelectFile,
  onImport,
  onCancel,
  onNameChange,
}: {
  isLoading: boolean;
  preview: EvernoteImportPreview | null;
  notebookName: string;
  onSelectFile: () => void;
  onImport: () => void;
  onCancel: () => void;
  onNameChange: (name: string) => void;
}) {
  if (!preview) {
    return (
      <div className="space-y-6">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Import notes from an Evernote export file (.enex). Export your notebooks from Evernote first.
        </p>

        <div
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="mb-4 rounded-full p-4"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <IconEvernote size={32} />
          </div>
          <h4
            className="mb-2 text-lg font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Import from Evernote
          </h4>
          <p
            className="mb-6 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Select an Evernote export file (.enex)
          </p>
          <button
            onClick={onSelectFile}
            disabled={isLoading}
            className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {isLoading ? "Loading..." : "Choose File"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Review the import preview and confirm.
      </p>

      <div
        className="grid grid-cols-2 gap-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.noteCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Notes
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.resourceCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Attachments
          </div>
        </div>
      </div>

      {preview.notes.length > 0 && (
        <div>
          <h4
            className="mb-2 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Sample Notes
          </h4>
          <div
            className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            {preview.notes.map((note, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span>{note.hasAttachments ? "📎" : "📄"}</span>
                <span className="truncate">{note.title}</span>
                {note.tags.length > 0 && (
                  <span className="text-xs opacity-60">
                    {note.tags.slice(0, 2).map(t => `#${t}`).join(" ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{
            backgroundColor: "rgba(234, 179, 8, 0.1)",
            color: "var(--color-warning)",
          }}
        >
          <strong>Warnings:</strong>
          <ul className="mt-1 list-disc pl-4">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Notebook Name
        </label>
        <input
          type="text"
          value={notebookName}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-lg border px-4 py-2 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
          }}
          placeholder="Enter notebook name"
        />
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onImport}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Importing..." : "Import Notebook"}
        </button>
      </div>
    </div>
  );
}

// Scrivener Import Tab
function ScrivenerImportTab({
  isLoading,
  preview,
  notebookName,
  onSelectFolder,
  onImport,
  onCancel,
  onNameChange,
}: {
  isLoading: boolean;
  preview: ScrivenerImportPreview | null;
  notebookName: string;
  onSelectFolder: () => void;
  onImport: () => void;
  onCancel: () => void;
  onNameChange: (name: string) => void;
}) {
  if (!preview) {
    return (
      <div className="space-y-6">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Import documents from a Scrivener project (.scriv folder). Select your project folder to begin.
        </p>

        <div
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="mb-4 rounded-full p-4"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <IconScrivener size={32} />
          </div>
          <h4
            className="mb-2 text-lg font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Import from Scrivener
          </h4>
          <p
            className="mb-6 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Select your .scriv project folder
          </p>
          <button
            onClick={onSelectFolder}
            disabled={isLoading}
            className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {isLoading ? "Loading..." : "Choose Folder"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Review the import preview and confirm.
      </p>

      <div
        className="grid grid-cols-2 gap-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.documentCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Documents
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.folderCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Folders
          </div>
        </div>
      </div>

      {preview.documents.length > 0 && (
        <div>
          <h4
            className="mb-2 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Sample Documents
          </h4>
          <div
            className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            {preview.documents.map((doc, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span>📄</span>
                <span className="truncate">{doc.title}</span>
                {doc.folderPath && (
                  <span className="text-xs opacity-60">in {doc.folderPath}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{
            backgroundColor: "rgba(234, 179, 8, 0.1)",
            color: "var(--color-warning)",
          }}
        >
          <strong>Warnings:</strong>
          <ul className="mt-1 list-disc pl-4">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Notebook Name
        </label>
        <input
          type="text"
          value={notebookName}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-lg border px-4 py-2 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
          }}
          placeholder="Enter notebook name"
        />
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onImport}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Importing..." : "Import Notebook"}
        </button>
      </div>
    </div>
  );
}

// Org-mode Import Tab
function OrgmodeImportTab({
  isLoading,
  preview,
  notebookName,
  onSelectFile,
  onSelectFolder,
  onImport,
  onCancel,
  onNameChange,
}: {
  isLoading: boolean;
  preview: OrgmodeImportPreview | null;
  notebookName: string;
  onSelectFile: () => void;
  onSelectFolder: () => void;
  onImport: () => void;
  onCancel: () => void;
  onNameChange: (name: string) => void;
}) {
  if (!preview) {
    return (
      <div className="space-y-6">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Import pages from Emacs Org-mode files (.org). You can select a single file or a folder containing multiple org files.
        </p>

        <div
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="mb-4 rounded-full p-4"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <IconOrgmode size={32} />
          </div>
          <h4
            className="mb-2 text-lg font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Import from Org-mode
          </h4>
          <p
            className="mb-6 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Select an .org file or folder
          </p>
          <div className="flex gap-3">
            <button
              onClick={onSelectFile}
              disabled={isLoading}
              className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              {isLoading ? "Loading..." : "Choose File"}
            </button>
            <button
              onClick={onSelectFolder}
              disabled={isLoading}
              className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              Choose Folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Review the import preview and confirm.
      </p>

      <div
        className="grid grid-cols-3 gap-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.pageCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {preview.isSingleFile ? "File" : "Files"}
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.assetCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Assets
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.folderCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Folders
          </div>
        </div>
      </div>

      {preview.pages.length > 0 && (
        <div>
          <h4
            className="mb-2 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Sample Pages
          </h4>
          <div
            className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            {preview.pages.map((page, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span>{page.hasTodos ? "☑️" : page.hasScheduled ? "📅" : "📄"}</span>
                <span className="truncate">{page.title}</span>
                {page.tags.length > 0 && (
                  <span className="text-xs opacity-60">
                    {page.tags.slice(0, 2).map(t => `:${t}:`).join(" ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{
            backgroundColor: "rgba(234, 179, 8, 0.1)",
            color: "var(--color-warning)",
          }}
        >
          <strong>Warnings:</strong>
          <ul className="mt-1 list-disc pl-4">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Notebook Name
        </label>
        <input
          type="text"
          value={notebookName}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-lg border px-4 py-2 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
          }}
          placeholder="Enter notebook name"
        />
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onImport}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Importing..." : "Import Notebook"}
        </button>
      </div>
    </div>
  );
}

// Joplin Import Tab
function JoplinImportTab({
  isLoading,
  preview,
  notebookName,
  onSelectFile,
  onSelectFolder,
  onImport,
  onCancel,
  onNameChange,
}: {
  isLoading: boolean;
  preview: JoplinImportPreview | null;
  notebookName: string;
  onSelectFile: () => void;
  onSelectFolder: () => void;
  onImport: () => void;
  onCancel: () => void;
  onNameChange: (name: string) => void;
}) {
  if (!preview) {
    return (
      <div className="space-y-6">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Import notes from a Joplin export. You can select a JEX archive (.jex) or a RAW export folder.
        </p>

        <div
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="mb-4 rounded-full p-4"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <IconJoplin size={32} />
          </div>
          <h4
            className="mb-2 text-lg font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Import from Joplin
          </h4>
          <p
            className="mb-6 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Select a .jex file or RAW export folder
          </p>
          <div className="flex gap-3">
            <button
              onClick={onSelectFile}
              disabled={isLoading}
              className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              {isLoading ? "Loading..." : "Choose JEX File"}
            </button>
            <button
              onClick={onSelectFolder}
              disabled={isLoading}
              className="rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              RAW Folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Review the import preview and confirm.
      </p>

      <div
        className="grid grid-cols-4 gap-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.noteCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Notes
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.folderCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Folders
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.tagCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Tags
          </div>
        </div>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--color-accent)" }}
          >
            {preview.resourceCount}
          </div>
          <div
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Attachments
          </div>
        </div>
      </div>

      {preview.notes.length > 0 && (
        <div>
          <h4
            className="mb-2 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Sample Notes
          </h4>
          <div
            className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            {preview.notes.map((note, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span>{note.isTodo ? "☑️" : note.hasAttachments ? "📎" : "📄"}</span>
                <span className="truncate">{note.title}</span>
                {note.folderPath && (
                  <span className="text-xs opacity-60">in {note.folderPath}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{
            backgroundColor: "rgba(234, 179, 8, 0.1)",
            color: "var(--color-warning)",
          }}
        >
          <strong>Warnings:</strong>
          <ul className="mt-1 list-disc pl-4">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Notebook Name
        </label>
        <input
          type="text"
          value={notebookName}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-lg border px-4 py-2 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
          }}
          placeholder="Enter notebook name"
        />
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onImport}
          disabled={isLoading}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Importing..." : "Import Notebook"}
        </button>
      </div>
    </div>
  );
}

function IconOrgmode({ size = 16 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconJoplin({ size = 16 }: { size?: number }) {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}
