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
  CreateGoalRequest,
} from "../../types/goals";

export function GoalEditor() {
  const { isEditorOpen, editingGoal, closeEditor, createGoal, updateGoal } =
    useGoalsStore();
  const { notebooks, loadNotebooks } = useNotebookStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [trackingType, setTrackingType] = useState<TrackingType>("manual");
  const [autoDetectType, setAutoDetectType] = useState<AutoDetectType>("page_edit");
  const [scopeType, setScopeType] = useState<"global" | "library" | "notebook" | "section">("global");
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>("");
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [sections, setSections] = useState<Section[]>([]);
  const [repoPaths, setRepoPaths] = useState<string[]>([]);
  const [newRepoPath, setNewRepoPath] = useState("");
  const [youtubeChannelId, setYoutubeChannelId] = useState("");
  const [threshold, setThreshold] = useState(1);
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

  // Load sections when notebook is selected
  useEffect(() => {
    if (selectedNotebookId && (scopeType === "notebook" || scopeType === "section")) {
      api.listSections(selectedNotebookId).then(setSections).catch(() => setSections([]));
    } else {
      setSections([]);
      setSelectedSectionId("");
    }
  }, [selectedNotebookId, scopeType]);

  // Reset form when editing goal changes
  useEffect(() => {
    if (editingGoal) {
      setName(editingGoal.name);
      setDescription(editingGoal.description || "");
      setFrequency(editingGoal.frequency);
      setTrackingType(editingGoal.trackingType);
      if (editingGoal.autoDetect) {
        setAutoDetectType(editingGoal.autoDetect.type);
        const scope = editingGoal.autoDetect.scope;
        setScopeType(scope.type);
        if (scope.type === "notebook") {
          setSelectedNotebookId(scope.id);
          setSelectedSectionId("");
        } else if (scope.type === "section") {
          setSelectedNotebookId(scope.notebookId);
          setSelectedSectionId(scope.sectionId);
        } else {
          setSelectedNotebookId("");
          setSelectedSectionId("");
        }
        // Handle both legacy repoPath and new repoPaths
        const paths = editingGoal.autoDetect.repoPaths?.length
          ? editingGoal.autoDetect.repoPaths
          : editingGoal.autoDetect.repoPath
            ? [editingGoal.autoDetect.repoPath]
            : [];
        setRepoPaths(paths);
        setNewRepoPath("");
        setYoutubeChannelId(editingGoal.autoDetect.youtubeChannelId || "");
        setThreshold(editingGoal.autoDetect.threshold || 1);
      }
      if (editingGoal.reminder) {
        setReminderEnabled(editingGoal.reminder.enabled);
        setReminderTime(editingGoal.reminder.time);
      }
    } else {
      // Reset to defaults for new goal
      setName("");
      setDescription("");
      setFrequency("daily");
      setTrackingType("manual");
      setAutoDetectType("page_edit");
      setScopeType("global");
      setSelectedNotebookId("");
      setSelectedSectionId("");
      setSections([]);
      setRepoPaths([]);
      setNewRepoPath("");
      setYoutubeChannelId("");
      setThreshold(1);
      setReminderEnabled(false);
      setReminderTime("09:00");
    }
    setError(null);
  }, [editingGoal, isEditorOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      let scope: AutoDetectScope;
      if (scopeType === "global") {
        scope = { type: "global" };
      } else if (scopeType === "notebook") {
        scope = { type: "notebook", id: selectedNotebookId };
      } else if (scopeType === "section") {
        scope = { type: "section", notebookId: selectedNotebookId, sectionId: selectedSectionId };
      } else {
        scope = { type: "library", id: selectedNotebookId };
      }

      const request: CreateGoalRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        frequency,
        trackingType,
        autoDetect:
          trackingType === "auto"
            ? {
                type: autoDetectType,
                scope,
                repoPaths: (autoDetectType === "git_commit" || autoDetectType === "jj_commit") ? repoPaths : [],
                youtubeChannelId: autoDetectType === "youtube_publish" ? youtubeChannelId : undefined,
                threshold: threshold > 1 ? threshold : undefined,
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
                <div>
                  <label
                    className="block text-xs font-medium mb-1"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Detect
                  </label>
                  <select
                    value={autoDetectType}
                    onChange={(e) => setAutoDetectType(e.target.value as AutoDetectType)}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
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

                {autoDetectType === "youtube_publish" && (
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      YouTube Channel ID
                    </label>
                    <input
                      type="text"
                      value={youtubeChannelId}
                      onChange={(e) => setYoutubeChannelId(e.target.value)}
                      placeholder="UCxxxxxxxxxxxxxxxx"
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-primary)",
                      }}
                    />
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Find your channel ID in YouTube Studio under Settings &gt; Channel &gt; Basic info
                    </p>
                  </div>
                )}

                {(autoDetectType === "git_commit" || autoDetectType === "jj_commit") && (
                  <div>
                    <label
                      className="block text-xs font-medium mb-1"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Repository paths
                    </label>
                    {/* List of added paths */}
                    {repoPaths.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {repoPaths.map((path, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
                            style={{
                              backgroundColor: "var(--color-bg-secondary)",
                              color: "var(--color-text-primary)",
                            }}
                          >
                            <span className="flex-1 truncate">{path}</span>
                            <button
                              type="button"
                              onClick={() => setRepoPaths(repoPaths.filter((_, i) => i !== index))}
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
                    {/* Add new path */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newRepoPath}
                        onChange={(e) => setNewRepoPath(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newRepoPath.trim()) {
                            e.preventDefault();
                            setRepoPaths([...repoPaths, newRepoPath.trim()]);
                            setNewRepoPath("");
                          }
                        }}
                        placeholder="/path/to/repo"
                        className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none"
                        style={{
                          backgroundColor: "var(--color-bg-secondary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newRepoPath.trim()) {
                            setRepoPaths([...repoPaths, newRepoPath.trim()]);
                            setNewRepoPath("");
                          }
                        }}
                        className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                        style={{
                          backgroundColor: "var(--color-bg-secondary)",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        Add
                      </button>
                    </div>
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Commits are counted across all repos
                    </p>
                  </div>
                )}

                {autoDetectType !== "git_commit" && autoDetectType !== "jj_commit" && autoDetectType !== "youtube_publish" && (
                  <>
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Scope
                      </label>
                      <select
                        value={scopeType}
                        onChange={(e) => {
                          const newType = e.target.value as "global" | "notebook" | "section";
                          setScopeType(newType);
                          if (newType === "global") {
                            setSelectedNotebookId("");
                            setSelectedSectionId("");
                          }
                        }}
                        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                        style={{
                          backgroundColor: "var(--color-bg-secondary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      >
                        <option value="global">All notebooks</option>
                        <option value="notebook">Specific notebook</option>
                        <option value="section">Specific section</option>
                      </select>
                    </div>

                    {(scopeType === "notebook" || scopeType === "section") && (
                      <div>
                        <label
                          className="block text-xs font-medium mb-1"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          Notebook
                        </label>
                        <select
                          value={selectedNotebookId}
                          onChange={(e) => {
                            setSelectedNotebookId(e.target.value);
                            setSelectedSectionId("");
                          }}
                          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                          style={{
                            backgroundColor: "var(--color-bg-secondary)",
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

                    {scopeType === "section" && selectedNotebookId && sections.length > 0 && (
                      <div>
                        <label
                          className="block text-xs font-medium mb-1"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          Section
                        </label>
                        <select
                          value={selectedSectionId}
                          onChange={(e) => setSelectedSectionId(e.target.value)}
                          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                          style={{
                            backgroundColor: "var(--color-bg-secondary)",
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

                    {scopeType === "section" && selectedNotebookId && sections.length === 0 && (
                      <p
                        className="text-xs"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        This notebook has no sections
                      </p>
                    )}
                  </>
                )}

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
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value) || 1)}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>
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
