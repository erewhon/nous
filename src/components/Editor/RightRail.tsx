import type { Page } from "../../types/page";
import { OutlineList } from "./OutlinePanel";
import { useBacklinks } from "./useBacklinks";

interface RightRailProps {
  page: Page;
  notebookId: string;
  editorScrollRef: React.RefObject<HTMLDivElement | null>;
}

// The Study reading-desk companion (design brief nous-app.md; mockup
// design/direction-a-editor.html right rail). Replaces the outline-only column
// with three stacked sections: ON THIS PAGE (outline), LINKED FROM (backlink
// cards), TAGS (chips). Empty LINKED FROM / TAGS sections are omitted. Only
// var(--color-*) tokens — holds under every theme.
export function RightRail({ page, notebookId, editorScrollRef }: RightRailProps) {
  const { backlinks, navigateToBacklink } = useBacklinks(
    notebookId,
    page.id,
    page.title
  );
  const tags = page.tags ?? [];

  return (
    <div
      className="flex shrink-0 flex-col overflow-y-auto"
      style={{
        width: 256,
        borderLeft: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-panel)",
      }}
    >
      {/* ON THIS PAGE — the outline (scroll-synced) */}
      <RailSectionHeader>On this page</RailSectionHeader>
      <OutlineList blocks={page.content.blocks} editorScrollRef={editorScrollRef} />

      {/* LINKED FROM — page-level backlink cards */}
      {backlinks.length > 0 && (
        <>
          <RailSectionHeader>Linked from · {backlinks.length}</RailSectionHeader>
          <div className="flex flex-col gap-1 px-3 pb-3">
            {backlinks.map((bl) => (
              <button
                key={bl.sourcePageId}
                type="button"
                onClick={() => navigateToBacklink(bl.sourcePageId)}
                className="flex flex-col gap-0.5 rounded p-2 text-left transition-colors"
                style={{
                  border: "1px solid var(--color-border-muted)",
                  backgroundColor: "var(--color-bg-secondary)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "var(--color-accent)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "var(--color-border-muted)")
                }
                title={bl.sourcePageTitle}
              >
                <span
                  className="truncate text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {bl.sourcePageTitle}
                </span>
                <span
                  className="truncate text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  links to {bl.targetTitle}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* TAGS — read-only chips */}
      {tags.length > 0 && (
        <>
          <RailSectionHeader>Tags</RailSectionHeader>
          <div className="flex flex-wrap gap-1.5 px-3 pb-4">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: "var(--color-selection)",
                  color: "var(--color-accent)",
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RailSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 pb-1.5 pt-4 text-xs font-semibold uppercase"
      style={{ color: "var(--color-text-muted)", letterSpacing: "0.09em" }}
    >
      {children}
    </div>
  );
}
