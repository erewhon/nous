/**
 * Renders a plugin-defined page type in a sandboxed iframe.
 * Follows the same pattern as PluginSidebarPanel and PluginDatabaseView.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  usePluginStore,
  type PluginPageType,
} from "../../stores/pluginStore";
import type { Page } from "../../types/page";

interface PluginPageViewProps {
  page: Page;
  notebookId: string;
  pluginPageType: PluginPageType;
  className?: string;
}

export function PluginPageView({
  page,
  notebookId,
  pluginPageType,
  className,
}: PluginPageViewProps) {
  const renderPage = usePluginStore((s) => s.renderPage);
  const handlePageAction = usePluginStore((s) => s.handlePageAction);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doRender = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await renderPage(
        pluginPageType.pluginId,
        pluginPageType.pageTypeId,
        {
          page_id: page.id,
          notebook_id: notebookId,
          title: page.title,
          plugin_data: page.pluginData ?? null,
        }
      )) as { html?: string };
      setHtml(result.html ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [
    pluginPageType.pluginId,
    pluginPageType.pageTypeId,
    page.id,
    page.title,
    page.pluginData,
    notebookId,
    renderPage,
  ]);

  useEffect(() => {
    doRender();
  }, [doRender]);

  // Listen for postMessage from the iframe
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (!iframeRef.current) return;
      if (e.source !== iframeRef.current.contentWindow) return;

      const msg = e.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "plugin-page-action" && pluginPageType.pluginId) {
        try {
          // Inject page_id into the action payload
          const payload = { ...msg.payload, page_id: page.id, notebook_id: notebookId };
          const result = (await handlePageAction(
            pluginPageType.pluginId,
            payload
          )) as {
            html?: string;
            forward_to_iframe?: boolean;
            message?: unknown;
            plugin_data?: unknown;
          } | null;

          // If plugin returns updated data, persist it
          if (result?.plugin_data !== undefined) {
            await invoke("update_page", {
              notebookId,
              pageId: page.id,
              pluginData: result.plugin_data,
            }).catch((err: unknown) =>
              console.error("Failed to persist plugin page data:", err)
            );
          }

          if (
            result?.forward_to_iframe &&
            result.message &&
            iframeRef.current?.contentWindow
          ) {
            iframeRef.current.contentWindow.postMessage(result.message, "*");
          } else if (result?.html) {
            setHtml(result.html);
          }
        } catch (err) {
          console.error("Plugin page action failed:", err);
        }
      } else if (msg.type === "plugin-page-update-data") {
        // Direct data update from iframe
        try {
          await invoke("update_page", {
            notebookId,
            pageId: page.id,
            pluginData: msg.data,
          });
        } catch (err) {
          console.error("Failed to save plugin page data:", err);
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pluginPageType.pluginId, handlePageAction, notebookId, page.id]);

  const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; overflow-x: hidden; height: 100%; }
</style>
</head>
<body>${html}</body>
</html>`;

  return (
    <div className={`flex flex-col flex-1 ${className ?? ""}`}>
      {loading && (
        <div
          className="flex items-center justify-center p-8"
          style={{ color: "var(--color-text-dim)" }}
        >
          <span className="text-sm">Loading plugin page...</span>
        </div>
      )}
      {error && (
        <div className="p-4 text-sm" style={{ color: "#ef4444" }}>
          <p>Failed to render plugin page: {error}</p>
          <button
            onClick={doRender}
            className="mt-2 underline"
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
            flex: 1,
            border: "none",
            background: "transparent",
          }}
          title={`Plugin page: ${pluginPageType.label}`}
        />
      )}
    </div>
  );
}
