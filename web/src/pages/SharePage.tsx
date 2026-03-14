import { useEffect, useState, useMemo, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { ShareAPI } from "../api";
import type { ShareInfo } from "../api";
import type { NotebookMeta, PageSummary } from "../store";
import {
  importKeyFromBase64,
  deriveShareKey,
  unwrapNotebookKey,
  decryptJSON,
} from "../crypto";
import { PageContent } from "../components/BlockRenderer";

type Phase = "loading" | "needPassword" | "unlocked" | "error";

export function SharePage() {
  const { shareId, pageId } = useParams<{
    shareId: string;
    pageId?: string;
  }>();
  const api = useMemo(() => new ShareAPI(), []);

  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [notebookKey, setNotebookKey] = useState<CryptoKey | null>(null);
  const [meta, setMeta] = useState<NotebookMeta | null>(null);
  const [pageData, setPageData] = useState<unknown>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");

  // Password form
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  // 1. Fetch share info
  useEffect(() => {
    if (!shareId) return;
    setPhase("loading");
    api
      .getShareInfo(shareId)
      .then((info) => {
        setShareInfo(info);
        if (info.mode === "public") {
          // Extract key from URL fragment
          const hash = window.location.hash;
          const keyMatch = hash.match(/key=([A-Za-z0-9+/=]+)/);
          if (!keyMatch) {
            setError("Invalid share link — missing encryption key.");
            setPhase("error");
            return;
          }
          importKeyFromBase64(keyMatch[1])
            .then((key) => setNotebookKey(key))
            .catch(() => {
              setError("Invalid encryption key in share link.");
              setPhase("error");
            });
        } else {
          setPhase("needPassword");
        }
      })
      .catch((err) => {
        setError(err.message || "Share not found");
        setPhase("error");
      });
  }, [shareId, api]);

  // 2. Once we have the key, decrypt meta
  useEffect(() => {
    if (!notebookKey || !shareId) return;
    api
      .downloadMeta(shareId)
      .then((encrypted) => {
        if (!encrypted) {
          setError("Notebook metadata not found.");
          setPhase("error");
          return;
        }
        return decryptJSON<NotebookMeta>(notebookKey, encrypted);
      })
      .then((m) => {
        if (m) {
          setMeta(m);
          setPhase("unlocked");
        }
      })
      .catch(() => {
        setError("Failed to decrypt notebook. The key may be incorrect.");
        setPhase("error");
      });
  }, [notebookKey, shareId, api]);

  // 3. Load page when selected
  useEffect(() => {
    if (!notebookKey || !shareId || !pageId) {
      setPageData(null);
      return;
    }
    setLoadingPage(true);
    api
      .downloadPage(shareId, pageId)
      .then((encrypted) => {
        if (!encrypted) return null;
        return decryptJSON(notebookKey, encrypted);
      })
      .then((data) => setPageData(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingPage(false));
  }, [notebookKey, shareId, pageId, api]);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!shareInfo?.passwordSalt || !shareInfo?.wrappedKey) return;

    setUnlocking(true);
    setPasswordError("");

    try {
      const shareKey = await deriveShareKey(password, shareInfo.passwordSalt);
      const key = await unwrapNotebookKey(shareKey, shareInfo.wrappedKey);
      setNotebookKey(key);
    } catch {
      setPasswordError("Incorrect password.");
    } finally {
      setUnlocking(false);
    }
  };

  // ─── Render phases ──────────────────────────────────────────────────────

  if (phase === "loading") {
    return (
      <div className="center-page">
        <div className="loading">
          <div className="spinner" />
          Loading shared notebook...
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="center-page">
        <div className="center-card">
          <h1>Unable to Open Share</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (phase === "needPassword") {
    return (
      <div className="center-page">
        <div className="center-card">
          <h1>{shareInfo?.notebookName || "Shared Notebook"}</h1>
          <p>This notebook is password-protected. Enter the share password to view it.</p>

          {passwordError && <div className="error-msg">{passwordError}</div>}

          <form onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label>Share Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter share password"
                required
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={unlocking}
            >
              {unlocking ? "Unlocking..." : "Unlock"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // phase === "unlocked"
  const pages = meta?.pageSummaries?.filter((p) => !p.isArchived) || [];
  const sortedPages = [...pages].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const currentPage = pageId ? pages.find((p) => p.id === pageId) : null;

  // Viewing a specific page
  if (pageId && currentPage) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          <Link
            to={`/s/${shareId}`}
            style={{ fontSize: 13, color: "var(--text-dim)" }}
          >
            &larr; {shareInfo?.notebookName || "Back"}
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

  // Page list
  return (
    <div style={{ minHeight: "100vh" }}>
      <div
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          padding: "24px 24px 16px",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {shareInfo?.notebookName || "Shared Notebook"}
        </h1>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
          {pages.length} {pages.length === 1 ? "page" : "pages"}
          {meta?.syncedAt && <> &middot; Last updated {formatDate(meta.syncedAt)}</>}
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="empty-state">
          <h3>No pages</h3>
          <p>This notebook is empty.</p>
        </div>
      ) : (
        <div className="page-list" style={{ maxWidth: 720, margin: "0 auto" }}>
          {sortedPages.map((page) => (
            <Link
              key={page.id}
              to={`/s/${shareId}/page/${page.id}`}
              className="page-item"
            >
              <div className="title">{page.title || "Untitled"}</div>
              {page.updatedAt && (
                <div className="updated">{formatDate(page.updatedAt)}</div>
              )}
            </Link>
          ))}
        </div>
      )}
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
    const diffDays = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays === 0)
      return d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
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
