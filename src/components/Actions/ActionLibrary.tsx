import { useEffect, useState } from "react";
import { useActionStore, ACTION_CATEGORY_LABELS } from "../../stores/actionStore";
import type { Action, ActionCategory } from "../../types/action";
import { ACTION_CATEGORIES } from "../../types/action";
import { ActionCard } from "./ActionCard";

interface ActionLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  currentNotebookId?: string;
}

export function ActionLibrary({
  isOpen,
  onClose,
  currentNotebookId,
}: ActionLibraryProps) {
  const {
    actions,
    isLoading,
    error,
    loadActions,
    runAction,
    deleteAction,
    setEnabled,
    openActionEditor,
    duplicateAction,
    clearError,
  } = useActionStore();

  const [selectedCategory, setSelectedCategory] = useState<ActionCategory | "all">("all");
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isOpen) {
      loadActions();
    }
  }, [isOpen, loadActions]);

  if (!isOpen) return null;

  const handleRun = async (actionId: string) => {
    setRunningActionId(actionId);
    try {
      await runAction(actionId, { currentNotebookId });
    } finally {
      setRunningActionId(null);
    }
  };

  const handleEdit = (actionId: string) => {
    openActionEditor(actionId);
    onClose();
  };

  const handleDelete = async (actionId: string) => {
    await deleteAction(actionId);
  };

  const handleToggleEnabled = async (actionId: string, enabled: boolean) => {
    await setEnabled(actionId, enabled);
  };

  const handleCreateNew = () => {
    openActionEditor();
    onClose();
  };

  const handleViewDetails = (actionId: string) => {
    openActionEditor(actionId, true);
    onClose();
  };

  const handleDuplicate = async (actionId: string) => {
    try {
      await duplicateAction(actionId);
    } catch (error) {
      console.error("Failed to duplicate action:", error);
    }
  };

  // Filter actions
  const filteredActions = actions.filter((action) => {
    const matchesCategory =
      selectedCategory === "all" || action.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      action.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      action.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Group by category
  const groupedActions: Record<ActionCategory, Action[]> = {
    agileResults: [],
    dailyRoutines: [],
    weeklyReviews: [],
    organization: [],
    custom: [],
  };

  for (const action of filteredActions) {
    groupedActions[action.category].push(action);
  }

  const categoriesToShow =
    selectedCategory === "all"
      ? (Object.keys(groupedActions) as ActionCategory[]).filter(
          (cat) => groupedActions[cat].length > 0
        )
      : [selectedCategory];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Actions Library
            </h2>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              Run, create, and manage your automation workflows
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateNew}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              <IconPlus />
              New Action
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 transition-colors hover:opacity-80"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <IconClose />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div
            className="flex items-center justify-between border-b bg-red-500/10 px-6 py-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            <span className="text-sm text-red-400">{error}</span>
            <button
              onClick={clearError}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Search and filters */}
        <div
          className="flex items-center gap-4 border-b px-6 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          {/* Search */}
          <div className="relative flex-1">
            <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actions..."
              className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Category filter */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                selectedCategory === "all" ? "text-white" : ""
              }`}
              style={{
                backgroundColor:
                  selectedCategory === "all"
                    ? "var(--color-accent)"
                    : "var(--color-bg-tertiary)",
                color:
                  selectedCategory === "all"
                    ? "white"
                    : "var(--color-text-secondary)",
              }}
            >
              All
            </button>
            {ACTION_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedCategory === cat.id ? "text-white" : ""
                }`}
                style={{
                  backgroundColor:
                    selectedCategory === cat.id
                      ? "var(--color-accent)"
                      : "var(--color-bg-tertiary)",
                  color:
                    selectedCategory === cat.id
                      ? "white"
                      : "var(--color-text-secondary)",
                }}
                title={cat.description}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <IconSpinner className="h-8 w-8 animate-spin" />
            </div>
          ) : filteredActions.length === 0 ? (
            <div className="py-12 text-center">
              <div
                className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <IconZap />
              </div>
              <p style={{ color: "var(--color-text-muted)" }}>
                {searchQuery || selectedCategory !== "all"
                  ? "No actions match your filters"
                  : "No actions yet"}
              </p>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                {searchQuery || selectedCategory !== "all"
                  ? "Try adjusting your search or category filter"
                  : "Create your first action to get started"}
              </p>
              {!searchQuery && selectedCategory === "all" && (
                <button
                  onClick={handleCreateNew}
                  className="mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: "var(--color-accent)" }}
                >
                  Create Action
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {categoriesToShow.map((category) => (
                <div key={category}>
                  <h3
                    className="mb-3 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {ACTION_CATEGORY_LABELS[category]}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {groupedActions[category].map((action) => (
                      <ActionCard
                        key={action.id}
                        action={action}
                        onRun={handleRun}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onToggleEnabled={handleToggleEnabled}
                        onViewDetails={handleViewDetails}
                        onDuplicate={handleDuplicate}
                        isRunning={runningActionId === action.id}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t px-6 py-3 text-center text-xs"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          Press{" "}
          <kbd
            className="rounded px-1"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            Esc
          </kbd>{" "}
          to close
        </div>
      </div>
    </div>
  );
}

// Icons
function IconPlus() {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconClose() {
  return (
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconSearch({ className = "" }: { className?: string }) {
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
      className={className}
      style={{ color: "var(--color-text-muted)" }}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconSpinner({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ color: "var(--color-accent)" }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconZap() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--color-text-muted)" }}
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
