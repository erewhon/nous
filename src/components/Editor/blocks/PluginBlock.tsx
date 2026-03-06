/**
 * Custom plugin block — renders plugin-generated HTML in a sandboxed iframe.
 * Mirrors the PluginDatabaseView pattern for editor blocks.
 */
import { createReactBlockSpec } from "@blocknote/react";
import { useState, useEffect, useRef, useCallback } from "react";
import { usePluginStore } from "../../../stores/pluginStore";
import { useNotebookStore } from "../../../stores/notebookStore";

function PluginBlockRenderer(props: {
  pluginId: string;
  blockType: string;
  dataJson: string;
  editor: any;
  block: any;
}) {
  const { pluginId, blockType, dataJson, editor, block } = props;
  const renderBlock = usePluginStore((s) => s.renderBlock);
  const handleBlockAction = usePluginStore((s) => s.handleBlockAction);
  const notebookId = useNotebookStore((s) => s.selectedNotebookId);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [html, setHtml] = useState("");
  const [styles, setStyles] = useState("");
  const [height, setHeight] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doRender = useCallback(async () => {
    if (!pluginId || !blockType) {
      setError("Missing plugin configuration");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = dataJson ? JSON.parse(dataJson) : {};
      // Inject notebook context so plugins can access databases
      if (notebookId) {
        data.notebook_id = notebookId;
      }
      const result = (await renderBlock(pluginId, blockType, data)) as {
        html?: string;
        styles?: string;
        height?: number;
      };
      setHtml(result.html ?? "");
      setStyles(result.styles ?? "");
      if (result.height) setHeight(result.height);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [pluginId, blockType, dataJson, renderBlock, notebookId]);

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

      if (msg.type === "plugin-block-action" && pluginId) {
        handleBlockAction(pluginId, msg.payload).catch((err) =>
          console.error("Plugin block action failed:", err),
        );
      } else if (msg.type === "plugin-block-resize" && typeof msg.height === "number") {
        setHeight(msg.height);
      } else if (msg.type === "plugin-block-update-data" && typeof msg.dataJson === "string") {
        editor.updateBlock(block, {
          props: { dataJson: msg.dataJson },
        });
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pluginId, handleBlockAction, editor, block]);

  if (loading) {
    return (
      <div
        style={{
          padding: "16px",
          color: "#888",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span>Loading plugin block...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: "12px",
          color: "#ef4444",
          background: "rgba(239,68,68,0.1)",
          borderRadius: "6px",
        }}
      >
        <span>Plugin block error: {error}</span>
        <button
          onClick={doRender}
          style={{
            marginLeft: "8px",
            padding: "2px 8px",
            border: "1px solid currentColor",
            borderRadius: "4px",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
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
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action]');
    if (el) {
      window.parent.postMessage({
        type: 'plugin-block-action',
        payload: JSON.parse(el.dataset.action)
      }, '*');
    }
  });
  var ro = new ResizeObserver(function(entries) {
    for (var entry of entries) {
      window.parent.postMessage({
        type: 'plugin-block-resize',
        height: Math.ceil(entry.contentRect.height) + 16
      }, '*');
    }
  });
  ro.observe(document.body);
</script>
</html>`;

  return (
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
        display: "block",
      }}
      title={`Plugin block: ${blockType}`}
    />
  );
}

export const PluginBlock = createReactBlockSpec(
  {
    type: "plugin",
    propSchema: {
      pluginId: { default: "" },
      blockType: { default: "" },
      dataJson: { default: "{}" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { pluginId, blockType, dataJson } = props.block.props;

      return (
        <div className="bn-plugin-block" contentEditable={false}>
          <PluginBlockRenderer
            pluginId={pluginId}
            blockType={blockType}
            dataJson={dataJson}
            editor={props.editor}
            block={props.block}
          />
        </div>
      );
    },
  },
);
