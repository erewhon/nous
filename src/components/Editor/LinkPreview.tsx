import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface LinkMetadata {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

interface LinkPreviewProps {
  containerRef: React.RefObject<HTMLElement | null>;
}

// Simple in-memory cache for link metadata
const metadataCache = new Map<string, LinkMetadata | null>();

export function LinkPreview({ containerRef }: LinkPreviewProps) {
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [metadata, setMetadata] = useState<LinkMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUrlRef = useRef<string>("");

  // Fetch metadata for a URL
  const fetchMetadata = useCallback(async (linkUrl: string) => {
    // Check cache first
    if (metadataCache.has(linkUrl)) {
      setMetadata(metadataCache.get(linkUrl) || null);
      return;
    }

    setLoading(true);
    try {
      // Call backend to fetch OpenGraph metadata
      const result = await invoke<LinkMetadata | null>("fetch_link_metadata", {
        url: linkUrl,
      });
      metadataCache.set(linkUrl, result);
      // Only update if this is still the current URL
      if (currentUrlRef.current === linkUrl) {
        setMetadata(result);
      }
    } catch {
      // Silently fail - just show URL without metadata
      metadataCache.set(linkUrl, null);
      if (currentUrlRef.current === linkUrl) {
        setMetadata(null);
      }
    } finally {
      if (currentUrlRef.current === linkUrl) {
        setLoading(false);
      }
    }
  }, []);

  // Handle mouse entering a link
  const handleLinkEnter = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a");

      if (!link) return;

      const href = link.getAttribute("href");
      if (!href) return;

      // Only show preview for external links (http/https)
      if (!href.startsWith("http://") && !href.startsWith("https://")) return;

      // Clear any pending hide timeout
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }

      // Delay showing the preview
      showTimeoutRef.current = setTimeout(() => {
        const rect = link.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();

        if (containerRect) {
          setPosition({
            x: rect.left - containerRect.left,
            y: rect.bottom - containerRect.top + 8,
          });
        } else {
          setPosition({
            x: rect.left,
            y: rect.bottom + 8,
          });
        }

        currentUrlRef.current = href;
        setUrl(href);
        setMetadata(null);
        setVisible(true);
        fetchMetadata(href);
      }, 300);
    },
    [containerRef, fetchMetadata]
  );

  // Handle mouse leaving a link
  const handleLinkLeave = useCallback(() => {
    // Clear any pending show timeout
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }

    // Delay hiding to allow mouse to move to the preview
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      currentUrlRef.current = "";
    }, 200);
  }, []);

  // Handle mouse entering the preview popup
  const handlePreviewEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Handle mouse leaving the preview popup
  const handlePreviewLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      currentUrlRef.current = "";
    }, 200);
  }, []);

  // Set up event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use event delegation for all links
    container.addEventListener("mouseenter", handleLinkEnter, true);
    container.addEventListener("mouseleave", handleLinkLeave, true);

    return () => {
      container.removeEventListener("mouseenter", handleLinkEnter, true);
      container.removeEventListener("mouseleave", handleLinkLeave, true);

      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      if (showTimeoutRef.current) {
        clearTimeout(showTimeoutRef.current);
      }
    };
  }, [containerRef, handleLinkEnter, handleLinkLeave]);

  if (!visible) return null;

  // Parse URL for display
  let displayUrl = url;
  try {
    const parsed = new URL(url);
    displayUrl = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
    if (displayUrl.length > 50) {
      displayUrl = displayUrl.slice(0, 47) + "...";
    }
  } catch {
    // Keep original URL if parsing fails
  }

  return (
    <div
      className="absolute z-50 w-80 rounded-lg shadow-xl overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
      onMouseEnter={handlePreviewEnter}
      onMouseLeave={handlePreviewLeave}
    >
      {/* Preview image */}
      {metadata?.image && (
        <div className="w-full h-32 overflow-hidden">
          <img
            src={metadata.image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              // Hide image on error
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      <div className="p-3">
        {/* Site info */}
        <div className="flex items-center gap-2 mb-2">
          {metadata?.favicon && (
            <img
              src={metadata.favicon}
              alt=""
              className="w-4 h-4"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          {metadata?.siteName && (
            <span
              className="text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              {metadata.siteName}
            </span>
          )}
        </div>

        {/* Title */}
        {loading ? (
          <div
            className="h-4 w-3/4 rounded animate-pulse mb-2"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          />
        ) : metadata?.title ? (
          <h4
            className="text-sm font-medium mb-1 line-clamp-2"
            style={{ color: "var(--color-text-primary)" }}
          >
            {metadata.title}
          </h4>
        ) : null}

        {/* Description */}
        {loading ? (
          <div
            className="h-3 w-full rounded animate-pulse"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          />
        ) : metadata?.description ? (
          <p
            className="text-xs line-clamp-2 mb-2"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {metadata.description}
          </p>
        ) : null}

        {/* URL */}
        <div className="flex items-center gap-1.5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--color-text-muted)" }}
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span
            className="text-xs truncate"
            style={{ color: "var(--color-accent)" }}
          >
            {displayUrl}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--color-text-muted)" }}
            className="flex-shrink-0"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15,3 21,3 21,9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </div>
      </div>
    </div>
  );
}
