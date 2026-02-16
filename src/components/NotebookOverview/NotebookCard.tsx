import { useMemo, memo, useCallback } from "react";
import type { Notebook } from "../../types/notebook";
import type { Page } from "../../types/page";
import { adjustColor } from "../../utils/colorUtils";

interface NotebookCardProps {
  notebook: Notebook;
  coverPage: Page | null;
  pageCount: number;
  onClick: () => void;
  onSettings: () => void;
}

export const NotebookCard = memo(function NotebookCard({
  notebook,
  coverPage,
  pageCount,
  onClick,
  onSettings,
}: NotebookCardProps) {
  const accentColor = notebook.color || "var(--color-accent)";
  const hasCoverImage = !!notebook.coverImage;
  const hasColor = !!notebook.color;

  const handleSettings = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSettings();
  }, [onSettings]);

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

  // Card background style
  const cardStyle = useMemo(() => {
    const style: React.CSSProperties = {
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
    };

    if (hasCoverImage) {
      style.backgroundImage = `url(${notebook.coverImage})`;
      style.backgroundSize = "cover";
      style.backgroundPosition = "center";
    } else if (hasColor) {
      style.backgroundColor = notebook.color;
    } else {
      style.backgroundColor = "var(--color-bg-secondary)";
    }

    if (hasColor) {
      style.borderColor = adjustColor(notebook.color!, -30);
      style.border = "1px solid";
    } else {
      style.borderColor = "var(--color-border)";
      style.border = "1px solid";
    }

    return style;
  }, [hasCoverImage, hasColor, notebook.color, notebook.coverImage]);

  return (
    <div
      className="group relative flex w-64 flex-col overflow-hidden rounded-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl focus-within:ring-2 focus-within:ring-[--color-accent] focus-within:ring-offset-2"
      style={cardStyle}
    >
      {/* Dark gradient overlay for cover image cards */}
      {hasCoverImage && (
        <div
          className="absolute inset-0 rounded-lg"
          style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.6) 100%)",
          }}
        />
      )}

      {/* Settings button - appears on hover */}
      <button
        onClick={handleSettings}
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100"
        style={{
          backgroundColor: hasCoverImage ? "rgba(0,0,0,0.5)" : "var(--color-bg-secondary)",
          color: hasCoverImage ? "white" : "var(--color-text-muted)",
        }}
        title="Notebook settings"
      >
        <IconSettings />
      </button>

      {/* Main clickable area */}
      <button
        onClick={onClick}
        className="relative flex flex-1 flex-col focus:outline-none"
      >
        {/* Notebook cover content */}
        <div className="flex flex-1 flex-col p-5">
          {/* Cover image/preview area */}
          <div
            className="mb-4 flex h-32 items-center justify-center overflow-hidden rounded-md"
            style={
              hasCoverImage
                ? {} // transparent on image cards — image is already the bg
                : {
                    backgroundColor: hasColor
                      ? "rgba(255,255,255,0.15)"
                      : `${accentColor}15`,
                  }
            }
          >
            {coverPreview ? (
              <div
                className="flex h-full w-full items-center justify-center rounded-md px-3"
                style={{
                  backgroundColor: hasCoverImage
                    ? "rgba(0,0,0,0.45)"
                    : hasColor
                      ? "rgba(255,255,255,0.15)"
                      : "transparent",
                  backdropFilter: hasCoverImage ? "blur(4px)" : undefined,
                }}
              >
                <p
                  className="line-clamp-4 text-center text-sm leading-relaxed"
                  style={{
                    color: hasCoverImage || hasColor
                      ? "rgba(255,255,255,0.9)"
                      : "var(--color-text-secondary)",
                  }}
                >
                  {coverPreview}
                </p>
              </div>
            ) : (
              <div
                className="flex h-16 w-16 items-center justify-center rounded-xl"
                style={{
                  backgroundColor: hasCoverImage
                    ? "rgba(255,255,255,0.2)"
                    : hasColor
                      ? "rgba(255,255,255,0.2)"
                      : accentColor,
                }}
              >
                <IconBook size={32} />
              </div>
            )}
          </div>

          {/* Notebook info — with readable background on image/color cards */}
          <div
            className="flex-1 rounded-md px-3 py-2"
            style={
              hasCoverImage || hasColor
                ? {
                    backgroundColor: hasCoverImage
                      ? "rgba(0,0,0,0.45)"
                      : "rgba(0,0,0,0.2)",
                    backdropFilter: hasCoverImage ? "blur(4px)" : undefined,
                  }
                : {}
            }
          >
            <h3
              className="mb-1 text-left text-lg font-semibold line-clamp-2"
              style={{
                color: hasCoverImage || hasColor
                  ? "white"
                  : "var(--color-text-primary)",
              }}
            >
              {notebook.name}
            </h3>
            <p
              className="text-left text-sm"
              style={{
                color: hasCoverImage || hasColor
                  ? "rgba(255,255,255,0.7)"
                  : "var(--color-text-muted)",
              }}
            >
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </p>
          </div>

          {/* Notebook type badge */}
          {notebook.type === "zettelkasten" && (
            <div
              className="mt-3 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor: hasCoverImage || hasColor
                  ? "rgba(255,255,255,0.15)"
                  : "var(--color-bg-tertiary)",
                color: hasCoverImage || hasColor
                  ? "rgba(255,255,255,0.8)"
                  : "var(--color-text-secondary)",
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
                backgroundColor: hasCoverImage || hasColor
                  ? "rgba(255,255,255,0.15)"
                  : "var(--color-bg-tertiary)",
                color: hasCoverImage || hasColor
                  ? "rgba(255,255,255,0.8)"
                  : "var(--color-text-secondary)",
              }}
            >
              <IconLayers size={10} />
              Sections
            </div>
          )}
        </div>

        {/* Hover indicator */}
        <div
          className="absolute bottom-0 left-0 right-0 h-1 translate-y-full transition-transform group-hover:translate-y-0"
          style={{ backgroundColor: hasCoverImage || hasColor ? "rgba(255,255,255,0.5)" : accentColor }}
        />
      </button>
    </div>
  );
});

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
