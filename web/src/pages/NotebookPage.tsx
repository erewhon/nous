import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWebStore, type NotebookMeta, type PageSummary } from "../store";
import { PageContent } from "../components/BlockRenderer";
import { ShareDialog } from "../components/ShareDialog";

export function NotebookPage() {
  const { notebookId, pageId } = useParams<{
    notebookId: string;
    pageId?: string;
  }>();
  const { notebooks, loadNotebookMeta, loadPage } = useWebStore();
  const [meta, setMeta] = useState<NotebookMeta | null>(null);
  const [pageData, setPageData] = useState<unknown>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState("");
  const [showShareDialog, setShowShareDialog] = useState(false);

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
    loadPage(notebookId, pageId)
      .then((data) => setPageData(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingPage(false));
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
  const sortedPages = [...pages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Group by folder/section for display
  const topLevelPages = sortedPages.filter(
    (p) => !p.parentPageId && !p.folderId,
  );
  const folderedPages = new Map<string, PageSummary[]>();
  for (const p of sortedPages) {
    if (p.folderId) {
      const arr = folderedPages.get(p.folderId) || [];
      arr.push(p);
      folderedPages.set(p.folderId, arr);
    }
  }

  const currentPage = pageId
    ? pages.find((p) => p.id === pageId)
    : null;

  // If a page is selected, show the page
  if (pageId && currentPage) {
    return (
      <div className="main-content">
        <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border)" }}>
          <Link
            to={`/notebook/${notebookId}`}
            style={{ fontSize: 13, color: "var(--text-dim)" }}
          >
            &larr; {notebook?.name || "Back"}
          </Link>
        </div>
        {loadingPage ? (
          <div className="loading">
            <div className="spinner" />
            Decrypting page...
          </div>
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

  // Show page list
  return (
    <div className="main-content">
      <div className="page-list-header">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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

      {pages.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📄</div>
          <h3>No pages</h3>
          <p>This notebook is empty or hasn't been synced yet.</p>
        </div>
      ) : (
        <div className="page-list">
          {topLevelPages.map((page) => (
            <PageListItem
              key={page.id}
              page={page}
              notebookId={notebookId!}
            />
          ))}
          {Array.from(folderedPages.entries()).map(([folderId, folderPages]) => (
            <div key={folderId} style={{ marginTop: 8 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  padding: "4px 16px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Folder
              </div>
              {folderPages.map((page) => (
                <PageListItem
                  key={page.id}
                  page={page}
                  notebookId={notebookId!}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PageListItem({
  page,
  notebookId,
}: {
  page: PageSummary;
  notebookId: string;
}) {
  return (
    <Link
      to={`/notebook/${notebookId}/page/${page.id}`}
      className="page-item"
    >
      <div className="title">{page.title || "Untitled"}</div>
      {page.updatedAt && (
        <div className="updated">{formatDate(page.updatedAt)}</div>
      )}
    </Link>
  );
}

function getPageTitle(pageData: unknown, summary: PageSummary): string {
  // Try to get title from the full page data
  const data = pageData as Record<string, unknown> | null;
  if (data?.title && typeof data.title === "string") return data.title;
  return summary.title || "Untitled";
}

function getPageContent(pageData: unknown): unknown {
  // The synced page is the full page object — content is in .content
  const data = pageData as Record<string, unknown> | null;
  if (data?.content) return data.content;
  // Fallback: maybe it IS the content directly
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
