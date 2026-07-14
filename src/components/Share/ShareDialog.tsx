import { useState, useEffect, useCallback, useMemo } from "react";
import { DAEMON_BASE_URL } from "../../utils/daemon";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useFolderStore } from "../../stores/folderStore";
import { useToastStore } from "../../stores/toastStore";
import {
  sharePage,
  shareFolder,
  shareSection,
  shareNotebook,
  publishToNous,
  publishFolderToNous,
  publishSectionToNous,
  publishNotebookToNous,
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
  // Publish destination: local daemon, Nous cloud, or configured S3.
  const [destination, setDestination] = useState<"local" | "nous" | "s3">("local");
  const [hasUploadConfig, setHasUploadConfig] = useState(false);
  const [siteTitle, setSiteTitle] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Page ids excluded from a multi-page publish. Empty = publish everything (the
  // default); any exclusions send an explicit allowlist of the rest.
  const [excludedPageIds, setExcludedPageIds] = useState<Set<string>>(new Set());

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

  const folders = useFolderStore((s) => s.folders);

  const effectiveNotebookId = notebookId || selectedNotebookId;
  const effectivePageId = pageId || selectedPageId;
  const currentPage = pages.find((p) => p.id === effectivePageId);

  // The pages that would be published for this multi-page scope, mirroring the
  // backend's selection (folder subtree / section / whole notebook), in the
  // sidebar's manual order. Drives the "Advanced → choose pages" list.
  const scopePages = useMemo(() => {
    if (!isMultiPage) return [];
    const live = pages.filter((p) => !p.deletedAt);
    let scoped: typeof live;
    if (folderId) {
      // Collect the folder and all descendant folder ids (matches the backend).
      const ids = new Set<string>([folderId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of folders) {
          if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
            ids.add(f.id);
            grew = true;
          }
        }
      }
      scoped = live.filter((p) => p.folderId != null && ids.has(p.folderId));
    } else if (sectionId) {
      scoped = live.filter((p) => p.sectionId === sectionId);
    } else {
      scoped = live; // whole notebook
    }
    return [...scoped].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title)
    );
  }, [isMultiPage, folderId, sectionId, pages, folders]);

  const selectedCount = scopePages.length - excludedPageIds.size;

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setDialogState("configure");
      setError(null);
      setShareUrl(null);
      setCurrentShare(null);
      setCopied(false);
      setSiteTitle(shareName || "");
      setDestination("local");
      setShowAdvanced(false);
      setExcludedPageIds(new Set());

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

      // Check if S3 upload config exists (enables the S3 destination option)
      getShareUploadConfig()
        .then((config) => {
          setHasUploadConfig(config !== null && config.hasCredentials);
        })
        .catch(() => setHasUploadConfig(false));
    }
  }, [isOpen, effectivePageId]);

  const handleShare = useCallback(async () => {
    if (!effectiveNotebookId && !notebookShareId) return;

    // Multi-page publishes honor the "Advanced → choose pages" selection.
    // No exclusions = publish everything (send no allowlist, the default).
    const includedPageIds = scopePages
      .filter((p) => !excludedPageIds.has(p.id))
      .map((p) => p.id);
    const pageIds =
      isMultiPage && excludedPageIds.size > 0 ? includedPageIds : undefined;
    if (isMultiPage && scopePages.length > 0 && includedPageIds.length === 0) {
      setError("Select at least one page to publish.");
      return;
    }

    setDialogState("sharing");
    setError(null);

    try {
      // Publish to Nous — themed static render(s) to pub.nous.page. Dispatch by
      // share scope: page, folder, section, or whole notebook.
      if (destination === "nous") {
        let nousResp;
        if (notebookShareId) {
          nousResp = await publishNotebookToNous(
            notebookShareId,
            theme,
            expiry,
            siteTitle || undefined,
            pageIds
          );
        } else if (!effectiveNotebookId) {
          return;
        } else if (folderId) {
          nousResp = await publishFolderToNous(
            effectiveNotebookId,
            folderId,
            theme,
            expiry,
            siteTitle || undefined,
            pageIds
          );
        } else if (sectionId) {
          nousResp = await publishSectionToNous(
            effectiveNotebookId,
            sectionId,
            theme,
            expiry,
            siteTitle || undefined,
            pageIds
          );
        } else {
          if (!effectivePageId) return;
          nousResp = await publishToNous(
            effectiveNotebookId,
            effectivePageId,
            theme,
            expiry
          );
        }
        setShareUrl(nousResp.url);
        setCurrentShare(nousResp.share);
        setDialogState("success");
        setExistingShares((prev) => [nousResp.share, ...prev]);
        toastStore.success("Published to Nous");
        return;
      }

      const uploadExternal = destination === "s3";
      let response;
      if (notebookShareId) {
        response = await shareNotebook(
          notebookShareId,
          theme,
          expiry,
          uploadExternal,
          siteTitle || undefined,
          pageIds
        );
      } else if (!effectiveNotebookId) {
        // Every non-notebook share below needs a notebook id. The guard above
        // already returns when both ids are absent; this narrows the type for
        // the remaining branches (notebookShareId is falsy here).
        return;
      } else if (folderId) {
        response = await shareFolder(
          effectiveNotebookId,
          folderId,
          theme,
          expiry,
          uploadExternal,
          siteTitle || undefined,
          pageIds
        );
      } else if (sectionId) {
        response = await shareSection(
          effectiveNotebookId,
          sectionId,
          theme,
          expiry,
          uploadExternal,
          siteTitle || undefined,
          pageIds
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
  }, [effectiveNotebookId, effectivePageId, folderId, sectionId, notebookShareId, isMultiPage, theme, expiry, destination, siteTitle, scopePages, excludedPageIds, toastStore]);

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

              {/* Advanced: choose which pages to publish (multi-page only) */}
              {isMultiPage && scopePages.length > 0 && (
                <div>
                  <button
                    type="button"
                    aria-expanded={showAdvanced}
                    onClick={() => setShowAdvanced((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      background: "none",
                      border: "none",
                      padding: "2px 0",
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                    }}
                  >
                    <span className="share-section-label" style={{ margin: 0 }}>
                      {showAdvanced ? "▾" : "▸"} Choose pages
                    </span>
                    <span style={{ opacity: 0.65, fontSize: "0.85em" }}>
                      {selectedCount} of {scopePages.length}
                    </span>
                  </button>
                  {showAdvanced && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: "flex", gap: 14, marginBottom: 6, fontSize: "0.85em" }}>
                        <button
                          type="button"
                          onClick={() => setExcludedPageIds(new Set())}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", opacity: 0.8, textDecoration: "underline" }}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setExcludedPageIds(new Set(scopePages.map((p) => p.id)))}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", opacity: 0.8, textDecoration: "underline" }}
                        >
                          Select none
                        </button>
                      </div>
                      <ul
                        style={{
                          listStyle: "none",
                          margin: 0,
                          padding: 0,
                          maxHeight: 180,
                          overflowY: "auto",
                          border: "1px solid rgba(128,128,128,0.25)",
                          borderRadius: 6,
                        }}
                      >
                        {scopePages.map((p) => {
                          const checked = !excludedPageIds.has(p.id);
                          return (
                            <li key={p.id} style={{ padding: "3px 8px" }}>
                              <label
                                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setExcludedPageIds((prev) => {
                                      const next = new Set(prev);
                                      if (checked) next.add(p.id);
                                      else next.delete(p.id);
                                      return next;
                                    })
                                  }
                                />
                                <span
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {p.title || "Untitled"}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
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

              {/* Publish destination */}
              <div>
                <div className="share-section-label">Publish to</div>
                <div className="share-expiry-options">
                  <button
                    className={`share-expiry-btn${destination === "local" ? " selected" : ""}`}
                    onClick={() => setDestination("local")}
                  >
                    Local
                  </button>
                  <button
                    className={`share-expiry-btn${destination === "nous" ? " selected" : ""}`}
                    onClick={() => setDestination("nous")}
                  >
                    Nous
                  </button>
                  {hasUploadConfig && (
                    <button
                      className={`share-expiry-btn${destination === "s3" ? " selected" : ""}`}
                      onClick={() => setDestination("s3")}
                    >
                      S3
                    </button>
                  )}
                </div>
                <span className="share-upload-hint">
                  {destination === "local"
                    ? "Served by your local Nous daemon"
                    : destination === "nous"
                      ? "Published to Nous at pub.nous.page"
                      : "Published to your configured S3 storage"}
                </span>
              </div>

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
                            {share.externalUrl ||
                              `${DAEMON_BASE_URL.replace(/^https?:\/\//, "")}/share/${share.id}`}
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
