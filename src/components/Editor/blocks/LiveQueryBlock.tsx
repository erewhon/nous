/**
 * Custom live query block — wraps existing LiveQueryBlock component.
 * Replaces LiveQueryBlockTool.ts.
 */
import { createReactBlockSpec } from "@blocknote/react";
import { lazy, Suspense, useCallback } from "react";
import type { LiveQueryConfig } from "../../../types/liveQuery";

const LiveQueryBlockComponent = lazy(() =>
  import("../LiveQueryBlock").then((m) => ({
    default: m.LiveQueryBlock,
  })),
);

export const LiveQueryBlock = createReactBlockSpec(
  {
    type: "liveQuery",
    propSchema: {
      configJson: { default: "" },
      notebookId: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const configJson = props.block.props.configJson;
      const notebookId = props.block.props.notebookId;
      const config: LiveQueryConfig | undefined = configJson
        ? JSON.parse(configJson)
        : undefined;

      const handleConfigChange = useCallback(
        (newConfig: LiveQueryConfig) => {
          props.editor.updateBlock(props.block, {
            props: { configJson: JSON.stringify(newConfig) },
          });
        },
        [props.editor, props.block],
      );

      if (!config || !notebookId) {
        return (
          <div className="bn-live-query bn-live-query-empty" contentEditable={false}>
            <span>Live query — no configuration set</span>
          </div>
        );
      }

      return (
        <div className="bn-live-query" contentEditable={false}>
          <Suspense fallback={<div className="bn-loading">Loading query...</div>}>
            <LiveQueryBlockComponent
              config={config}
              notebookId={notebookId}
              onConfigChange={handleConfigChange}
            />
          </Suspense>
        </div>
      );
    },
  },
);
