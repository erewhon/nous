import type { ReactNode } from "react";

// Shared presentational primitives for the Study sidebar family
// (StudySidebar frame + StudyTree). Split out of StudySidebar.tsx so the
// tree can consume them without an import cycle.

export const PAGE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const FOLDER_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export function StudySectionLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between px-2 pb-1 pt-4"
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: "var(--color-text-muted)",
      }}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}

export function StudyRow({
  children,
  onClick,
  onContextMenu,
  selected = false,
  depth = 0,
  emphasis = false,
  width = "100%",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  selected?: boolean;
  depth?: number;
  emphasis?: boolean;
  width?: string;
  title?: string;
}) {
  const restColor = emphasis
    ? "var(--color-text-primary)"
    : "var(--color-text-secondary)";
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className="flex items-center gap-2 text-left transition-colors"
      style={{
        width,
        padding: `5px 8px 5px ${8 + depth * 14}px`,
        borderRadius: "var(--radius-sm)",
        fontSize: 13,
        fontWeight: emphasis ? 500 : 400,
        color: selected ? "var(--color-text-primary)" : restColor,
        backgroundColor: selected ? "var(--color-selection)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
          e.currentTarget.style.color = "var(--color-text-primary)";
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = restColor;
        }
      }}
    >
      {children}
    </button>
  );
}

export function StudyRowIcon({
  children,
  selected = false,
}: {
  children: ReactNode;
  selected?: boolean;
}) {
  return (
    <span
      aria-hidden
      className="flex-none"
      style={{
        width: 15,
        height: 15,
        color: selected ? "var(--color-accent)" : "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

export function StudyChevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className="flex-none transition-transform"
      style={{
        width: 12,
        height: 12,
        color: "var(--color-text-muted)",
        transform: open ? "rotate(90deg)" : "none",
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </span>
  );
}

export function StudyBadge({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 500,
        borderRadius: "var(--radius-full)",
        padding: "1px 7px",
        color: "var(--color-accent)",
        backgroundColor: "var(--color-selection)",
      }}
    >
      {children}
    </span>
  );
}

export function StudyKbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--color-text-secondary)",
        backgroundColor: "var(--color-bg-tertiary)",
        border: "1px solid var(--color-border)",
        borderBottomWidth: 2,
        borderRadius: "var(--radius-xs)",
        padding: "1px 5px",
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}

export function StudyIconButton({
  children,
  onClick,
  title,
  size = 26,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center transition-colors"
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text-muted)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
        e.currentTarget.style.color = "var(--color-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = "var(--color-text-muted)";
      }}
    >
      {children}
    </button>
  );
}
