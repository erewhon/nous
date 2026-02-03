import { useState, useEffect } from "react";
import { useGoalsStore } from "../../stores/goalsStore";
import { useNotebookStore } from "../../stores/notebookStore";
import * as api from "../../utils/api";
import type { Section } from "../../types/page";
import type {
  Frequency,
  TrackingType,
  AutoDetectType,
  AutoDetectScope,
  AutoDetectCheck,
  CheckCombineMode,
  CreateGoalRequest,
} from "../../types/goals";

// Local check state (without id, which is generated on save)
interface CheckState {
  localId: string;
  type: AutoDetectType;
  scopeType: "global" | "library" | "notebook" | "section";
  notebookId: string;
  sectionId: string;
  repoPaths: string[];
  youtubeChannelId: string;
  threshold: number;
}

function createEmptyCheck(): CheckState {
  return {
    localId: crypto.randomUUID(),
    type: "page_edit",
    scopeType: "global",
    notebookId: "",
    sectionId: "",
    repoPaths: [],
    youtubeChannelId: "",
    threshold: 1,
  };
}

// Get display name for check type
function getCheckTypeName(type: AutoDetectType): string {
  switch (type) {
    case "page_edit": return "Page edits";
    case "page_create": return "Page creates";
    case "git_commit": return "Git commits";
    case "jj_commit": return "Jujutsu commits";
    case "youtube_publish": return "YouTube publish";
    default: return type;
  }
}

interface CheckEditorProps {
  check: CheckState;
  checkIndex: number;
  notebooks: { id: string; name: string; icon?: string; archived?: boolean }[];
  sectionsMap: Record<string, Section[]>;
  canDelete: boolean;
  onUpdate: (updates: Partial<CheckState>) => void;
  onDelete: () => void;
}

function CheckEditor({
  check,
  checkIndex,
  notebooks,
  sectionsMap,
  canDelete,
  onUpdate,
  onDelete,
}: CheckEditorProps) {
  const [newRepoPath, setNewRepoPath] = useState("");
  const sections = sectionsMap[check.notebookId] || [];

  return (
    <div
      className="rounded-lg border p-3 space-y-3"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header with delete button */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-medium"
          style={{ color: "var(--color-text-muted)" }}
        >
          Check {checkIndex + 1}: {getCheckTypeName(check.type)}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-text-muted)" }}
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
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Check type selector */}
      <div>
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-text-muted)" }}
        >
          Detect
        </label>
        <select
          value={check.type}
          onChange={(e) => onUpdate({ type: e.target.value as AutoDetectType })}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          <option value="page_edit">Page edits</option>
          <option value="page_create">Page creates</option>
          <option value="git_commit">Git commits</option>
          <option value="jj_commit">Jujutsu (jj) commits</option>
          <option value="youtube_publish">YouTube video/livestream</option>
        </select>
      </div>

      {/* YouTube channel ID */}
      {check.type === "youtube_publish" && (
        <div>
          <label
            className="block text-xs font-medium mb-1"
            style={{ color: "var(--color-text-muted)" }}
          >
            YouTube Channel ID
          </label>
          <input
            type="text"
            value={check.youtubeChannelId}
            onChange={(e) => onUpdate({ youtubeChannelId: e.target.value })}
            placeholder="UCxxxxxxxxxxxxxxxx"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>
      )}

      {/* Repository paths */}
      {(check.type === "git_commit" || check.type === "jj_commit") && (
        <div>
          <label
            className="block text-xs font-medium mb-1"
            style={{ color: "var(--color-text-muted)" }}
          >
            Repository paths
          </label>
          {check.repoPaths.length > 0 && (
            <div className="space-y-1 mb-2">
              {check.repoPaths.map((path, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  <span className="flex-1 truncate">{path}</span>
                  <button
                    type="button"
                    onClick={() => onUpdate({
                      repoPaths: check.repoPaths.filter((_, i) => i !== index)
                    })}
                    className="p-0.5 rounded hover:bg-white/10 transition-colors"
                    style={{ color: "var(--color-text-muted)" }}
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
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newRepoPath}
              onChange={(e) => setNewRepoPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newRepoPath.trim()) {
                  e.preventDefault();
                  onUpdate({ repoPaths: [...check.repoPaths, newRepoPath.trim()] });
                  setNewRepoPath("");
                }
              }}
              placeholder="/path/to/repo"
              className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (newRepoPath.trim()) {
                  onUpdate({ repoPaths: [...check.repoPaths, newRepoPath.trim()] });
                  setNewRepoPath("");
                }
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Scope selector for page edits/creates */}
      {(check.type === "page_edit" || check.type === "page_create") && (
        <>
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Scope
            </label>
            <select
              value={check.scopeType}
              onChange={(e) => {
                const newType = e.target.value as "global" | "notebook" | "section";
                onUpdate({
                  scopeType: newType,
                  notebookId: newType === "global" ? "" : check.notebookId,
                  sectionId: "",
                });
              }}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="global">All notebooks</option>
              <option value="notebook">Specific notebook</option>
              <option value="section">Specific section</option>
            </select>
          </div>

          {(check.scopeType === "notebook" || check.scopeType === "section") && (
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "var(--color-text-muted)" }}
              >
                Notebook
              </label>
              <select
                value={check.notebookId}
                onChange={(e) => onUpdate({ notebookId: e.target.value, sectionId: "" })}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                <option value="">Select a notebook...</option>
                {notebooks
                  .filter((nb) => !nb.archived)
                  .map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.icon ? `${nb.icon} ` : ""}{nb.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {check.scopeType === "section" && check.notebookId && sections.length > 0 && (
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "var(--color-text-muted)" }}
              >
                Section
              </label>
              <select
                value={check.sectionId}
                onChange={(e) => onUpdate({ sectionId: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                <option value="">Select a section...</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {check.scopeType === "section" && check.notebookId && sections.length === 0 && (
            <p
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              This notebook has no sections
            </p>
          )}
        </>
      )}

      {/* Threshold */}
      <div>
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-text-muted)" }}
        >
          Minimum count
        </label>
        <input
          type="number"
          min="1"
          value={check.threshold}
          onChange={(e) => onUpdate({ threshold: parseInt(e.target.value) || 1 })}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
    </div>
  );
}

export function GoalEditor() {
  const { isEditorOpen, editingGoal, closeEditor, createGoal, updateGoal } =
    useGoalsStore();
  const { notebooks, loadNotebooks } = useNotebookStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [trackingType, setTrackingType] = useState<TrackingType>("manual");
  const [checks, setChecks] = useState<CheckState[]>([createEmptyCheck()]);
  const [combineMode, setCombineMode] = useState<CheckCombineMode>("any");
  const [sectionsMap, setSectionsMap] = useState<Record<string, Section[]>>({});
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load notebooks when editor opens
  useEffect(() => {
    if (isEditorOpen) {
      loadNotebooks();
    }
  }, [isEditorOpen, loadNotebooks]);

  // Load sections for notebooks used in checks
  useEffect(() => {
    const notebookIds = checks
      .filter((c) => (c.scopeType === "notebook" || c.scopeType === "section") && c.notebookId)
      .map((c) => c.notebookId);

    const uniqueIds = [...new Set(notebookIds)];

    uniqueIds.forEach((notebookId) => {
      if (!sectionsMap[notebookId]) {
        api.listSections(notebookId).then((sections) => {
          setSectionsMap((prev) => ({ ...prev, [notebookId]: sections }));
        }).catch(() => {
          setSectionsMap((prev) => ({ ...prev, [notebookId]: [] }));
        });
      }
    });
  }, [checks, sectionsMap]);

  // Reset form when editing goal changes
  useEffect(() => {
    if (editingGoal) {
      setName(editingGoal.name);
      setDescription(editingGoal.description || "");
      setFrequency(editingGoal.frequency);
      setTrackingType(editingGoal.trackingType);
      if (editingGoal.autoDetect) {
        setCombineMode(editingGoal.autoDetect.combineMode || "any");

        // Handle new checks format
        if (editingGoal.autoDetect.checks && editingGoal.autoDetect.checks.length > 0) {
          setChecks(editingGoal.autoDetect.checks.map((check: AutoDetectCheck) => ({
            localId: check.id || crypto.randomUUID(),
            type: check.type,
            scopeType: check.scope.type as "global" | "library" | "notebook" | "section",
            notebookId: check.scope.type === "notebook" ? check.scope.id :
                       check.scope.type === "section" ? check.scope.notebookId : "",
            sectionId: check.scope.type === "section" ? check.scope.sectionId : "",
            repoPaths: check.repoPaths || (check.repoPath ? [check.repoPath] : []),
            youtubeChannelId: check.youtubeChannelId || "",
            threshold: check.threshold || 1,
          })));
        }
        // Handle legacy single-check format
        else if (editingGoal.autoDetect.type && editingGoal.autoDetect.scope) {
          const scope = editingGoal.autoDetect.scope;
          const paths = editingGoal.autoDetect.repoPaths?.length
            ? editingGoal.autoDetect.repoPaths
            : editingGoal.autoDetect.repoPath
              ? [editingGoal.autoDetect.repoPath]
              : [];
          setChecks([{
            localId: crypto.randomUUID(),
            type: editingGoal.autoDetect.type,
            scopeType: scope.type as "global" | "library" | "notebook" | "section",
            notebookId: scope.type === "notebook" ? scope.id :
                       scope.type === "section" ? scope.notebookId : "",
            sectionId: scope.type === "section" ? scope.sectionId : "",
            repoPaths: paths,
            youtubeChannelId: editingGoal.autoDetect.youtubeChannelId || "",
            threshold: editingGoal.autoDetect.threshold || 1,
          }]);
        } else {
          setChecks([createEmptyCheck()]);
        }
      } else {
        setChecks([createEmptyCheck()]);
        setCombineMode("any");
      }
      if (editingGoal.reminder) {
        setReminderEnabled(editingGoal.reminder.enabled);
        setReminderTime(editingGoal.reminder.time);
      } else {
        setReminderEnabled(false);
        setReminderTime("09:00");
      }
    } else {
      // Reset to defaults for new goal
      setName("");
      setDescription("");
      setFrequency("daily");
      setTrackingType("manual");
      setChecks([createEmptyCheck()]);
      setCombineMode("any");
      setSectionsMap({});
      setReminderEnabled(false);
      setReminderTime("09:00");
    }
    setError(null);
  }, [editingGoal, isEditorOpen]);

  // Helper to convert check state to scope
  const checkStateToScope = (check: CheckState): AutoDetectScope => {
    if (check.scopeType === "global") {
      return { type: "global" };
    } else if (check.scopeType === "notebook") {
      return { type: "notebook", id: check.notebookId };
    } else if (check.scopeType === "section") {
      return { type: "section", notebookId: check.notebookId, sectionId: check.sectionId };
    } else {
      return { type: "library", id: check.notebookId };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    // Validate checks when auto tracking
    if (trackingType === "auto") {
      for (const check of checks) {
        if ((check.type === "git_commit" || check.type === "jj_commit") && check.repoPaths.length === 0) {
          setError("Repository path is required for commit tracking");
          return;
        }
        if (check.type === "youtube_publish" && !check.youtubeChannelId) {
          setError("YouTube channel ID is required for YouTube tracking");
          return;
        }
        if ((check.scopeType === "notebook" || check.scopeType === "section") && !check.notebookId) {
          setError("Please select a notebook");
          return;
        }
        if (check.scopeType === "section" && !check.sectionId) {
          setError("Please select a section");
          return;
        }
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Convert check states to API format
      const autoDetectChecks = checks.map((check) => ({
        id: check.localId,
        type: check.type,
        scope: checkStateToScope(check),
        repoPaths: (check.type === "git_commit" || check.type === "jj_commit") ? check.repoPaths : [],
        youtubeChannelId: check.type === "youtube_publish" ? check.youtubeChannelId : undefined,
        threshold: check.threshold > 1 ? check.threshold : undefined,
      }));

      const request: CreateGoalRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        frequency,
        trackingType,
        autoDetect:
          trackingType === "auto"
            ? {
                checks: autoDetectChecks,
                combineMode,
              }
            : undefined,
        reminder: reminderEnabled
          ? { enabled: true, time: reminderTime }
          : undefined,
      };

      if (editingGoal) {
        await updateGoal(editingGoal.id, request);
      } else {
        await createGoal(request);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle keyboard events
  useEffect(() => {
    if (!isEditorOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeEditor();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditorOpen, closeEditor]);

  if (!isEditorOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeEditor();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            {editingGoal ? "Edit Goal" : "New Goal"}
          </h2>
          <button
            onClick={closeEditor}
            className="rounded p-1.5 transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
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

        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Error */}
            {error && (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  color: "var(--color-error)",
                }}
              >
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Write daily"
                className="w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Write at least 500 words"
                className="w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

            {/* Frequency */}
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Frequency
              </label>
              <div className="flex gap-2">
                {(["daily", "weekly", "monthly"] as Frequency[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequency(f)}
                    className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    style={{
                      backgroundColor:
                        frequency === f
                          ? "var(--color-accent)"
                          : "var(--color-bg-tertiary)",
                      color: frequency === f ? "white" : "var(--color-text-secondary)",
                    }}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Tracking Type */}
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Tracking
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTrackingType("manual")}
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor:
                      trackingType === "manual"
                        ? "var(--color-accent)"
                        : "var(--color-bg-tertiary)",
                    color:
                      trackingType === "manual" ? "white" : "var(--color-text-secondary)",
                  }}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => setTrackingType("auto")}
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor:
                      trackingType === "auto"
                        ? "var(--color-accent)"
                        : "var(--color-bg-tertiary)",
                    color:
                      trackingType === "auto" ? "white" : "var(--color-text-secondary)",
                  }}
                >
                  Auto-detect
                </button>
              </div>
            </div>

            {/* Auto-detect options */}
            {trackingType === "auto" && (
              <div
                className="space-y-3 rounded-lg p-3"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                {/* List of checks */}
                {checks.map((check, checkIndex) => (
                  <CheckEditor
                    key={check.localId}
                    check={check}
                    checkIndex={checkIndex}
                    notebooks={notebooks}
                    sectionsMap={sectionsMap}
                    canDelete={checks.length > 1}
                    onUpdate={(updates) => {
                      setChecks(checks.map((c, i) =>
                        i === checkIndex ? { ...c, ...updates } : c
                      ));
                    }}
                    onDelete={() => {
                      setChecks(checks.filter((_, i) => i !== checkIndex));
                    }}
                  />
                ))}

                {/* Add check button */}
                <button
                  type="button"
                  onClick={() => setChecks([...checks, createEmptyCheck()])}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-white/5"
                  style={{ color: "var(--color-accent)" }}
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
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add check
                </button>

                {/* Combine mode (only show if multiple checks) */}
                {checks.length > 1 && (
                  <div
                    className="border-t pt-3"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <label
                      className="block text-xs font-medium mb-2"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Combine mode
                    </label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="combineMode"
                          checked={combineMode === "any"}
                          onChange={() => setCombineMode("any")}
                          className="h-3.5 w-3.5 accent-violet-500"
                        />
                        <span
                          className="text-xs"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          Any passes (OR)
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="combineMode"
                          checked={combineMode === "all"}
                          onChange={() => setCombineMode("all")}
                          className="h-3.5 w-3.5 accent-violet-500"
                        />
                        <span
                          className="text-xs"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          All pass (AND)
                        </span>
                      </label>
                    </div>
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {combineMode === "any"
                        ? "Goal completes if any check passes"
                        : "Goal completes only if all checks pass"}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Reminder */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => setReminderEnabled(e.target.checked)}
                  className="h-4 w-4 rounded accent-violet-500"
                />
                <span
                  className="text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Enable reminder
                </span>
              </label>
              {reminderEnabled && (
                <input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="mt-2 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              )}
            </div>
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-2 border-t px-4 py-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              {isSubmitting ? "Saving..." : editingGoal ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
