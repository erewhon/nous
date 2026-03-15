import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useWebStore, type NotebookMeta, type PageSummary } from "../store";
import { PageContent } from "../components/BlockRenderer";
import { PageEditor } from "../components/PageEditor";
import { PageList } from "../components/PageList";
import { ShareDialog } from "../components/ShareDialog";

export function NotebookPage() {
  const { notebookId, pageId } = useParams<{
    notebookId: string;
    pageId?: string;
  }>();
  const navigate = useNavigate();
  const { notebooks, loadNotebookMeta, loadPage } = useWebStore();
  const [meta, setMeta] = useState<NotebookMeta | null>(null);
  const [pageData, setPageData] = useState<unknown>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState("");
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);

  const notebook = notebooks.find((n) => n.id === notebookId);

  useEffect(() => {
    if (!notebookId) return;
    setLoadingMeta(true);
    setError("");
    loadNotebookMeta(notebookId)
      .then((m) => setMeta(m))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMeta(false));
  }, [notebookId, loadNotebookMeta]);

  useEffect(() => {
    if (!notebookId || !pageId) {
      setPageData(null);
      return;
    }
    setLoadingPage(true);
    setError("");
    setIsEditing(false);
    loadPage(notebookId, pageId)
      .then((data) => setPageData(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingPage(false));
  }, [notebookId, pageId, loadPage]);

  // Warn on unsaved changes
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isEditing]);

  // Wiki-link click handler (event delegation)
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !meta || !notebookId) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Match <wiki-link> (read-only renderer) or .bn-wiki-link (BlockNote editor)
      const wikiLink = target.closest("wiki-link, .bn-wiki-link") as HTMLElement | null;
      if (!wikiLink) return;

      const pageTitle =
        wikiLink.getAttribute("data-page-title") ??
        wikiLink.textContent?.trim() ??
        "";
      if (!pageTitle) return;

      // Look up page by title in meta
      const pages = meta.pageSummaries ?? [];
      const found = pages.find(
        (p) => p.title.toLowerCase() === pageTitle.toLowerCase(),
      );

      if (found) {
        e.preventDefault();
        e.stopPropagation();
        navigate(`/notebook/${notebookId}/page/${found.id}`);
      }
    };

    container.addEventListener("click", handler);
    return () => container.removeEventListener("click", handler);
  }, [meta, notebookId, navigate]);

  const handleDone = useCallback(() => {
    // Reload page data to reflect saved changes, exit edit mode
    if (notebookId && pageId) {
      loadPage(notebookId, pageId).then((data) => {
        setPageData(data);
        setIsEditing(false);
      });
    } else {
      setIsEditing(false);
    }
  }, [notebookId, pageId, loadPage]);

  if (loadingMeta) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading notebook...
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <h3>Error</h3>
        <p>{error}</p>
      </div>
    );
  }

  const pages = meta?.pageSummaries?.filter((p) => !p.isArchived) || [];
  const currentPage = pageId ? pages.find((p) => p.id === pageId) : null;

  // Can edit own notebooks with standard page type
  const canEdit =
    !!notebook && (!currentPage?.pageType || currentPage.pageType === "standard");

  if (pageId && currentPage) {
    return (
      <div className="main-content" ref={contentRef}>
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Link
            to={`/notebook/${notebookId}`}
            style={{ fontSize: 13, color: "var(--text-dim)" }}
          >
            &larr; {notebook?.name || "Back"}
          </Link>
          {canEdit && !isEditing && !loadingPage && (
            <button
              className="btn btn-ghost"
              style={{ border: "1px solid var(--border)" }}
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>
          )}
        </div>
        {loadingPage ? (
          <div className="loading">
            <div className="spinner" />
            Decrypting page...
          </div>
        ) : isEditing && notebookId && pageData ? (
          <PageEditor
            notebookId={notebookId}
            pageId={pageId}
            pageData={pageData as Record<string, unknown>}
            onDone={handleDone}
          />
        ) : (
          <div className="page-viewer">
            <h1 className="page-title">
              {getPageTitle(pageData, currentPage)}
            </h1>
            <PageContent content={getPageContent(pageData)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="main-content">
      <div className="page-list-header">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2>{notebook?.name || "Notebook"}</h2>
          <button
            className="btn btn-ghost"
            style={{ border: "1px solid var(--border)" }}
            onClick={() => setShowShareDialog(true)}
          >
            Share
          </button>
        </div>
        <div className="subtitle">
          {pages.length} {pages.length === 1 ? "page" : "pages"}
          {meta?.syncedAt && (
            <> &middot; Last synced {formatDate(meta.syncedAt)}</>
          )}
        </div>
      </div>

      {showShareDialog && notebookId && (
        <ShareDialog
          notebookId={notebookId}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {meta && <PageList meta={meta} basePath={`/notebook/${notebookId}`} />}
    </div>
  );
}

function getPageTitle(pageData: unknown, summary: PageSummary): string {
  const data = pageData as Record<string, unknown> | null;
  if (data?.title && typeof data.title === "string") return data.title;
  return summary.title || "Untitled";
}

function getPageContent(pageData: unknown): unknown {
  const data = pageData as Record<string, unknown> | null;
  if (data?.content) return data.content;
  if (data?.blocks) return data;
  return null;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    }
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return iso;
  }
}
