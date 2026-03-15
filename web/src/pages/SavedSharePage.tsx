import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWebStore, type NotebookMeta, type PageSummary } from "../store";
import { PageContent } from "../components/BlockRenderer";
import { PageList } from "../components/PageList";

export function SavedSharePage() {
  const { shareId, pageId } = useParams<{
    shareId: string;
    pageId?: string;
  }>();
  const { savedShares, loadSavedShareMeta, loadSavedSharePage, removeSavedShare } =
    useWebStore();

  const [meta, setMeta] = useState<NotebookMeta | null>(null);
  const [pageData, setPageData] = useState<unknown>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState("");

  const saved = savedShares.find((s) => s.shareId === shareId);

  useEffect(() => {
    if (!shareId) return;
    setLoadingMeta(true);
    setError("");
    loadSavedShareMeta(shareId)
      .then((m) => setMeta(m))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMeta(false));
  }, [shareId, loadSavedShareMeta]);

  useEffect(() => {
    if (!shareId || !pageId) {
      setPageData(null);
      return;
    }
    setLoadingPage(true);
    setError("");
    loadSavedSharePage(shareId, pageId)
      .then((data) => setPageData(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingPage(false));
  }, [shareId, pageId, loadSavedSharePage]);

  if (loadingMeta) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading shared notebook...
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

  if (pageId && currentPage) {
    return (
      <div className="main-content">
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Link
            to={`/shared/${shareId}`}
            style={{ fontSize: 13, color: "var(--text-dim)" }}
          >
            &larr; {saved?.notebookName || "Back"}
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
          <div>
            <h2>{saved?.notebookName || "Shared Notebook"}</h2>
            {saved?.ownerEmail && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  marginTop: 2,
                }}
              >
                Shared by {saved.ownerEmail}
              </div>
            )}
          </div>
          <button
            className="btn btn-ghost"
            style={{ color: "var(--danger)", fontSize: 12 }}
            onClick={async () => {
              if (shareId) {
                await removeSavedShare(shareId);
                window.location.href = "/";
              }
            }}
          >
            Remove
          </button>
        </div>
        <div className="subtitle">
          {pages.length} {pages.length === 1 ? "page" : "pages"}
        </div>
      </div>

      {meta && <PageList meta={meta} basePath={`/shared/${shareId}`} />}
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
