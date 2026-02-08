import { useState, useEffect, useRef, useCallback } from "react";
import ePub, { type Book, type Rendition, type NavItem, type Location } from "epubjs";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Page } from "../../types/page";
import { useLinkedFileSync } from "../../hooks/useLinkedFileSync";
import { LinkedFileChangedBanner } from "../LinkedFile";
import * as api from "../../utils/api";
import { useThemeStore } from "../../stores/themeStore";

interface EpubReaderProps {
  page: Page;
  notebookId: string;
  className?: string;
}

export function EpubReader({ page, notebookId, className = "" }: EpubReaderProps) {
  const [book, setBook] = useState<Book | null>(null);
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [metadata, setMetadata] = useState<{
    title?: string;
    creator?: string;
  }>({});
  const [isReloading, setIsReloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);
  const resolvedMode = useThemeStore((state) => state.resolvedMode);
  const isDark = resolvedMode === "dark";

  // Linked file sync detection
  const { isModified, dismiss, markSynced } = useLinkedFileSync(page, notebookId);

  // Reload the EPUB file
  const handleReload = useCallback(async () => {
    setIsReloading(true);
    try {
      // Destroy old book
      if (book) {
        book.destroy();
      }
      // Mark the file as synced
      await api.markLinkedFileSynced(notebookId, page.id);
      markSynced();
      // Force reload
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to reload EPUB:", err);
    } finally {
      setIsReloading(false);
    }
  }, [notebookId, page.id, markSynced, book]);

  // Load EPUB file
  useEffect(() => {
    const loadBook = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const filePath = await api.getFilePath(notebookId, page.id);
        const url = convertFileSrc(filePath);

        const newBook = ePub(url);
        setBook(newBook);

        // Load navigation
        const nav = await newBook.loaded.navigation;
        setToc(nav.toc);

        // Load metadata
        const meta = await newBook.loaded.metadata;
        setMetadata({
          title: meta.title,
          creator: meta.creator,
        });

        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load EPUB");
        console.error("Failed to load EPUB:", err);
        setIsLoading(false);
      }
    };

    loadBook();

    return () => {
      if (book) {
        book.destroy();
      }
    };
  }, [notebookId, page.id, reloadKey]);

  // Render book when ready and viewer element is available
  useEffect(() => {
    if (!book || !viewerRef.current || isLoading) return;

    const newRendition = book.renderTo(viewerRef.current, {
      width: "100%",
      height: "100%",
      spread: "none",
      flow: "paginated",
    });

    // Apply theme
    newRendition.themes.default({
      body: {
        background: isDark ? "#1a1a1a !important" : "#ffffff !important",
        color: isDark ? "#e5e5e5 !important" : "#333333 !important",
      },
      "a, a:link, a:visited": {
        color: isDark ? "#60a5fa !important" : "#2563eb !important",
      },
    });

    // Track location changes and save reading progress
    newRendition.on("relocated", (location: Location) => {
      setCurrentLocation(location);
      // Persist reading position
      if (location.start?.cfi) {
        try {
          localStorage.setItem(`epub-progress-${page.id}`, location.start.cfi);
        } catch {
          // Ignore storage errors
        }
      }
    });

    // Restore saved reading position, or start from beginning
    const savedCfi = localStorage.getItem(`epub-progress-${page.id}`);
    if (savedCfi) {
      newRendition.display(savedCfi);
    } else {
      newRendition.display();
    }
    setRendition(newRendition);

    return () => {
      newRendition.destroy();
    };
  }, [book, isLoading, isDark]);

  // Update theme when dark mode changes
  useEffect(() => {
    if (!rendition) return;

    rendition.themes.default({
      body: {
        background: isDark ? "#1a1a1a !important" : "#ffffff !important",
        color: isDark ? "#e5e5e5 !important" : "#333333 !important",
      },
      "a, a:link, a:visited": {
        color: isDark ? "#60a5fa !important" : "#2563eb !important",
      },
    });
  }, [rendition, isDark]);

  const goToChapter = useCallback(
    (href: string) => {
      if (rendition) {
        rendition.display(href);
        setShowToc(false);
      }
    },
    [rendition]
  );

  const goNext = useCallback(() => {
    if (rendition) {
      rendition.next();
    }
  }, [rendition]);

  const goPrev = useCallback(() => {
    if (rendition) {
      rendition.prev();
    }
  }, [rendition]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "ArrowRight" || e.key === " ") {
        goNext();
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        goPrev();
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 animate-spin"
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
          <span style={{ color: "var(--color-text-muted)" }}>Loading EPUB...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-error)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ color: "var(--color-error)" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Linked file changed banner */}
      {isModified && (
        <LinkedFileChangedBanner
          onReload={handleReload}
          onDismiss={dismiss}
          isReloading={isReloading}
          fileName={page.title}
        />
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowToc(!showToc)}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
            style={{
              backgroundColor: showToc ? "var(--color-bg-tertiary)" : "transparent",
              color: "var(--color-text-muted)",
            }}
            title="Table of Contents"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div>
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              {metadata.title || page.title}
            </span>
            {metadata.creator && (
              <span
                className="text-xs ml-2"
                style={{ color: "var(--color-text-muted)" }}
              >
                by {metadata.creator}
              </span>
            )}
          </div>
        </div>

        {/* Navigation controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Previous page"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {currentLocation && (
            <span
              className="text-xs min-w-[60px] text-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              {currentLocation.start.displayed.page} / {currentLocation.start.displayed.total}
            </span>
          )}

          <button
            onClick={goNext}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Next page"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table of Contents sidebar */}
        {showToc && (
          <div
            className="w-64 flex-shrink-0 border-r overflow-auto"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
            }}
          >
            <div className="p-4">
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--color-text-muted)" }}
              >
                Contents
              </h3>
              <TocList items={toc} onNavigate={goToChapter} level={0} />
            </div>
          </div>
        )}

        {/* EPUB viewer */}
        <div
          ref={viewerRef}
          className="flex-1"
          style={{
            backgroundColor: isDark ? "#1a1a1a" : "#ffffff",
          }}
        />
      </div>

      {/* Reading progress bar */}
      {currentLocation && currentLocation.start.displayed.total > 0 && (
        <div
          className="h-0.5"
          style={{ backgroundColor: "var(--color-border)" }}
        >
          <div
            className="h-full transition-all duration-300"
            style={{
              backgroundColor: "var(--color-accent)",
              width: `${Math.round((currentLocation.start.displayed.page / currentLocation.start.displayed.total) * 100)}%`,
            }}
          />
        </div>
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-2 border-t text-xs"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-muted)",
        }}
      >
        <span>Arrow keys or Space to navigate</span>
        {currentLocation && currentLocation.start.displayed.total > 0 && (
          <span>
            {Math.round((currentLocation.start.displayed.page / currentLocation.start.displayed.total) * 100)}% complete
          </span>
        )}
        {page.storageMode === "linked" && page.sourceFile && (
          <span className="truncate max-w-[300px]" title={page.sourceFile}>
            {page.sourceFile}
          </span>
        )}
      </div>
    </div>
  );
}

interface TocListProps {
  items: NavItem[];
  onNavigate: (href: string) => void;
  level: number;
}

function TocList({ items, onNavigate, level }: TocListProps) {
  return (
    <ul className={level > 0 ? "ml-4 mt-1" : ""}>
      {items.map((item) => (
        <li key={item.id} className="mb-1">
          <button
            onClick={() => onNavigate(item.href)}
            className="text-left w-full px-2 py-1 rounded text-sm hover:bg-[--color-bg-tertiary] transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {item.label}
          </button>
          {item.subitems && item.subitems.length > 0 && (
            <TocList items={item.subitems} onNavigate={onNavigate} level={level + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}
