import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import type { EditorBlock } from "../../types/page";

interface HeadingItem {
  id: string;
  text: string;
  level: number;
}

interface OutlinePanelProps {
  blocks: EditorBlock[];
  editorScrollRef: React.RefObject<HTMLDivElement | null>;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

export function OutlinePanel({ blocks, editorScrollRef }: OutlinePanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const headings = useMemo<HeadingItem[]>(() => {
    return blocks
      .filter((b) => b.type === "header")
      .map((b) => ({
        id: b.id,
        text: stripHtml((b.data.text as string) || ""),
        level: (b.data.level as number) || 1,
      }))
      .filter((h) => h.text.trim().length > 0);
  }, [blocks]);

  const handleClick = useCallback((blockId: string) => {
    const el = document.querySelector(
      `[data-block-id="${CSS.escape(blockId)}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("block-ref-highlight");
      setTimeout(() => el.classList.remove("block-ref-highlight"), 2000);
    }
  }, []);

  // Track active heading on scroll
  useEffect(() => {
    const scrollContainer = editorScrollRef.current;
    if (!scrollContainer || headings.length === 0) return;

    const updateActiveHeading = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const threshold = containerRect.top + 80;

      let closest: string | null = null;
      let closestDistance = Infinity;

      for (const heading of headings) {
        const el = document.querySelector(
          `[data-block-id="${CSS.escape(heading.id)}"]`
        );
        if (!el) continue;

        const rect = el.getBoundingClientRect();
        const distance = rect.top - threshold;

        // Prefer headings that are above the threshold (already scrolled past)
        // or very close to it
        if (distance <= 0 && Math.abs(distance) < closestDistance) {
          closest = heading.id;
          closestDistance = Math.abs(distance);
        } else if (closest === null && distance > 0 && distance < closestDistance) {
          closest = heading.id;
          closestDistance = distance;
        }
      }

      setActiveId(closest);
    };

    updateActiveHeading();
    scrollContainer.addEventListener("scroll", updateActiveHeading, {
      passive: true,
    });
    return () =>
      scrollContainer.removeEventListener("scroll", updateActiveHeading);
  }, [headings, editorScrollRef]);

  // Scroll active item into view in the panel
  useEffect(() => {
    if (!activeId || !panelRef.current) return;
    const activeEl = panelRef.current.querySelector(
      `[data-outline-id="${CSS.escape(activeId)}"]`
    );
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeId]);

  if (headings.length === 0) return null;

  return (
    <div
      ref={panelRef}
      className="flex flex-col overflow-y-auto shrink-0"
      style={{
        width: 220,
        borderLeft: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-primary)",
      }}
    >
      <div
        className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-text-muted)" }}
      >
        Outline
      </div>
      <nav className="flex flex-col gap-0.5 px-2 pb-4">
        {headings.map((h) => {
          const isActive = h.id === activeId;
          return (
            <button
              key={h.id}
              data-outline-id={h.id}
              onClick={() => handleClick(h.id)}
              className="truncate rounded px-2 py-1 text-left text-[0.8rem] leading-snug transition-colors hover:opacity-80"
              style={{
                paddingLeft: `${(h.level - 1) * 16 + 8}px`,
                color: isActive
                  ? "var(--color-accent)"
                  : "var(--color-text-secondary)",
                backgroundColor: isActive
                  ? "var(--color-selection)"
                  : "transparent",
                fontWeight: isActive ? 600 : 400,
              }}
              title={h.text}
            >
              {h.text}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
