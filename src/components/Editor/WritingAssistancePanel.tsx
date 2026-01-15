import { useState, useCallback } from "react";
import {
  checkWriting,
  getIssueColor,
  countIssuesByType,
  type WritingIssue,
  type WritingCheckResult,
} from "../../utils/writingAssistance";

interface WritingAssistancePanelProps {
  isOpen: boolean;
  onClose: () => void;
  text: string;
}

export function WritingAssistancePanel({
  isOpen,
  onClose,
  text,
}: WritingAssistancePanelProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<WritingCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = useCallback(async () => {
    if (!text.trim()) {
      setError("No text to check");
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      const checkResult = await checkWriting(text);
      setResult(checkResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check writing");
    } finally {
      setIsChecking(false);
    }
  }, [text]);

  if (!isOpen) return null;

  const issueCounts = result ? countIssuesByType(result.issues) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative flex h-[600px] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-panel)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-3">
            <IconSpellCheck />
            <h3
              className="text-base font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Writing Assistance
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCheck}
              disabled={isChecking || !text.trim()}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{
                background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
              }}
            >
              {isChecking ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
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
                  Checking...
                </>
              ) : (
                <>
                  <IconCheck />
                  Check Writing
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              <IconX />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Initial state */}
          {!result && !error && !isChecking && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <IconSpellCheck size={32} />
              </div>
              <h4
                className="mb-2 text-lg font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Check Your Writing
              </h4>
              <p
                className="max-w-sm text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Click "Check Writing" to analyze your text for spelling, grammar,
                punctuation, and style issues.
              </p>
              <p
                className="mt-4 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Powered by LanguageTool
              </p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div
              className="flex items-center gap-3 rounded-lg border p-4"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                borderColor: "rgba(239, 68, 68, 0.3)",
              }}
            >
              <IconWarning />
              <div>
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--color-error)" }}
                >
                  Error checking writing
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-6">
              {/* Summary */}
              <div
                className="rounded-lg border p-4"
                style={{ borderColor: "var(--color-border)" }}
              >
                <h4
                  className="mb-3 text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Summary
                </h4>
                {result.issues.length === 0 ? (
                  <div className="flex items-center gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="rgb(34, 197, 94)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span
                      className="text-sm"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      No issues found! Your writing looks great.
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {issueCounts && issueCounts.spelling > 0 && (
                      <IssueBadge
                        type="spelling"
                        count={issueCounts.spelling}
                        label="Spelling"
                      />
                    )}
                    {issueCounts && issueCounts.grammar > 0 && (
                      <IssueBadge
                        type="grammar"
                        count={issueCounts.grammar}
                        label="Grammar"
                      />
                    )}
                    {issueCounts && issueCounts.punctuation > 0 && (
                      <IssueBadge
                        type="punctuation"
                        count={issueCounts.punctuation}
                        label="Punctuation"
                      />
                    )}
                    {issueCounts && issueCounts.style > 0 && (
                      <IssueBadge
                        type="style"
                        count={issueCounts.style}
                        label="Style"
                      />
                    )}
                    {issueCounts && issueCounts.typography > 0 && (
                      <IssueBadge
                        type="typography"
                        count={issueCounts.typography}
                        label="Typography"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Issue list */}
              {result.issues.length > 0 && (
                <div className="space-y-3">
                  <h4
                    className="text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Issues ({result.issues.length})
                  </h4>
                  {result.issues.map((issue, index) => (
                    <IssueCard key={index} issue={issue} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface IssueBadgeProps {
  type: WritingIssue["rule"]["issueType"];
  count: number;
  label: string;
}

function IssueBadge({ type, count, label }: IssueBadgeProps) {
  const color = getIssueColor(type);
  return (
    <div
      className="flex items-center gap-2 rounded-full px-3 py-1"
      style={{ backgroundColor: `${color}20` }}
    >
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ backgroundColor: color }}
      >
        {count}
      </span>
      <span className="text-sm" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

interface IssueCardProps {
  issue: WritingIssue;
}

function IssueCard({ issue }: IssueCardProps) {
  const color = getIssueColor(issue.rule.issueType);

  // Highlight the error in context
  const contextBefore = issue.context.text.slice(0, issue.context.offset);
  const contextError = issue.context.text.slice(
    issue.context.offset,
    issue.context.offset + issue.context.length
  );
  const contextAfter = issue.context.text.slice(
    issue.context.offset + issue.context.length
  );

  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-xs font-medium capitalize"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {issue.rule.issueType}
          </span>
          <span
            className="text-sm"
            style={{ color: "var(--color-text-primary)" }}
          >
            {issue.shortMessage || issue.message}
          </span>
        </div>
      </div>

      {/* Context with highlighted error */}
      <div
        className="mb-3 rounded-md px-3 py-2 font-mono text-sm"
        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
      >
        <span style={{ color: "var(--color-text-muted)" }}>{contextBefore}</span>
        <span
          className="rounded px-0.5"
          style={{ backgroundColor: `${color}30`, color }}
        >
          {contextError}
        </span>
        <span style={{ color: "var(--color-text-muted)" }}>{contextAfter}</span>
      </div>

      {/* Suggestions */}
      {issue.replacements.length > 0 && (
        <div>
          <span
            className="text-xs font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            Suggestions:
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {issue.replacements.map((replacement, i) => (
              <span
                key={i}
                className="rounded-md px-2 py-1 text-sm"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  color: "var(--color-accent)",
                }}
              >
                {replacement || "(remove)"}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Icons
function IconSpellCheck({ size = 20 }: { size?: number }) {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="m6 16 6-12 6 12" />
      <path d="M8 12h8" />
      <path d="m16 20 2 2 4-4" />
    </svg>
  );
}

function IconCheck() {
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
      <path d="M20 6L9 17l-5-5" />
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

function IconWarning() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-error)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
