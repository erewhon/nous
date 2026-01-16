import { useState, useEffect, useRef, useCallback } from "react";
import type { Notebook, AIProviderType } from "../../types/notebook";
import type { SystemPromptMode } from "../../types/page";
import type { SyncMode, AuthType } from "../../types/sync";
import { useNotebookStore } from "../../stores/notebookStore";
import { useAIStore } from "../../stores/aiStore";
import { useSyncStore } from "../../stores/syncStore";
import {
  gitIsEnabled,
  gitInit,
  gitStatus,
  gitSetRemote,
  gitRemoveRemote,
  gitPush,
  gitPull,
  gitListBranches,
  gitCreateBranch,
  gitSwitchBranch,
  gitDeleteBranch,
  gitMergeBranch,
  gitIsMerging,
  getCoverPage,
  createCoverPage,
  type GitStatus,
  type MergeResult,
} from "../../utils/api";
import { InlineColorPicker } from "../ColorPicker/ColorPicker";
import { GitConflictDialog } from "./GitConflictDialog";

const AI_PROVIDERS: { value: AIProviderType; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "ollama", label: "Ollama" },
  { value: "lmstudio", label: "LM Studio" },
];

const AI_MODELS: Record<AIProviderType, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-5-20251101",
    "claude-opus-4-20250514",
    "claude-3-5-haiku-20241022",
  ],
  ollama: ["llama3.2", "llama3.1", "mistral", "codellama", "phi3"],
  lmstudio: ["local-model"],
};

interface NotebookSettingsDialogProps {
  isOpen: boolean;
  notebook: Notebook | null;
  onClose: () => void;
}

export function NotebookSettingsDialog({
  isOpen,
  notebook,
  onClose,
}: NotebookSettingsDialogProps) {
  const { updateNotebook, deleteNotebook } = useNotebookStore();
  const { settings: appAISettings, getActiveProviderType, getActiveModel } = useAIStore();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | undefined>(undefined);
  const [sectionsEnabled, setSectionsEnabled] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemPromptMode, setSystemPromptMode] = useState<SystemPromptMode>("override");
  const [aiProvider, setAiProvider] = useState<AIProviderType | undefined>(undefined);
  const [aiModel, setAiModel] = useState<string | undefined>(undefined);
  const [useAppDefault, setUseAppDefault] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Git state
  const [gitEnabled, setGitEnabled] = useState(false);
  const [gitStatusData, setGitStatusData] = useState<GitStatus | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isGitLoading, setIsGitLoading] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);

  // Branch state
  const [branches, setBranches] = useState<string[]>([]);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  const [showMergeDropdown, setShowMergeDropdown] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  // Cover page state
  const [hasCoverPage, setHasCoverPage] = useState(false);
  const [isCoverLoading, setIsCoverLoading] = useState(false);

  // Sync state
  const {
    testConnection,
    configure: configureSync,
    loadStatus: loadSyncStatus,
    syncNow: triggerSync,
    disable: disableSync,
    isTestingConnection,
    testConnectionResult,
    clearTestResult,
    isConfiguring,
    getStatus: getSyncStatus,
    isSyncing,
  } = useSyncStore();

  const [showSyncConfig, setShowSyncConfig] = useState(false);
  const [syncServerUrl, setSyncServerUrl] = useState("");
  const [syncUsername, setSyncUsername] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncRemotePath, setSyncRemotePath] = useState("");
  const [syncMode, setSyncMode] = useState<SyncMode>("manual");
  const [syncError, setSyncError] = useState<string | null>(null);

  // Load sync status
  const loadSyncStatusData = useCallback(async () => {
    if (!notebook) return;
    try {
      await loadSyncStatus(notebook.id);
    } catch (e) {
      console.error("Failed to load sync status:", e);
    }
  }, [notebook, loadSyncStatus]);

  // Load git status
  const loadGitStatus = useCallback(async () => {
    if (!notebook) return;
    try {
      const enabled = await gitIsEnabled(notebook.id);
      setGitEnabled(enabled);
      if (enabled) {
        const status = await gitStatus(notebook.id);
        setGitStatusData(status);
        setRemoteUrl(status.remote_url || "");

        // Load branches
        const branchList = await gitListBranches(notebook.id);
        setBranches(branchList);

        // Check if we're in a merge state
        const merging = await gitIsMerging(notebook.id);
        setIsMerging(merging);
        if (merging) {
          setShowConflictDialog(true);
        }
      }
    } catch (e) {
      console.error("Failed to load git status:", e);
    }
  }, [notebook]);

  // Load cover page status
  const loadCoverStatus = useCallback(async () => {
    if (!notebook) return;
    try {
      const cover = await getCoverPage(notebook.id);
      setHasCoverPage(cover !== null);
    } catch (e) {
      console.error("Failed to load cover page status:", e);
    }
  }, [notebook]);

  // Reset form when notebook changes
  useEffect(() => {
    if (notebook) {
      setName(notebook.name);
      setColor(notebook.color);
      setSectionsEnabled(notebook.sectionsEnabled ?? false);
      setSystemPrompt(notebook.systemPrompt || "");
      setSystemPromptMode(notebook.systemPromptMode || "override");
      setAiProvider(notebook.aiProvider);
      setAiModel(notebook.aiModel);
      setUseAppDefault(!notebook.aiProvider);
      loadGitStatus();
      loadCoverStatus();
      loadSyncStatusData();
      // Initialize sync config form if already configured
      if (notebook.syncConfig) {
        setSyncServerUrl(notebook.syncConfig.serverUrl);
        setSyncRemotePath(notebook.syncConfig.remotePath);
        setSyncMode(notebook.syncConfig.syncMode);
      }
    }
  }, [notebook, loadGitStatus, loadCoverStatus, loadSyncStatusData]);

  // Focus name input when dialog opens
  useEffect(() => {
    if (isOpen && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    if (!notebook || !name.trim()) return;

    setIsSaving(true);
    try {
      await updateNotebook(notebook.id, {
        name: name.trim(),
        color: color || undefined,
        sectionsEnabled,
        systemPrompt: systemPrompt.trim() || undefined,
        systemPromptMode,
        aiProvider: useAppDefault ? undefined : aiProvider,
        aiModel: useAppDefault ? undefined : aiModel,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!notebook) return;

    await deleteNotebook(notebook.id);
    setShowDeleteConfirm(false);
    onClose();
  };

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !notebook) return null;

  const hasChanges =
    name !== notebook.name ||
    (color || null) !== (notebook.color || null) ||
    sectionsEnabled !== (notebook.sectionsEnabled ?? false) ||
    (systemPrompt || "") !== (notebook.systemPrompt || "") ||
    systemPromptMode !== (notebook.systemPromptMode || "override") ||
    (useAppDefault ? undefined : aiProvider) !== notebook.aiProvider ||
    (useAppDefault ? undefined : aiModel) !== notebook.aiModel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          maxHeight: "calc(100vh - 4rem)",
        }}
      >
        {/* Header */}
        <div
          className="flex flex-shrink-0 items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Notebook Settings
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <IconClose />
          </button>
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Notebook Name */}
          <div>
            <label
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Name
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Notebook name"
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Color */}
          <div>
            <label
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Color
            </label>
            <InlineColorPicker
              value={color}
              onChange={(c) => setColor(c)}
              showClear={true}
            />
          </div>

          {/* Sections Toggle */}
          <div
            className="flex items-center justify-between rounded-lg border p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div>
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Enable Sections
              </span>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Organize pages with tabs (like OneNote sections)
              </p>
            </div>
            <button
              onClick={() => setSectionsEnabled(!sectionsEnabled)}
              className="relative h-6 w-11 rounded-full transition-colors"
              style={{
                backgroundColor: sectionsEnabled
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              }}
            >
              <span
                className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                style={{
                  left: sectionsEnabled ? "calc(100% - 1.375rem)" : "0.125rem",
                }}
              />
            </button>
          </div>

          {/* Cover Page */}
          <div
            className="flex items-center justify-between rounded-lg border p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div>
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Cover Page
              </span>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {hasCoverPage
                  ? "Customize your notebook's cover page"
                  : "Add a styled entry page for this notebook"}
              </p>
            </div>
            {hasCoverPage ? (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: "rgba(34, 197, 94, 0.15)",
                  color: "rgb(34, 197, 94)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Created
              </span>
            ) : (
              <button
                onClick={async () => {
                  if (!notebook) return;
                  setIsCoverLoading(true);
                  try {
                    await createCoverPage(notebook.id);
                    setHasCoverPage(true);
                  } catch (e) {
                    console.error("Failed to create cover page:", e);
                  } finally {
                    setIsCoverLoading(false);
                  }
                }}
                disabled={isCoverLoading}
                className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                {isCoverLoading ? "Creating..." : "Create Cover"}
              </button>
            )}
          </div>

          {/* AI Model Settings */}
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconAI />
                <span
                  className="text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  AI Model
                </span>
              </div>
              <button
                onClick={() => {
                  setUseAppDefault(!useAppDefault);
                  if (!useAppDefault) {
                    // Switching back to app default
                    setAiProvider(undefined);
                    setAiModel(undefined);
                  } else {
                    // Switching to custom, initialize with app defaults
                    const activeProvider = getActiveProviderType();
                    setAiProvider(activeProvider as AIProviderType);
                    setAiModel(getActiveModel() || AI_MODELS[activeProvider as AIProviderType][0]);
                  }
                }}
                className="relative h-6 w-11 rounded-full transition-colors"
                style={{
                  backgroundColor: useAppDefault
                    ? "var(--color-bg-tertiary)"
                    : "var(--color-accent)",
                }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                  style={{
                    left: useAppDefault ? "0.125rem" : "calc(100% - 1.375rem)",
                  }}
                />
              </button>
            </div>

            {useAppDefault ? (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Using app default: <strong style={{ color: "var(--color-text-secondary)" }}>
                  {AI_PROVIDERS.find(p => p.value === appAISettings.defaultProvider)?.label || appAISettings.defaultProvider}
                </strong> / <strong style={{ color: "var(--color-text-secondary)" }}>
                  {appAISettings.defaultModel || "default"}
                </strong>
              </p>
            ) : (
              <div className="space-y-3">
                {/* Provider Selection */}
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    Provider
                  </label>
                  <select
                    value={aiProvider || ""}
                    onChange={(e) => {
                      const newProvider = e.target.value as AIProviderType;
                      setAiProvider(newProvider);
                      setAiModel(AI_MODELS[newProvider][0]);
                    }}
                    className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {AI_PROVIDERS.map((provider) => (
                      <option
                        key={provider.value}
                        value={provider.value}
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Model Selection */}
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    Model
                  </label>
                  <select
                    value={aiModel || ""}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {(aiProvider ? AI_MODELS[aiProvider] : []).map((model) => (
                      <option
                        key={model}
                        value={model}
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {model}
                      </option>
                    ))}
                  </select>
                </div>

                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  Override the AI model used for this notebook's chat sessions.
                </p>
              </div>
            )}
          </div>

          {/* System Prompt */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                AI System Prompt
              </label>
              {systemPrompt && (
                <button
                  onClick={() => setSystemPrompt("")}
                  className="text-xs transition-colors hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Custom AI system prompt for this notebook (optional). Leave empty to use the app default."
              rows={5}
              className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            {/* Mode toggle - only show if there's a prompt */}
            {systemPrompt && (
              <label className="mt-3 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={systemPromptMode === "concatenate"}
                  onChange={(e) => setSystemPromptMode(e.target.checked ? "concatenate" : "override")}
                  className="rounded"
                  style={{ accentColor: "var(--color-accent)" }}
                />
                <span
                  className="text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Append to app default prompt (instead of replacing)
                </span>
              </label>
            )}
            <p
              className="mt-1.5 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {systemPromptMode === "concatenate"
                ? "This prompt will be appended to the app default prompt."
                : "This prompt overrides the app default for all pages in this notebook, unless a page has its own custom prompt."}
            </p>
          </div>

          {/* Git Version Control */}
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconGit />
                <span
                  className="text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Version Control
                </span>
              </div>
              {!gitEnabled ? (
                <button
                  onClick={async () => {
                    if (!notebook) return;
                    setIsGitLoading(true);
                    setGitError(null);
                    try {
                      await gitInit(notebook.id);
                      await loadGitStatus();
                    } catch (e) {
                      setGitError(e instanceof Error ? e.message : "Failed to enable Git");
                    } finally {
                      setIsGitLoading(false);
                    }
                  }}
                  disabled={isGitLoading}
                  className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  {isGitLoading ? "Enabling..." : "Enable Git"}
                </button>
              ) : (
                <span
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(34, 197, 94, 0.15)",
                    color: "rgb(34, 197, 94)",
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Enabled
                </span>
              )}
            </div>

            {gitEnabled && gitStatusData && (
              <div className="space-y-3">
                {/* Merge in progress warning */}
                {isMerging && (
                  <div
                    className="flex items-center justify-between rounded-md px-3 py-2"
                    style={{
                      backgroundColor: "rgba(234, 179, 8, 0.15)",
                      border: "1px solid rgba(234, 179, 8, 0.3)",
                    }}
                  >
                    <span className="text-xs text-yellow-500">
                      ⚠ Merge in progress - resolve conflicts to continue
                    </span>
                    <button
                      onClick={() => setShowConflictDialog(true)}
                      className="rounded px-2 py-1 text-xs font-medium text-yellow-500 hover:bg-yellow-500/20"
                    >
                      Resolve Conflicts
                    </button>
                  </div>
                )}

                {/* Branch management */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Current branch dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                      className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      <IconBranch />
                      <span className="font-medium">{gitStatusData.branch || "main"}</span>
                      <IconChevron />
                    </button>

                    {showBranchDropdown && (
                      <div
                        className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-md border shadow-lg"
                        style={{
                          backgroundColor: "var(--color-bg-secondary)",
                          borderColor: "var(--color-border)",
                        }}
                      >
                        <div className="max-h-48 overflow-y-auto p-1">
                          {branches.map((branch) => (
                            <button
                              key={branch}
                              onClick={async () => {
                                if (!notebook || branch === gitStatusData.branch) {
                                  setShowBranchDropdown(false);
                                  return;
                                }
                                setIsGitLoading(true);
                                setGitError(null);
                                try {
                                  await gitSwitchBranch(notebook.id, branch);
                                  await loadGitStatus();
                                } catch (e) {
                                  setGitError(e instanceof Error ? e.message : "Failed to switch branch");
                                } finally {
                                  setIsGitLoading(false);
                                  setShowBranchDropdown(false);
                                }
                              }}
                              className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
                              style={{ color: "var(--color-text-primary)" }}
                            >
                              <span>{branch}</span>
                              {branch === gitStatusData.branch && (
                                <span className="text-green-500">✓</span>
                              )}
                            </button>
                          ))}
                        </div>
                        <div
                          className="border-t p-1"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <button
                            onClick={() => {
                              setShowBranchDropdown(false);
                              setShowNewBranchInput(true);
                            }}
                            className="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
                            style={{ color: "var(--color-accent)" }}
                          >
                            <IconPlus /> New Branch
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* New branch input */}
                  {showNewBranchInput && (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        placeholder="branch-name"
                        autoFocus
                        className="rounded-md border px-2 py-1 text-xs outline-none focus:border-[--color-accent]"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                          width: "120px",
                        }}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter" && newBranchName.trim() && notebook) {
                            setIsGitLoading(true);
                            try {
                              await gitCreateBranch(notebook.id, newBranchName.trim());
                              await gitSwitchBranch(notebook.id, newBranchName.trim());
                              await loadGitStatus();
                              setNewBranchName("");
                              setShowNewBranchInput(false);
                            } catch (err) {
                              setGitError(err instanceof Error ? err.message : "Failed to create branch");
                            } finally {
                              setIsGitLoading(false);
                            }
                          } else if (e.key === "Escape") {
                            setNewBranchName("");
                            setShowNewBranchInput(false);
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          setNewBranchName("");
                          setShowNewBranchInput(false);
                        }}
                        className="rounded p-1 text-xs hover:bg-white/10"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {/* Merge branch dropdown */}
                  {branches.length > 1 && !isMerging && (
                    <div className="relative">
                      <button
                        onClick={() => setShowMergeDropdown(!showMergeDropdown)}
                        disabled={isGitLoading}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        <IconMerge /> Merge
                      </button>

                      {showMergeDropdown && (
                        <div
                          className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-md border shadow-lg"
                          style={{
                            backgroundColor: "var(--color-bg-secondary)",
                            borderColor: "var(--color-border)",
                          }}
                        >
                          <div className="p-1">
                            <p
                              className="px-2.5 py-1 text-xs"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              Merge into {gitStatusData.branch}:
                            </p>
                            {branches
                              .filter((b) => b !== gitStatusData.branch)
                              .map((branch) => (
                                <button
                                  key={branch}
                                  onClick={async () => {
                                    if (!notebook) return;
                                    setShowMergeDropdown(false);
                                    setIsGitLoading(true);
                                    setGitError(null);
                                    try {
                                      const result: MergeResult = await gitMergeBranch(
                                        notebook.id,
                                        branch
                                      );
                                      if (result.hasConflicts) {
                                        setIsMerging(true);
                                        setShowConflictDialog(true);
                                      } else {
                                        await loadGitStatus();
                                      }
                                    } catch (e) {
                                      setGitError(
                                        e instanceof Error ? e.message : "Merge failed"
                                      );
                                    } finally {
                                      setIsGitLoading(false);
                                    }
                                  }}
                                  className="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
                                  style={{ color: "var(--color-text-primary)" }}
                                >
                                  <IconBranch /> {branch}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Delete branch (only if not current and more than 1 branch) */}
                  {branches.length > 1 && (
                    <div className="relative">
                      <select
                        onChange={async (e) => {
                          const branchToDelete = e.target.value;
                          if (!branchToDelete || !notebook) return;
                          if (
                            !confirm(
                              `Delete branch "${branchToDelete}"? This cannot be undone.`
                            )
                          ) {
                            e.target.value = "";
                            return;
                          }
                          setIsGitLoading(true);
                          setGitError(null);
                          try {
                            await gitDeleteBranch(notebook.id, branchToDelete);
                            await loadGitStatus();
                          } catch (err) {
                            setGitError(
                              err instanceof Error ? err.message : "Failed to delete branch"
                            );
                          } finally {
                            setIsGitLoading(false);
                            e.target.value = "";
                          }
                        }}
                        className="rounded-md border px-2 py-1.5 text-xs outline-none"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-muted)",
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Delete branch...
                        </option>
                        {branches
                          .filter((b) => b !== gitStatusData.branch)
                          .map((branch) => (
                            <option key={branch} value={branch}>
                              {branch}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {/* Status indicators */}
                  <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {gitStatusData.is_dirty ? (
                      <span className="text-yellow-500">● Uncommitted</span>
                    ) : (
                      <span className="text-green-500">● Clean</span>
                    )}
                    {gitStatusData.ahead > 0 && (
                      <span>↑{gitStatusData.ahead}</span>
                    )}
                    {gitStatusData.behind > 0 && (
                      <span>↓{gitStatusData.behind}</span>
                    )}
                  </div>
                </div>

                {/* Last commit */}
                {gitStatusData.last_commit && (
                  <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Last commit: <span style={{ color: "var(--color-text-secondary)" }}>{gitStatusData.last_commit.message}</span>
                    <span className="ml-2 opacity-60">({gitStatusData.last_commit.short_id})</span>
                  </div>
                )}

                {/* Remote URL */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Remote URL (optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="https://github.com/user/repo.git"
                      className="flex-1 rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-primary)",
                      }}
                    />
                    <button
                      onClick={async () => {
                        if (!notebook) return;
                        setIsGitLoading(true);
                        setGitError(null);
                        try {
                          if (remoteUrl.trim()) {
                            await gitSetRemote(notebook.id, remoteUrl.trim());
                          } else {
                            await gitRemoveRemote(notebook.id);
                          }
                          await loadGitStatus();
                        } catch (e) {
                          setGitError(e instanceof Error ? e.message : "Failed to set remote");
                        } finally {
                          setIsGitLoading(false);
                        }
                      }}
                      disabled={isGitLoading}
                      className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>

                {/* Push/Pull buttons */}
                {gitStatusData.has_remote && (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!notebook) return;
                        setIsGitLoading(true);
                        setGitError(null);
                        try {
                          await gitPull(notebook.id);
                          await loadGitStatus();
                        } catch (e) {
                          setGitError(e instanceof Error ? e.message : "Pull failed");
                        } finally {
                          setIsGitLoading(false);
                        }
                      }}
                      disabled={isGitLoading}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      <IconDownload /> Pull
                    </button>
                    <button
                      onClick={async () => {
                        if (!notebook) return;
                        setIsGitLoading(true);
                        setGitError(null);
                        try {
                          await gitPush(notebook.id);
                          await loadGitStatus();
                        } catch (e) {
                          setGitError(e instanceof Error ? e.message : "Push failed");
                        } finally {
                          setIsGitLoading(false);
                        }
                      }}
                      disabled={isGitLoading}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      <IconUpload /> Push
                    </button>
                  </div>
                )}

                {/* Error message */}
                {gitError && (
                  <p className="text-xs" style={{ color: "var(--color-error)" }}>
                    {gitError}
                  </p>
                )}
              </div>
            )}

            {!gitEnabled && (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Enable Git to track page history, sync to remote repositories, and restore previous versions.
              </p>
            )}
          </div>

          {/* Cloud Sync */}
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconCloud />
                <span
                  className="text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Cloud Sync
                </span>
              </div>
              {notebook?.syncConfig?.enabled ? (
                <span
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(34, 197, 94, 0.15)",
                    color: "rgb(34, 197, 94)",
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Enabled
                </span>
              ) : (
                <button
                  onClick={() => setShowSyncConfig(!showSyncConfig)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  Configure
                </button>
              )}
            </div>

            {/* Sync configuration form */}
            {showSyncConfig && !notebook?.syncConfig?.enabled && (
              <div className="space-y-3">
                {/* Server URL */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    WebDAV Server URL
                  </label>
                  <input
                    type="text"
                    value={syncServerUrl}
                    onChange={(e) => setSyncServerUrl(e.target.value)}
                    placeholder="https://cloud.example.com/remote.php/dav/files/user/"
                    className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>

                {/* Remote Path */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Remote Path
                  </label>
                  <input
                    type="text"
                    value={syncRemotePath}
                    onChange={(e) => setSyncRemotePath(e.target.value)}
                    placeholder="/katt-sync/my-notebook"
                    className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>

                {/* Username */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Username
                  </label>
                  <input
                    type="text"
                    value={syncUsername}
                    onChange={(e) => setSyncUsername(e.target.value)}
                    placeholder="username"
                    className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Password / App Token
                  </label>
                  <input
                    type="password"
                    value={syncPassword}
                    onChange={(e) => setSyncPassword(e.target.value)}
                    placeholder="password"
                    className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>

                {/* Sync Mode */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Sync Mode
                  </label>
                  <select
                    value={syncMode}
                    onChange={(e) => setSyncMode(e.target.value as SyncMode)}
                    className="w-full rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
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

                {/* Test Connection + Enable buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setSyncError(null);
                      const result = await testConnection(syncServerUrl, syncUsername, syncPassword);
                      if (!result) {
                        setSyncError("Connection failed. Check your URL and credentials.");
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
                      if (!notebook) return;
                      setSyncError(null);
                      try {
                        await configureSync(notebook.id, {
                          serverUrl: syncServerUrl,
                          remotePath: syncRemotePath || `/katt-sync/${notebook.id}`,
                          username: syncUsername,
                          password: syncPassword,
                          authType: "basic" as AuthType,
                          syncMode,
                        });
                        setShowSyncConfig(false);
                        clearTestResult();
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

                {/* Test result / Error */}
                {testConnectionResult === true && (
                  <p className="text-xs text-green-500">Connection successful!</p>
                )}
                {syncError && (
                  <p className="text-xs" style={{ color: "var(--color-error)" }}>{syncError}</p>
                )}
              </div>
            )}

            {/* Sync enabled - show status and controls */}
            {notebook?.syncConfig?.enabled && (
              <div className="space-y-3">
                {/* Status */}
                <div className="flex items-center gap-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  <span>
                    Mode: <strong style={{ color: "var(--color-text-primary)" }}>
                      {notebook.syncConfig.syncMode === "manual" ? "Manual" :
                       notebook.syncConfig.syncMode === "onsave" ? "On Save" : "Periodic"}
                    </strong>
                  </span>
                  {getSyncStatus(notebook.id)?.pendingChanges ? (
                    <span className="text-yellow-500">
                      {getSyncStatus(notebook.id)?.pendingChanges} pending
                    </span>
                  ) : (
                    <span className="text-green-500">Up to date</span>
                  )}
                </div>

                {/* Last sync */}
                {notebook.syncConfig.lastSync && (
                  <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Last sync: <span style={{ color: "var(--color-text-secondary)" }}>
                      {new Date(notebook.syncConfig.lastSync).toLocaleString()}
                    </span>
                  </div>
                )}

                {/* Sync Now + Disable buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!notebook) return;
                      setSyncError(null);
                      try {
                        await triggerSync(notebook.id);
                      } catch (e) {
                        setSyncError(e instanceof Error ? e.message : "Sync failed");
                      }
                    }}
                    disabled={isSyncing(notebook.id)}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    <IconSync spinning={isSyncing(notebook.id)} />
                    {isSyncing(notebook.id) ? "Syncing..." : "Sync Now"}
                  </button>
                  <button
                    onClick={async () => {
                      if (!notebook) return;
                      if (confirm("Disable cloud sync for this notebook? Local data will be preserved.")) {
                        try {
                          await disableSync(notebook.id);
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

                {/* Error message */}
                {syncError && (
                  <p className="text-xs" style={{ color: "var(--color-error)" }}>{syncError}</p>
                )}
              </div>
            )}

            {!notebook?.syncConfig?.enabled && !showSyncConfig && (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Sync this notebook to a WebDAV server (Nextcloud, ownCloud, etc.) for offline access and multi-device sync.
              </p>
            )}
          </div>

          {/* Info */}
          <div
            className="flex items-start gap-2 rounded-lg border p-3"
            style={{
              backgroundColor: "rgba(139, 92, 246, 0.05)",
              borderColor: "rgba(139, 92, 246, 0.2)",
            }}
          >
            <IconInfo />
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              <strong>Prompt inheritance:</strong> Page prompt → Notebook prompt → App default.
              When you chat with AI, the most specific prompt is used.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex flex-shrink-0 items-center justify-between border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-red-500/10"
            style={{ color: "var(--color-error)" }}
          >
            Delete Notebook
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || isSaving || !hasChanges}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{
                background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
              }}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDeleteConfirm(false);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
            }}
          >
            <h3
              className="mb-2 text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Delete Notebook
            </h3>
            <p
              className="mb-6 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Are you sure you want to delete "{notebook.name}"? This will permanently
              delete all pages in this notebook. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: "var(--color-error)" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git Conflict Resolution Dialog */}
      {notebook && (
        <GitConflictDialog
          isOpen={showConflictDialog}
          onClose={() => {
            setShowConflictDialog(false);
            loadGitStatus();
          }}
          notebookId={notebook.id}
          onResolved={() => {
            setIsMerging(false);
            loadGitStatus();
          }}
        />
      )}
    </div>
  );
}

function IconClose() {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 1 }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function IconGit() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
      <path d="M12 12v3" />
    </svg>
  );
}

function IconDownload() {
  return (
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconUpload() {
  return (
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconAI() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
    </svg>
  );
}

function IconCloud() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function IconSync({ spinning = false }: { spinning?: boolean }) {
  return (
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
      style={spinning ? { animation: "spin 1s linear infinite" } : undefined}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function IconBranch() {
  return (
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
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function IconChevron() {
  return (
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconPlus() {
  return (
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconMerge() {
  return (
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
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}
