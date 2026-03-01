import { useState, useEffect, useCallback } from "react";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useToastStore } from "../../stores/toastStore";
import {
  sharePage,
  shareFolder,
  shareSection,
  shareNotebook,
  listShares,
  deleteShare,
  getShareUploadConfig,
  type ShareRecord,
} from "./api";
import "./share-styles.css";

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pageId?: string;
  notebookId?: string;
  folderId?: string;
  folderName?: string;
  sectionId?: string;
  sectionName?: string;
  notebookShareId?: string;
  notebookShareName?: string;
}

type ThemeName = "minimal" | "documentation" | "blog" | "academic";
type ExpiryOption = "1h" | "1d" | "1w" | "1m" | "never";
type DialogState = "configure" | "sharing" | "success";

const THEMES: { name: ThemeName; label: string; colors: [string, string, string] }[] = [
  { name: "minimal", label: "Minimal", colors: ["#f8f8f8", "#ffffff", "#333333"] },
  { name: "documentation", label: "Docs", colors: ["#f0f4f8", "#ffffff", "#1a1a2e"] },
  { name: "blog", label: "Blog", colors: ["#fafafa", "#ffffff", "#111111"] },
  { name: "academic", label: "Academic", colors: ["#fffff8", "#f5f5ef", "#1a1a1a"] },
];

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "1w", label: "1 week" },
  { value: "1m", label: "1 month" },
  { value: "never", label: "Never" },
];

export function ShareDialog({
  isOpen,
  onClose,
  pageId,
  notebookId,
  folderId,
  folderName,
  sectionId,
  sectionName,
  notebookShareId,
  notebookShareName,
}: ShareDialogProps) {
  const [theme, setTheme] = useState<ThemeName>("minimal");
  const [expiry, setExpiry] = useState<ExpiryOption>("1w");
  const [dialogState, setDialogState] = useState<DialogState>("configure");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [currentShare, setCurrentShare] = useState<ShareRecord | null>(null);
  const [existingShares, setExistingShares] = useState<ShareRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploadExternal, setUploadExternal] = useState(false);
  const [hasUploadConfig, setHasUploadConfig] = useState(false);
  const [siteTitle, setSiteTitle] = useState("");

  // Determine sharing mode
  const isMultiPage = !!folderId || !!sectionId || !!notebookShareId;
  const shareLabel = notebookShareId
    ? "Share Notebook"
    : folderId
      ? "Share Folder"
      : sectionId
        ? "Share Section"
        : "Share as Link";
  const shareName = notebookShareId
    ? notebookShareName
    : folderId
      ? folderName
      : sectionId
        ? sectionName
        : undefined;

  const selectedNotebookId = useNotebookStore((s) => s.selectedNotebookId);
  const pages = usePageStore((s) => s.pages);
  const selectedPageId = usePageStore((s) => s.selectedPageId);
  const toastStore = useToastStore();

  const effectiveNotebookId = notebookId || selectedNotebookId;
  const effectivePageId = pageId || selectedPageId;
  const currentPage = pages.find((p) => p.id === effectivePageId);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setDialogState("configure");
      setError(null);
      setShareUrl(null);
      setCurrentShare(null);
      setCopied(false);
      setSiteTitle(shareName || "");

      // Load existing shares that match this context
      listShares()
        .then((shares) => {
          let filtered: typeof shares;
          if (notebookShareId) {
            filtered = shares.filter(
              (s) => s.shareType?.type === "notebook" && (s.shareType as { notebookId?: string }).notebookId === notebookShareId
            );
          } else if (folderId) {
            filtered = shares.filter(
              (s) => s.shareType?.type === "folder" && (s.shareType as { folderId?: string }).folderId === folderId
            );
          } else if (sectionId) {
            filtered = shares.filter(
              (s) => s.shareType?.type === "section" && (s.shareType as { sectionId?: string }).sectionId === sectionId
            );
          } else {
            filtered = shares.filter((s) => s.pageId === effectivePageId);
          }
          setExistingShares(filtered);
        })
        .catch(() => setExistingShares([]));

      // Check if upload config exists
      getShareUploadConfig()
        .then((config) => {
          const configured = config !== null && config.hasCredentials;
          setHasUploadConfig(configured);
          setUploadExternal(configured);
        })
        .catch(() => setHasUploadConfig(false));
    }
  }, [isOpen, effectivePageId]);

  const handleShare = useCallback(async () => {
    if (!effectiveNotebookId && !notebookShareId) return;

    setDialogState("sharing");
    setError(null);

    try {
      let response;
      if (notebookShareId) {
        response = await shareNotebook(
          notebookShareId,
          theme,
          expiry,
          uploadExternal,
          siteTitle || undefined
        );
      } else if (folderId) {
        response = await shareFolder(
          effectiveNotebookId,
          folderId,
          theme,
          expiry,
          uploadExternal,
          siteTitle || undefined
        );
      } else if (sectionId) {
        response = await shareSection(
          effectiveNotebookId,
          sectionId,
          theme,
          expiry,
          uploadExternal,
          siteTitle || undefined
        );
      } else {
        if (!effectivePageId) return;
        response = await sharePage(
          effectiveNotebookId,
          effectivePageId,
          theme,
          expiry,
          uploadExternal
        );
      }
      const url = response.share.externalUrl || response.localUrl;
      setShareUrl(url);
      setCurrentShare(response.share);
      setDialogState("success");
      setExistingShares((prev) => [response.share, ...prev]);
      toastStore.success(
        response.share.externalUrl ? "Share uploaded to web" : "Share link created"
      );
    } catch (err) {
      setError(String(err));
      setDialogState("configure");
    }
  }, [effectiveNotebookId, effectivePageId, folderId, sectionId, notebookShareId, theme, expiry, uploadExternal, siteTitle, toastStore]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.querySelector<HTMLInputElement>(".share-url-input");
      if (input) {
        input.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }, [shareUrl]);

  const handleDeleteShare = useCallback(
    async (shareId: string) => {
      try {
        await deleteShare(shareId);
        setExistingShares((prev) => prev.filter((s) => s.id !== shareId));
        toastStore.success("Share deleted");
      } catch (err) {
        toastStore.error(String(err));
      }
    },
    [toastStore]
  );

  if (!isOpen) return null;

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="share-header">
          <h2>{shareLabel}</h2>
          <button className="share-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="share-body">
          {dialogState === "configure" && (
            <>
              {/* Title info */}
              <div className="share-page-info">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {isMultiPage ? (
                    <>
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </>
                  ) : (
                    <>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </>
                  )}
                </svg>
                <span>{isMultiPage ? shareName : currentPage?.title || "Untitled"}</span>
              </div>

              {/* Site Title (multi-page only) */}
              {isMultiPage && (
                <div>
                  <div className="share-section-label">Site Title</div>
                  <input
                    type="text"
                    className="share-site-title-input"
                    value={siteTitle}
                    onChange={(e) => setSiteTitle(e.target.value)}
                    placeholder={shareName || "My Shared Site"}
                  />
                </div>
              )}

              {/* Theme Picker */}
              <div>
                <div className="share-section-label">Theme</div>
                <div className="share-themes">
                  {THEMES.map((t) => (
                    <button
                      key={t.name}
                      className={`share-theme-card${theme === t.name ? " selected" : ""}`}
                      onClick={() => setTheme(t.name)}
                    >
                      <div className="share-theme-preview">
                        <div style={{ flex: 1, background: t.colors[0] }} />
                        <div style={{ flex: 3, background: t.colors[1] }} />
                        <div
                          style={{
                            height: 3,
                            background: t.colors[2],
                            margin: "0 20%",
                            borderRadius: 2,
                            opacity: 0.3,
                          }}
                        />
                        <div style={{ flex: 1, background: t.colors[0] }} />
                      </div>
                      <span className="share-theme-name">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Expiry Picker */}
              <div>
                <div className="share-section-label">Expires After</div>
                <div className="share-expiry-options">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`share-expiry-btn${expiry === opt.value ? " selected" : ""}`}
                      onClick={() => setExpiry(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload to web toggle */}
              {hasUploadConfig && (
                <label className="share-upload-toggle">
                  <input
                    type="checkbox"
                    checked={uploadExternal}
                    onChange={(e) => setUploadExternal(e.target.checked)}
                  />
                  <span>Upload to web</span>
                  <span className="share-upload-hint">
                    Publish to your configured S3 storage
                  </span>
                </label>
              )}

              {/* Existing shares for this page */}
              {existingShares.length > 0 && (
                <div>
                  <div className="share-section-label">
                    Existing Shares ({existingShares.length})
                  </div>
                  <div className="share-existing-list">
                    {existingShares.map((share) => (
                      <div key={share.id} className="share-existing-item">
                        <div className="share-existing-info">
                          <span className="share-existing-url">
                            {share.externalUrl || `localhost:7667/share/${share.id}`}
                          </span>
                          <span className="share-existing-meta">
                            {share.expiresAt
                              ? `Expires ${new Date(share.expiresAt).toLocaleDateString()}`
                              : "Never expires"}
                          </span>
                        </div>
                        <button
                          className="share-delete-btn"
                          onClick={() => handleDeleteShare(share.id)}
                          title="Delete share"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {error && <div className="share-error">{error}</div>}
            </>
          )}

          {dialogState === "sharing" && (
            <div className="share-loading">
              <div className="share-spinner" />
              <span>Generating share link...</span>
            </div>
          )}

          {dialogState === "success" && shareUrl && (
            <div className="share-success">
              <div className="share-success-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="22" stroke="#00a854" strokeWidth="3" />
                  <path
                    d="M14 24L21 31L34 17"
                    stroke="#00a854"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3>Share Link Created</h3>

              <div className="share-url-row">
                <input
                  type="text"
                  className="share-url-input"
                  value={shareUrl}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <button className="share-copy-btn" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="share-open-link"
              >
                Open in browser
              </a>

              {currentShare?.expiresAt && (
                <p className="share-expiry-info">
                  Expires {new Date(currentShare.expiresAt).toLocaleString()}
                </p>
              )}
              {currentShare && !currentShare.expiresAt && (
                <p className="share-expiry-info">This link never expires</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="share-footer">
          {dialogState === "configure" && (
            <button
              className="share-btn primary"
              onClick={handleShare}
              disabled={(!effectiveNotebookId && !notebookShareId) || (!effectivePageId && !folderId && !sectionId && !notebookShareId)}
            >
              Share
            </button>
          )}
          {dialogState === "success" && (
            <button className="share-btn primary" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
