/**
 * Renders a plugin sidebar panel in a sandboxed iframe.
 * Follows the same pattern as PluginBlock and PluginDatabaseView.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { usePluginStore, type PluginPanelType } from "../../stores/pluginStore";

interface PluginSidebarPanelProps {
  panel: PluginPanelType;
  context: {
    current_page_id: string;
    current_notebook_id: string;
  };
  onClose: () => void;
}

export function PluginSidebarPanel({
  panel,
  context,
  onClose,
}: PluginSidebarPanelProps) {
  const renderPanel = usePluginStore((s) => s.renderPanel);
  const handlePanelAction = usePluginStore((s) => s.handlePanelAction);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doRender = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await renderPanel(
        panel.pluginId,
        panel.panelId,
        context
      )) as {
        html?: string;
        styles?: string;
      };
      setHtml(result.html ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [panel.pluginId, panel.panelId, context, renderPanel]);

  useEffect(() => {
    doRender();
  }, [doRender]);

  // Listen for postMessage from the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!iframeRef.current) return;
      if (e.source !== iframeRef.current.contentWindow) return;

      const msg = e.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "plugin-panel-action" && panel.pluginId) {
        handlePanelAction(panel.pluginId, msg.payload).then((result: unknown) => {
          const r = result as { html?: string } | null;
          if (r?.html) {
            setHtml(r.html);
          }
        }).catch((err: unknown) =>
          console.error("Plugin panel action failed:", err)
        );
      } else if (msg.type === "plugin-panel-notification") {
        // Show a web notification on behalf of the sandboxed iframe
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(msg.title || "Nous", { body: msg.body || "" });
        } else if ("Notification" in window && Notification.permission !== "denied") {
          Notification.requestPermission().then((perm) => {
            if (perm === "granted") {
              new Notification(msg.title || "Nous", { body: msg.body || "" });
            }
          });
        }
      } else if (msg.type === "plugin-panel-resize" && typeof msg.height === "number") {
        // Could use this for bottom panels in the future
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [panel.pluginId, handlePanelAction]);

  const width = panel.defaultWidth ?? 240;

  const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; overflow-x: hidden; }
</style>
</head>
<body>${html}</body>
</html>`;

  return (
    <div
      className="flex flex-col border-l"
      style={{
        width: `${width}px`,
        minWidth: `${width}px`,
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-primary)",
        overflow: "hidden",
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div className="flex items-center gap-2">
          {panel.iconSvg && (
            <span
              style={{ color: "var(--color-text-dim)", display: "flex" }}
              dangerouslySetInnerHTML={{ __html: panel.iconSvg }}
            />
          )}
          <span
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {panel.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={doRender}
            className="flex items-center justify-center rounded p-1 transition-colors hover:opacity-80"
            style={{ color: "var(--color-text-dim)" }}
            title="Refresh"
          >
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
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded p-1 transition-colors hover:opacity-80"
            style={{ color: "var(--color-text-dim)" }}
            title="Close"
          >
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
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div
            className="flex items-center justify-center p-4"
            style={{ color: "var(--color-text-dim)" }}
          >
            <span className="text-xs">Loading...</span>
          </div>
        )}
        {error && (
          <div className="p-3 text-xs" style={{ color: "#ef4444" }}>
            {error}
            <button
              onClick={doRender}
              className="ml-2 underline"
              style={{ color: "inherit" }}
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && (
          <iframe
            ref={iframeRef}
            srcDoc={srcdoc}
            sandbox="allow-scripts"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: "transparent",
            }}
            title={`Plugin panel: ${panel.label}`}
          />
        )}
      </div>
    </div>
  );
}
