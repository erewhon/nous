import { useState } from "react";
import type { BlockDiff, WordDiff } from "../../utils/diff";
import { computeWordDiff, getBlockText } from "../../utils/diff";
import { HistoryBlockRenderer } from "./HistoryBlockRenderer";

interface BlockDiffRendererProps {
  diffs: BlockDiff[];
}

export function BlockDiffRenderer({ diffs }: BlockDiffRendererProps) {
  // Group consecutive unchanged blocks into collapsible sections
  const groups = groupDiffs(diffs);

  return (
    <div className="space-y-1">
      {groups.map((group, i) =>
        group.type === "unchanged" ? (
          <UnchangedGroup key={i} diffs={group.diffs} />
        ) : (
          group.diffs.map((diff) => (
            <DiffBlockView key={diff.blockId} diff={diff} />
          ))
        )
      )}
    </div>
  );
}

// --- Grouping ---

interface DiffGroup {
  type: "unchanged" | "changed";
  diffs: BlockDiff[];
}

function groupDiffs(diffs: BlockDiff[]): DiffGroup[] {
  const groups: DiffGroup[] = [];
  let current: DiffGroup | null = null;

  for (const diff of diffs) {
    const groupType = diff.type === "unchanged" ? "unchanged" : "changed";

    if (current && current.type === groupType) {
      current.diffs.push(diff);
    } else {
      current = { type: groupType, diffs: [diff] };
      groups.push(current);
    }
  }

  return groups;
}

// --- Unchanged group (collapsible) ---

function UnchangedGroup({ diffs }: { diffs: BlockDiff[] }) {
  const [expanded, setExpanded] = useState(false);

  if (diffs.length === 0) return null;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
        style={{ color: "var(--color-text-muted)" }}
      >
        <svg
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
        {diffs.length} unchanged block{diffs.length !== 1 ? "s" : ""}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(false)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
        style={{ color: "var(--color-text-muted)" }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
        {diffs.length} unchanged block{diffs.length !== 1 ? "s" : ""}
      </button>
      <div className="space-y-1 opacity-60">
        {diffs.map((diff) => (
          <div key={diff.blockId} className="rounded-md px-3 py-1">
            {diff.newBlock && (
              <HistoryBlockRenderer blocks={[diff.newBlock]} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Individual diff block ---

function DiffBlockView({ diff }: { diff: BlockDiff }) {
  switch (diff.type) {
    case "added":
      return (
        <div
          className="rounded-md border-l-3 px-3 py-2"
          style={{
            borderLeftColor: "rgb(34, 197, 94)",
            backgroundColor: "rgba(34, 197, 94, 0.08)",
          }}
        >
          <DiffBadge type="added" />
          {diff.newBlock && (
            <HistoryBlockRenderer blocks={[diff.newBlock]} />
          )}
        </div>
      );

    case "removed":
      return (
        <div
          className="rounded-md border-l-3 px-3 py-2 opacity-70"
          style={{
            borderLeftColor: "rgb(239, 68, 68)",
            backgroundColor: "rgba(239, 68, 68, 0.08)",
          }}
        >
          <DiffBadge type="removed" />
          {diff.oldBlock && (
            <HistoryBlockRenderer blocks={[diff.oldBlock]} />
          )}
        </div>
      );

    case "modified":
      return <ModifiedBlockView diff={diff} />;

    default:
      return null;
  }
}

function DiffBadge({ type }: { type: "added" | "removed" | "modified" }) {
  const config = {
    added: { label: "Added", color: "rgb(34, 197, 94)", bg: "rgba(34, 197, 94, 0.15)" },
    removed: { label: "Removed", color: "rgb(239, 68, 68)", bg: "rgba(239, 68, 68, 0.15)" },
    modified: { label: "Modified", color: "rgb(59, 130, 246)", bg: "rgba(59, 130, 246, 0.15)" },
  }[type];

  return (
    <span
      className="mb-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.label}
    </span>
  );
}

// --- Modified block with word-level diff ---

function ModifiedBlockView({ diff }: { diff: BlockDiff }) {
  const oldText = diff.oldBlock ? getBlockText(diff.oldBlock) : null;
  const newText = diff.newBlock ? getBlockText(diff.newBlock) : null;

  // If both have diffable text content, show word-level diff
  if (oldText !== null && newText !== null) {
    const wordDiffs = computeWordDiff(oldText, newText);
    return (
      <div
        className="rounded-md border-l-3 px-3 py-2"
        style={{
          borderLeftColor: "rgb(59, 130, 246)",
          backgroundColor: "rgba(59, 130, 246, 0.05)",
        }}
      >
        <DiffBadge type="modified" />
        <WordDiffDisplay diffs={wordDiffs} blockType={diff.blockType} />
      </div>
    );
  }

  // Non-text blocks: show old/new side by side
  return (
    <div
      className="rounded-md border-l-3 px-3 py-2"
      style={{
        borderLeftColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.05)",
      }}
    >
      <DiffBadge type="modified" />
      <div className="flex gap-3">
        {diff.oldBlock && (
          <div
            className="flex-1 rounded border px-2 py-1"
            style={{
              borderColor: "rgba(239, 68, 68, 0.3)",
              backgroundColor: "rgba(239, 68, 68, 0.05)",
            }}
          >
            <span
              className="mb-1 block text-[10px] font-medium"
              style={{ color: "rgb(239, 68, 68)" }}
            >
              Before
            </span>
            <HistoryBlockRenderer blocks={[diff.oldBlock]} />
          </div>
        )}
        {diff.newBlock && (
          <div
            className="flex-1 rounded border px-2 py-1"
            style={{
              borderColor: "rgba(34, 197, 94, 0.3)",
              backgroundColor: "rgba(34, 197, 94, 0.05)",
            }}
          >
            <span
              className="mb-1 block text-[10px] font-medium"
              style={{ color: "rgb(34, 197, 94)" }}
            >
              After
            </span>
            <HistoryBlockRenderer blocks={[diff.newBlock]} />
          </div>
        )}
      </div>
    </div>
  );
}

// --- Word-level diff display ---

function WordDiffDisplay({
  diffs,
  blockType,
}: {
  diffs: WordDiff[];
  blockType: string;
}) {
  const sizeClass =
    blockType === "header"
      ? "text-base font-semibold"
      : blockType === "code"
        ? "font-mono text-xs"
        : "text-sm leading-relaxed";

  return (
    <div className={sizeClass} style={{ color: "var(--color-text-secondary)" }}>
      {diffs.map((d, i) => {
        if (d.type === "unchanged") {
          return <span key={i}>{d.text}</span>;
        }
        if (d.type === "added") {
          return (
            <span
              key={i}
              style={{
                backgroundColor: "rgba(34, 197, 94, 0.2)",
                color: "rgb(22, 163, 74)",
                borderRadius: "2px",
              }}
            >
              {d.text}
            </span>
          );
        }
        // removed
        return (
          <span
            key={i}
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.2)",
              color: "rgb(220, 38, 38)",
              textDecoration: "line-through",
              borderRadius: "2px",
            }}
          >
            {d.text}
          </span>
        );
      })}
    </div>
  );
}
