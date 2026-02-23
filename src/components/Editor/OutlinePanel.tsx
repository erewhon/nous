import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { ResizeHandle } from "../Layout/ResizeHandle";
import { useThemeStore } from "../../stores/themeStore";
import type { EditorBlock } from "../../types/page";

interface HeadingItem {
  id: string;
  text: string;
  level: number;
  hasChildren: boolean;
}

interface OutlinePanelProps {
  blocks: EditorBlock[];
  editorScrollRef: React.RefObject<HTMLDivElement | null>;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

const LEVEL_BADGES = ["H1", "H2", "H3", "H4", "H5", "H6"] as const;

export function OutlinePanel({ blocks, editorScrollRef }: OutlinePanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [scrollProgress, setScrollProgress] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWidth = useThemeStore((s) => s.panelWidths.outline);
  const setPanelWidth = useThemeStore((s) => s.setPanelWidth);

  const headings = useMemo<HeadingItem[]>(() => {
    const raw = blocks
      .filter((b) => b.type === "header")
      .map((b) => ({
        id: b.id,
        text: stripHtml((b.data.text as string) || ""),
        level: (b.data.level as number) || 1,
        hasChildren: false,
      }))
      .filter((h) => h.text.trim().length > 0);

    // Determine which headings have children (subsequent headings with deeper level)
    for (let i = 0; i < raw.length; i++) {
      if (i + 1 < raw.length && raw[i + 1].level > raw[i].level) {
        raw[i].hasChildren = true;
      }
    }

    return raw;
  }, [blocks]);

  // Reset collapsed state on page switch (headings identity changes)
  const headingIds = useMemo(() => headings.map((h) => h.id).join(","), [headings]);
  useEffect(() => {
    setCollapsedIds(new Set());
  }, [headingIds]);

  // Compute which headings are visible (not hidden by a collapsed parent)
  const visibleHeadings = useMemo(() => {
    const result: HeadingItem[] = [];
    let skipUntilLevel: number | null = null;

    for (const h of headings) {
      if (skipUntilLevel !== null) {
        if (h.level > skipUntilLevel) continue;
        skipUntilLevel = null;
      }
      result.push(h);
      if (collapsedIds.has(h.id)) {
        skipUntilLevel = h.level;
      }
    }

    return result;
  }, [headings, collapsedIds]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

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

  const handleResize = useCallback(
    (delta: number) => {
      setPanelWidth("outline", panelWidth - delta);
    },
    [panelWidth, setPanelWidth]
  );

  // Track active heading + scroll progress on scroll
  useEffect(() => {
    const scrollContainer = editorScrollRef.current;
    if (!scrollContainer || headings.length === 0) return;

    const update = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const threshold = containerRect.top + 80;

      // Scroll progress
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const maxScroll = scrollHeight - clientHeight;
      setScrollProgress(maxScroll > 0 ? scrollTop / maxScroll : 0);

      // Active heading
      let closest: string | null = null;
      let closestDistance = Infinity;

      for (const heading of headings) {
        const el = document.querySelector(
          `[data-block-id="${CSS.escape(heading.id)}"]`
        );
        if (!el) continue;

        const rect = el.getBoundingClientRect();
        const distance = rect.top - threshold;

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

    update();
    scrollContainer.addEventListener("scroll", update, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", update);
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
    <div className="flex shrink-0" style={{ transition: "width 0.15s" }}>
      <ResizeHandle
        direction="horizontal"
        position="left"
        onResize={handleResize}
      />
      <div
        ref={panelRef}
        className="flex flex-col overflow-y-auto"
        style={{
          width: panelWidth,
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
        <div className="flex flex-1 overflow-hidden">
          {/* Scroll progress track */}
          <div
            className="shrink-0 relative ml-2"
            style={{ width: 3 }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{ backgroundColor: "var(--color-border)" }}
            />
            <div
              className="absolute top-0 left-0 right-0 rounded-full transition-[height] duration-100"
              style={{
                height: `${Math.min(100, scrollProgress * 100)}%`,
                backgroundColor: "var(--color-accent)",
                opacity: 0.5,
              }}
            />
          </div>
          {/* Heading list */}
          <nav className="flex flex-col gap-0.5 px-2 pb-4 pt-0.5 flex-1 overflow-y-auto">
            {visibleHeadings.map((h) => {
              const isActive = h.id === activeId;
              const isCollapsed = collapsedIds.has(h.id);
              const indent = (h.level - 1) * 14 + 4;

              return (
                <div
                  key={h.id}
                  data-outline-id={h.id}
                  className="flex items-start gap-1 rounded group"
                  style={{
                    paddingLeft: `${indent}px`,
                    borderLeft: isActive
                      ? "2px solid var(--color-accent)"
                      : "2px solid transparent",
                    backgroundColor: isActive
                      ? "var(--color-selection)"
                      : "transparent",
                  }}
                >
                  {/* Chevron for headings with children */}
                  {h.hasChildren ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(h.id);
                      }}
                      className="shrink-0 mt-[3px] w-4 h-4 flex items-center justify-center rounded hover:bg-[--color-bg-elevated] transition-colors"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <span
                        className="text-[10px] leading-none"
                        style={{
                          display: "inline-block",
                          transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                          transition: "transform 0.1s",
                        }}
                      >
                        ▶
                      </span>
                    </button>
                  ) : (
                    <span className="shrink-0 w-4" />
                  )}
                  {/* Level badge */}
                  <span
                    className="shrink-0 mt-[3px] text-[9px] font-medium leading-none select-none"
                    style={{
                      color: "var(--color-text-muted)",
                      opacity: 0.6,
                    }}
                  >
                    {LEVEL_BADGES[h.level - 1] ?? `H${h.level}`}
                  </span>
                  {/* Heading text */}
                  <button
                    onClick={() => handleClick(h.id)}
                    className="truncate text-left leading-snug transition-colors hover:opacity-80 py-0.5"
                    style={{
                      color: isActive
                        ? "var(--color-accent)"
                        : "var(--color-text-secondary)",
                      fontWeight: isActive ? 600 : h.level === 1 ? 500 : 400,
                      fontSize: h.level === 1 ? "0.82rem" : "0.78rem",
                    }}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                </div>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
