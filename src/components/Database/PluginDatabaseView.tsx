import { useState, useEffect, useRef, useCallback } from "react";
import type { DatabaseContentV2, DatabaseView } from "../../types/database";
import type { PluginViewConfig } from "../../types/database";
import { usePluginStore } from "../../stores/pluginStore";
import type { RelationContext } from "./useRelationContext";

interface PluginDatabaseViewProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
  relationContext?: RelationContext;
  notebookId?: string;
  onRefreshFromDisk?: () => void;
}

export function PluginDatabaseView(props: PluginDatabaseViewProps) {
  const { content, view, notebookId, onRefreshFromDisk } = props;
  const renderView = usePluginStore((s) => s.renderView);
  const handleViewAction = usePluginStore((s) => s.handleViewAction);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [html, setHtml] = useState<string>("");
  const [styles, setStyles] = useState<string>("");
  const [height, setHeight] = useState<number>(400);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const config = view.config as PluginViewConfig;
  const pluginId = config?.pluginId;
  const viewType = config?.viewType;

  // Render the plugin view
  const doRender = useCallback(async () => {
    if (!pluginId || !viewType) {
      setError("Missing plugin configuration");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = (await renderView(
        pluginId,
        viewType,
        content,
        view
      )) as { html?: string; styles?: string; height?: number };
      setHtml(result.html ?? "");
      setStyles(result.styles ?? "");
      if (result.height) setHeight(result.height);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [pluginId, viewType, content, view, renderView]);

  useEffect(() => {
    doRender();
  }, [doRender]);

  // Listen for postMessage from the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!iframeRef.current) return;
      // Only accept messages from our iframe
      if (e.source !== iframeRef.current.contentWindow) return;

      const data = e.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "plugin-view-action" && pluginId) {
        const payload = { ...data.payload, notebookId: notebookId ?? "" };
        handleViewAction(pluginId, payload)
          .then((result) => {
            const res = result as { forward_to_iframe?: boolean; message?: unknown; refresh_database?: boolean } | null;
            if (res?.forward_to_iframe && res.message && iframeRef.current?.contentWindow) {
              iframeRef.current.contentWindow.postMessage(res.message, "*");
            }
            if (res?.refresh_database && onRefreshFromDisk) {
              onRefreshFromDisk();
            }
          })
          .catch((err) =>
            console.error("Plugin view action failed:", err)
          );
      } else if (data.type === "plugin-view-resize" && typeof data.height === "number") {
        setHeight(data.height);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pluginId, handleViewAction, notebookId, onRefreshFromDisk]);

  if (loading) {
    return (
      <div className="db-plugin-view-loading">
        <div className="db-loading-spinner" />
        <span>Rendering plugin view...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="db-plugin-view-error">
        <span>Plugin view error: {error}</span>
        <button onClick={doRender} className="db-plugin-view-retry">
          Retry
        </button>
      </div>
    );
  }

  const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e0e0e0; background: transparent; }
  ${styles}
</style>
</head>
<body>${html}</body>
<script>
  // Allow plugin views to post actions back
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action]');
    if (el) {
      window.parent.postMessage({
        type: 'plugin-view-action',
        payload: JSON.parse(el.dataset.action)
      }, '*');
    }
  });
  // Auto-resize
  var ro = new ResizeObserver(function(entries) {
    for (var entry of entries) {
      window.parent.postMessage({
        type: 'plugin-view-resize',
        height: Math.ceil(entry.contentRect.height) + 16
      }, '*');
    }
  });
  ro.observe(document.body);
</script>
</html>`;

  return (
    <div className="db-plugin-view">
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts"
        style={{
          width: "100%",
          height: `${height}px`,
          border: "none",
          borderRadius: "6px",
          background: "transparent",
        }}
        title={`Plugin view: ${viewType}`}
      />
    </div>
  );
}
