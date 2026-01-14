import { useMemo } from "react";
import type { Notebook } from "../../types/notebook";
import type { Page } from "../../types/page";

interface NotebookCardProps {
  notebook: Notebook;
  coverPage: Page | null;
  pageCount: number;
  onClick: () => void;
  onSettings: () => void;
}

export function NotebookCard({
  notebook,
  coverPage,
  pageCount,
  onClick,
  onSettings,
}: NotebookCardProps) {
  const accentColor = notebook.color || "var(--color-accent)";

  // Extract text preview from cover page if available
  const coverPreview = useMemo(() => {
    if (!coverPage?.content?.blocks) return null;
    const textBlocks = coverPage.content.blocks
      .filter((b) => b.type === "paragraph" || b.type === "header")
      .slice(0, 3);
    return textBlocks.map((block) => {
      const text = String(block.data?.text || "");
      // Strip HTML tags
      return text.replace(/<[^>]*>/g, "").trim();
    }).filter(Boolean).join(" ");
  }, [coverPage]);

  return (
    <div
      className="group relative flex w-64 flex-col overflow-hidden rounded-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl focus-within:ring-2 focus-within:ring-[--color-accent] focus-within:ring-offset-2"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
      }}
    >
      {/* Settings button - appears on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSettings();
        }}
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md opacity-0 transition-all hover:bg-[--color-bg-tertiary] group-hover:opacity-100"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          color: "var(--color-text-muted)",
        }}
        title="Notebook settings"
      >
        <IconSettings />
      </button>

      {/* Main clickable area */}
      <button
        onClick={onClick}
        className="flex flex-1 flex-col focus:outline-none"
      >
        {/* Notebook spine */}
        <div
          className="absolute left-0 top-0 h-full w-3 transition-all group-hover:w-4"
          style={{ backgroundColor: accentColor }}
        />

        {/* Notebook cover content */}
        <div className="ml-3 flex flex-1 flex-col p-5">
        {/* Cover image/preview area */}
        <div
          className="mb-4 flex h-32 items-center justify-center overflow-hidden rounded-md"
          style={{
            backgroundColor: `${accentColor}15`,
          }}
        >
          {coverPreview ? (
            <p
              className="line-clamp-4 px-3 text-center text-sm leading-relaxed"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {coverPreview}
            </p>
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-xl"
              style={{ backgroundColor: accentColor }}
            >
              <IconBook size={32} />
            </div>
          )}
        </div>

        {/* Notebook info */}
        <div className="flex-1">
          <h3
            className="mb-1 text-left text-lg font-semibold line-clamp-2"
            style={{ color: "var(--color-text-primary)" }}
          >
            {notebook.name}
          </h3>
          <p
            className="text-left text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {pageCount} {pageCount === 1 ? "page" : "pages"}
          </p>
        </div>

        {/* Notebook type badge */}
        {notebook.type === "zettelkasten" && (
          <div
            className="mt-3 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            <IconLink size={10} />
            Zettelkasten
          </div>
        )}

        {/* Sections badge */}
        {notebook.sectionsEnabled && (
          <div
            className="mt-2 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            <IconLayers size={10} />
            Sections
          </div>
        )}
      </div>

        {/* Hover indicator */}
        <div
          className="absolute bottom-0 left-3 right-0 h-1 translate-y-full transition-transform group-hover:translate-y-0"
          style={{ backgroundColor: accentColor }}
        />
      </button>
    </div>
  );
}

function IconSettings() {
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
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function IconBook({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function IconLink({ size = 12 }: { size?: number }) {
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
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconLayers({ size = 12 }: { size?: number }) {
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
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
