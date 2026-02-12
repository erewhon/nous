interface DropZoneOverlayProps {
  isVisible: boolean;
}

export function DropZoneOverlay({ isVisible }: DropZoneOverlayProps) {
  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-[45] flex flex-col items-center justify-center"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12"
        style={{
          backgroundColor: "rgba(139, 92, 246, 0.1)",
          borderColor: "var(--color-accent)",
          minWidth: "320px",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--color-accent)" }}
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span
          className="mt-4 text-lg font-semibold"
          style={{ color: "var(--color-accent)" }}
        >
          Drop files to import
        </span>
        <span
          className="mt-2 text-sm text-center max-w-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Markdown, PDF, Word, Excel, PowerPoint, Images, Audio, HTML, and more
        </span>
      </div>
    </div>
  );
}
