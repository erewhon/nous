import { useEffect, useId } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { ActionExecutionProgress, StepStatus } from "../../types/action";

interface ActionProgressDialogProps {
  isOpen: boolean;
  progress: ActionExecutionProgress | null;
  onClose: () => void;
}

export function ActionProgressDialog({
  isOpen,
  progress,
  onClose,
}: ActionProgressDialogProps) {
  const focusTrapRef = useFocusTrap(isOpen);
  const titleId = useId();
  const descriptionId = useId();

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && progress?.isComplete) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, progress?.isComplete, onClose]);

  // Close when clicking backdrop (only if complete)
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && progress?.isComplete) {
      onClose();
    }
  };

  if (!isOpen || !progress) return null;

  const completedSteps = progress.steps.filter(
    (s) => s.status === "completed"
  ).length;
  const totalSteps = progress.steps.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            id={titleId}
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            {progress.actionName}
          </h2>
          <p
            id={descriptionId}
            className="mt-1 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {progress.isComplete
              ? progress.overallSuccess
                ? `Completed successfully (${completedSteps}/${totalSteps} steps)`
                : "Action failed"
              : `Running step ${progress.currentStepIndex + 1} of ${totalSteps}`}
          </p>
        </div>

        {/* Step list */}
        <div className="max-h-64 overflow-y-auto px-6 py-4">
          <ul className="space-y-3">
            {progress.steps.map((step) => (
              <li key={step.index} className="flex items-start gap-3">
                <StepStatusIcon status={step.status} />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium"
                    style={{
                      color:
                        step.status === "error"
                          ? "var(--color-error)"
                          : step.status === "completed"
                            ? "var(--color-success)"
                            : step.status === "running"
                              ? "var(--color-accent)"
                              : "var(--color-text-secondary)",
                    }}
                  >
                    {step.name}
                  </p>
                  {step.error && (
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "var(--color-error)" }}
                    >
                      {step.error}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {progress.result && (
              <span>
                {progress.result.createdPages.length > 0 &&
                  `${progress.result.createdPages.length} page(s) created`}
                {progress.result.createdPages.length > 0 &&
                  progress.result.modifiedPages.length > 0 &&
                  ", "}
                {progress.result.modifiedPages.length > 0 &&
                  `${progress.result.modifiedPages.length} page(s) modified`}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={!progress.isComplete}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: progress.isComplete
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
              color: progress.isComplete ? "white" : "var(--color-text-muted)",
            }}
          >
            {progress.isComplete ? "Close" : "Running..."}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepStatusIcon({ status }: { status: StepStatus }) {
  if (status === "pending") {
    return (
      <div
        className="mt-0.5 h-5 w-5 rounded-full border-2"
        style={{ borderColor: "var(--color-border)" }}
      />
    );
  }

  if (status === "running") {
    return (
      <svg
        className="mt-0.5 h-5 w-5 animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        style={{ color: "var(--color-accent)" }}
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    );
  }

  if (status === "completed") {
    return (
      <svg
        className="mt-0.5 h-5 w-5"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: "var(--color-success)" }}
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }

  // error
  return (
    <svg
      className="mt-0.5 h-5 w-5"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--color-error)" }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
