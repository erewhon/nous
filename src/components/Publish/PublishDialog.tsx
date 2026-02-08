import { useState, useEffect, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useToastStore } from "../../stores/toastStore";
import {
  publishNotebook,
  publishSelectedPages,
  previewPublishPage,
  type PublishOptions,
  type PublishResult,
} from "./api";
import "./publish-styles.css";

interface PublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type PublishMode = "notebook" | "selected";
type ThemeName = "minimal" | "documentation" | "blog" | "academic";
type DialogState = "configure" | "publishing" | "success" | "preview";

interface ProgressData {
  current: number;
  total: number;
  message: string;
}

const THEMES: { name: ThemeName; label: string; colors: [string, string, string] }[] = [
  { name: "minimal", label: "Minimal", colors: ["#f8f8f8", "#ffffff", "#333333"] },
  { name: "documentation", label: "Docs", colors: ["#f0f4f8", "#ffffff", "#1a1a2e"] },
  { name: "blog", label: "Blog", colors: ["#fafafa", "#ffffff", "#111111"] },
  { name: "academic", label: "Academic", colors: ["#fffff8", "#f5f5ef", "#1a1a1a"] },
];

export function PublishDialog({ isOpen, onClose }: PublishDialogProps) {
  const [mode, setMode] = useState<PublishMode>("notebook");
  const [theme, setTheme] = useState<ThemeName>("minimal");
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [pageSearch, setPageSearch] = useState("");
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [siteTitle, setSiteTitle] = useState("");
  const [includeAssets, setIncludeAssets] = useState(true);
  const [includeBacklinks, setIncludeBacklinks] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState>("configure");
  const [progress, setProgress] = useState<ProgressData>({ current: 0, total: 0, message: "" });
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const { selectedNotebookId, notebooks } = useNotebookStore();
  const { pages } = usePageStore();
  const toastStore = useToastStore();

  const selectedNotebook = notebooks.find((n) => n.id === selectedNotebookId);
  const activePages = pages.filter((p) => !p.deletedAt);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setDialogState("configure");
      setError(null);
      setResult(null);
      setPreviewHtml(null);
      setProgress({ current: 0, total: 0, message: "" });
      if (selectedNotebook) {
        setSiteTitle(selectedNotebook.name);
      }
    }
  }, [isOpen, selectedNotebook]);

  // Listen for progress events
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: UnlistenFn | undefined;

    listen<ProgressData>("publish:progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [isOpen]);

  const handlePickDir = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) {
      setOutputDir(dir as string);
    }
  }, []);

  const handleTogglePage = useCallback((pageId: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedPageIds(new Set(activePages.map((p) => p.id)));
  }, [activePages]);

  const handleSelectNone = useCallback(() => {
    setSelectedPageIds(new Set());
  }, []);

  const handlePublish = useCallback(async () => {
    if (!selectedNotebookId || !outputDir) return;

    setDialogState("publishing");
    setError(null);

    const options: PublishOptions = {
      includeAssets,
      includeBacklinks,
      siteTitle: siteTitle || null,
    };

    try {
      let publishResult: PublishResult;
      if (mode === "notebook") {
        publishResult = await publishNotebook(selectedNotebookId, outputDir, theme, options);
      } else {
        const ids = Array.from(selectedPageIds);
        if (ids.length === 0) {
          setError("No pages selected");
          setDialogState("configure");
          return;
        }
        publishResult = await publishSelectedPages(
          selectedNotebookId,
          ids,
          outputDir,
          theme,
          options
        );
      }
      setResult(publishResult);
      setDialogState("success");
      toastStore.success(
        `Published ${publishResult.pageCount} page${publishResult.pageCount !== 1 ? "s" : ""}`
      );
    } catch (err) {
      setError(String(err));
      setDialogState("configure");
    }
  }, [
    selectedNotebookId,
    outputDir,
    mode,
    theme,
    selectedPageIds,
    includeAssets,
    includeBacklinks,
    siteTitle,
    toastStore,
  ]);

  const handlePreview = useCallback(async () => {
    if (!selectedNotebookId) return;

    // Pick a page to preview
    const previewPageId =
      mode === "selected" && selectedPageIds.size > 0
        ? Array.from(selectedPageIds)[0]
        : activePages[0]?.id;

    if (!previewPageId) return;

    try {
      const html = await previewPublishPage(selectedNotebookId, previewPageId, theme);
      setPreviewHtml(html);
      setDialogState("preview");
    } catch (err) {
      setError(String(err));
    }
  }, [selectedNotebookId, mode, selectedPageIds, activePages, theme]);

  if (!isOpen) return null;

  const filteredPages = pageSearch
    ? activePages.filter((p) => p.title.toLowerCase().includes(pageSearch.toLowerCase()))
    : activePages;

  const canPublish = selectedNotebookId && outputDir && (mode === "notebook" || selectedPageIds.size > 0);

  return (
    <div className="publish-overlay" onClick={onClose}>
      <div className="publish-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="publish-header">
          <h2>Publish to Web</h2>
          <button className="publish-close-btn" onClick={onClose}>
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
        <div className="publish-body">
          {dialogState === "configure" && (
            <>
              {/* Mode Toggle */}
              <div className="publish-mode-toggle">
                <button
                  className={`publish-mode-btn${mode === "notebook" ? " active" : ""}`}
                  onClick={() => setMode("notebook")}
                >
                  Entire Notebook
                </button>
                <button
                  className={`publish-mode-btn${mode === "selected" ? " active" : ""}`}
                  onClick={() => setMode("selected")}
                >
                  Selected Pages
                </button>
              </div>

              {/* Page Selection (selected mode only) */}
              {mode === "selected" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <span className="publish-section-label">
                      Pages ({selectedPageIds.size} selected)
                    </span>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        className="publish-btn"
                        style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                        onClick={handleSelectAll}
                      >
                        All
                      </button>
                      <button
                        className="publish-btn"
                        style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                        onClick={handleSelectNone}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    className="publish-page-search"
                    placeholder="Search pages..."
                    value={pageSearch}
                    onChange={(e) => setPageSearch(e.target.value)}
                  />
                  <div className="publish-page-list" style={{ marginTop: "0.5rem" }}>
                    {filteredPages.map((page) => (
                      <label key={page.id} className="publish-page-item">
                        <input
                          type="checkbox"
                          checked={selectedPageIds.has(page.id)}
                          onChange={() => handleTogglePage(page.id)}
                        />
                        <span>{page.title || "Untitled"}</span>
                      </label>
                    ))}
                    {filteredPages.length === 0 && (
                      <div style={{ padding: "0.75rem", color: "var(--color-text-muted)", fontSize: "0.85rem", textAlign: "center" }}>
                        No pages found
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Theme Picker */}
              <div>
                <div className="publish-section-label">Theme</div>
                <div className="publish-themes">
                  {THEMES.map((t) => (
                    <button
                      key={t.name}
                      className={`publish-theme-card${theme === t.name ? " selected" : ""}`}
                      onClick={() => setTheme(t.name)}
                    >
                      <div className="publish-theme-preview">
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
                      <span className="publish-theme-name">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Site Title */}
              <div>
                <div className="publish-section-label">Site Title</div>
                <input
                  type="text"
                  className="publish-input"
                  placeholder={selectedNotebook?.name || "My Site"}
                  value={siteTitle}
                  onChange={(e) => setSiteTitle(e.target.value)}
                />
              </div>

              {/* Options */}
              <div className="publish-options">
                <div className="publish-option-row">
                  <span className="publish-option-label">Include images & assets</span>
                  <input
                    type="checkbox"
                    checked={includeAssets}
                    onChange={(e) => setIncludeAssets(e.target.checked)}
                    style={{ accentColor: "var(--color-accent)" }}
                  />
                </div>
                <div className="publish-option-row">
                  <span className="publish-option-label">Include backlinks</span>
                  <input
                    type="checkbox"
                    checked={includeBacklinks}
                    onChange={(e) => setIncludeBacklinks(e.target.checked)}
                    style={{ accentColor: "var(--color-accent)" }}
                  />
                </div>
              </div>

              {/* Output Directory */}
              <div>
                <div className="publish-section-label">Output Directory</div>
                <div className="publish-dir-row">
                  <div className="publish-dir-path">
                    {outputDir || "Choose a folder..."}
                  </div>
                  <button className="publish-dir-btn" onClick={handlePickDir}>
                    Browse
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && <div className="publish-error">{error}</div>}
            </>
          )}

          {dialogState === "publishing" && (
            <div className="publish-progress">
              <div className="publish-progress-bar">
                <div
                  className="publish-progress-fill"
                  style={{
                    width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : "0%",
                  }}
                />
              </div>
              <div className="publish-progress-text">{progress.message || "Starting..."}</div>
            </div>
          )}

          {dialogState === "success" && result && (
            <div className="publish-success">
              <div className="publish-success-icon">
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
              <h3>Published Successfully</h3>
              <p>
                {result.pageCount} page{result.pageCount !== 1 ? "s" : ""}
                {result.assetCount > 0 && `, ${result.assetCount} asset${result.assetCount !== 1 ? "s" : ""}`}
                {" "}exported to:
              </p>
              <code style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", wordBreak: "break-all" }}>
                {result.outputDir}
              </code>
            </div>
          )}

          {dialogState === "preview" && previewHtml && (
            <iframe
              className="publish-preview-frame"
              srcDoc={previewHtml}
              sandbox="allow-same-origin"
              title="Page Preview"
            />
          )}
        </div>

        {/* Footer */}
        <div className="publish-footer">
          {dialogState === "configure" && (
            <>
              <button className="publish-btn" onClick={handlePreview} disabled={!selectedNotebookId}>
                Preview
              </button>
              <button
                className="publish-btn primary"
                onClick={handlePublish}
                disabled={!canPublish}
              >
                Publish
              </button>
            </>
          )}
          {dialogState === "success" && (
            <button className="publish-btn primary" onClick={onClose}>
              Done
            </button>
          )}
          {dialogState === "preview" && (
            <button className="publish-btn" onClick={() => setDialogState("configure")}>
              Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
