import { useState, useEffect, useCallback, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Page } from "../../types/page";
import * as api from "../../utils/api";

interface HtmlViewerProps {
  page: Page;
  notebookId: string;
  className?: string;
}

/** Clean readability HTML output to remove blank/near-empty elements */
function cleanReaderHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Strip ALL <br> tags — readability uses <p> for structure, <br> is always noise
  for (const br of Array.from(doc.querySelectorAll("br"))) {
    br.remove();
  }

  // Remove empty inline elements
  for (const el of Array.from(doc.querySelectorAll("span, a:not([href])"))) {
    if (el.textContent?.trim() === "") el.remove();
  }

  // Remove paragraphs that contain only whitespace (after br/span cleanup)
  for (const p of Array.from(doc.querySelectorAll("p"))) {
    if (p.textContent?.trim() === "" && !p.querySelector("img, video, audio, svg, canvas")) {
      p.remove();
    }
  }

  // Remove empty divs/sections that may have survived
  for (const sel of ["div", "section", "aside", "nav", "header", "footer"]) {
    for (const el of Array.from(doc.querySelectorAll(sel))) {
      if (el.textContent?.trim() === "" && !el.querySelector("img, video, audio, svg, hr")) {
        el.remove();
      }
    }
  }

  return doc.body.innerHTML;
}

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];

export function HtmlViewer({
  page,
  notebookId,
  className = "",
}: HtmlViewerProps) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [readerMode, setReaderMode] = useState(false);
  const [readerContent, setReaderContent] = useState<string | null>(null);
  const [readerTitle, setReaderTitle] = useState<string | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const readerCacheRef = useRef<{ pageId: string; content: string; title: string } | null>(null);

  useEffect(() => {
    const loadPath = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const filePath = await api.getFilePath(notebookId, page.id);
        const url = convertFileSrc(filePath);
        setAssetUrl(url);
      } catch (err) {
        setError(
          `Failed to load HTML file: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setIsLoading(false);
      }
    };

    // Reset reader mode cache when page changes
    setReaderMode(false);
    setReaderContent(null);
    setReaderTitle(null);
    readerCacheRef.current = null;

    loadPath();
  }, [notebookId, page.id]);

  const zoomIn = useCallback(() => {
    setZoom((z) => {
      const next = ZOOM_LEVELS.find((l) => l > z);
      return next ?? z;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const prev = [...ZOOM_LEVELS].reverse().find((l) => l < z);
      return prev ?? z;
    });
  }, []);

  const resetZoom = useCallback(() => setZoom(100), []);

  const toggleReaderMode = useCallback(async () => {
    if (readerMode) {
      setReaderMode(false);
      return;
    }

    setReaderMode(true);

    // Use cached content if available for this page
    if (readerCacheRef.current?.pageId === page.id) {
      setReaderContent(readerCacheRef.current.content);
      setReaderTitle(readerCacheRef.current.title);
      return;
    }

    setReaderLoading(true);
    try {
      const result = await api.getReadableHtml(notebookId, page.id);
      const cleaned = cleanReaderHtml(result.content);
      readerCacheRef.current = { pageId: page.id, content: cleaned, title: result.title };
      setReaderContent(cleaned);
      setReaderTitle(result.title);
    } catch (err) {
      setError(
        `Failed to extract readable content: ${err instanceof Error ? err.message : String(err)}`
      );
      setReaderMode(false);
    } finally {
      setReaderLoading(false);
    }
  }, [readerMode, notebookId, page.id]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center p-8 ${className}`}
        style={{ color: "var(--color-text-muted)" }}
      >
        <div className="text-center">
          <div className="mb-2 text-lg font-medium" style={{ color: "var(--color-error)" }}>
            Error loading HTML page
          </div>
          <div className="text-sm">{error}</div>
        </div>
      </div>
    );
  }

  if (isLoading || !assetUrl) {
    return (
      <div
        className={`flex items-center justify-center p-8 ${className}`}
        style={{ color: "var(--color-text-muted)" }}
      >
        Loading...
      </div>
    );
  }

  const scale = zoom / 100;

  return (
    <div className={`flex h-full w-full flex-col ${className}`}>
      {/* Zoom toolbar */}
      <div
        className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <button
          onClick={zoomOut}
          disabled={zoom <= ZOOM_LEVELS[0]}
          className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors"
          style={{
            color: zoom <= ZOOM_LEVELS[0] ? "var(--color-text-muted)" : "var(--color-text-primary)",
            backgroundColor: "transparent",
          }}
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetZoom}
          className="rounded px-2 py-0.5 text-xs tabular-nums transition-colors"
          style={{
            color: "var(--color-text-secondary)",
            backgroundColor: "transparent",
          }}
          title="Reset zoom"
        >
          {zoom}%
        </button>
        <button
          onClick={zoomIn}
          disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors"
          style={{
            color: zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ? "var(--color-text-muted)" : "var(--color-text-primary)",
            backgroundColor: "transparent",
          }}
          title="Zoom in"
        >
          +
        </button>

        <div className="flex-1" />

        {/* Reader mode toggle */}
        <button
          onClick={toggleReaderMode}
          className="flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors"
          style={{
            color: readerMode ? "var(--color-accent)" : "var(--color-text-secondary)",
            backgroundColor: readerMode ? "var(--color-accent-muted, rgba(59, 130, 246, 0.1))" : "transparent",
          }}
          title={readerMode ? "Show original page" : "Reader mode"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          Reader
        </button>
      </div>

      {/* Content area */}
      {readerMode ? (
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{
            backgroundColor: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
          }}
        >
          {readerLoading ? (
            <div
              className="flex items-center justify-center p-8"
              style={{ color: "var(--color-text-muted)" }}
            >
              Extracting article content...
            </div>
          ) : readerContent ? (
            <div className="reader-content-wrapper" style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
              {readerTitle && (
                <h1 style={{
                  fontSize: "1.75rem",
                  fontWeight: 700,
                  lineHeight: 1.3,
                  marginBottom: "1.5rem",
                  color: "var(--color-text-primary)",
                }}>
                  {readerTitle}
                </h1>
              )}
              <div
                className="reader-content"
                dangerouslySetInnerHTML={{ __html: readerContent }}
                style={{ lineHeight: 1.7 }}
              />
              <style>{`
                /* Constrain all content to prevent horizontal overflow */
                .reader-content {
                  overflow-wrap: break-word;
                  word-break: break-word;
                }
                .reader-content * {
                  max-width: 100% !important;
                  box-sizing: border-box;
                }
                /* Collapse blank sections: empty divs/spans/sections with fixed heights */
                .reader-content div:empty,
                .reader-content section:empty,
                .reader-content span:empty,
                .reader-content aside:empty,
                .reader-content header:empty,
                .reader-content footer:empty,
                .reader-content nav:empty {
                  display: none !important;
                }
                /* Strip fixed heights/widths that create blank space */
                .reader-content div,
                .reader-content section,
                .reader-content article,
                .reader-content aside,
                .reader-content header,
                .reader-content footer,
                .reader-content nav,
                .reader-content main,
                .reader-content span {
                  height: auto !important;
                  min-height: 0 !important;
                  width: auto !important;
                  min-width: 0 !important;
                  float: none !important;
                  position: static !important;
                  margin-left: 0 !important;
                  margin-right: 0 !important;
                  padding-left: 0 !important;
                  padding-right: 0 !important;
                }
                .reader-content h1, .reader-content h2, .reader-content h3,
                .reader-content h4, .reader-content h5, .reader-content h6 {
                  color: var(--color-text-primary);
                  font-weight: 600;
                  margin-top: 1.5em;
                  margin-bottom: 0.5em;
                  line-height: 1.3;
                  height: auto !important;
                }
                .reader-content h1 { font-size: 1.5rem; }
                .reader-content h2 { font-size: 1.3rem; }
                .reader-content h3 { font-size: 1.15rem; }
                .reader-content p {
                  margin-bottom: 1em;
                  color: var(--color-text-primary);
                }
                .reader-content img {
                  max-width: 100% !important;
                  height: auto !important;
                  max-height: 50vh;
                  object-fit: contain;
                  border-radius: 6px;
                  margin: 1em 0;
                  background: var(--color-bg-secondary);
                  outline: 1px solid var(--color-border);
                }
                .reader-content a {
                  color: var(--color-accent);
                  text-decoration: underline;
                  text-underline-offset: 2px;
                  word-break: break-all;
                  overflow-wrap: anywhere;
                }
                .reader-content ul, .reader-content ol {
                  padding-left: 1.5em !important;
                  margin-bottom: 1em;
                }
                .reader-content li {
                  margin-bottom: 0.3em;
                }
                .reader-content blockquote {
                  border-left: 3px solid var(--color-border);
                  padding-left: 1em !important;
                  margin: 1em 0;
                  color: var(--color-text-secondary);
                  font-style: italic;
                }
                .reader-content pre {
                  background: var(--color-bg-secondary);
                  border: 1px solid var(--color-border);
                  border-radius: 6px;
                  padding: 1em !important;
                  overflow-x: auto;
                  margin: 1em 0;
                  font-size: 0.875em;
                  white-space: pre-wrap;
                }
                .reader-content code {
                  background: var(--color-bg-secondary);
                  padding: 0.15em 0.35em;
                  border-radius: 3px;
                  font-size: 0.9em;
                }
                .reader-content pre code {
                  background: none;
                  padding: 0;
                  border-radius: 0;
                }
                .reader-content table {
                  width: 100% !important;
                  border-collapse: collapse;
                  margin: 1em 0;
                  display: block;
                  overflow-x: auto;
                }
                .reader-content th, .reader-content td {
                  border: 1px solid var(--color-border);
                  padding: 0.5em 0.75em;
                  text-align: left;
                }
                .reader-content th {
                  background: var(--color-bg-secondary);
                  font-weight: 600;
                }
                .reader-content figure {
                  margin: 1em 0;
                }
                .reader-content figcaption {
                  font-size: 0.875em;
                  color: var(--color-text-muted);
                  margin-top: 0.5em;
                  text-align: center;
                }
                /* Hide iframes, scripts, forms that readability may leave */
                .reader-content iframe,
                .reader-content form,
                .reader-content input,
                .reader-content button,
                .reader-content select,
                .reader-content textarea {
                  display: none !important;
                }
              `}</style>
            </div>
          ) : null}
        </div>
      ) : (
        /* iframe container */
        <div className="flex-1 overflow-auto">
          <iframe
            src={assetUrl}
            sandbox="allow-same-origin"
            style={{
              width: `${100 / scale}%`,
              height: `${100 / scale}%`,
              minHeight: `calc((100vh - 200px) / ${scale})`,
              border: "none",
              backgroundColor: "white",
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
            }}
            title={page.title}
          />
        </div>
      )}
    </div>
  );
}
