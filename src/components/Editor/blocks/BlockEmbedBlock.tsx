/**
 * Custom block embed/transclusion — wraps existing BlockEmbed component.
 * Replaces BlockEmbedTool.ts.
 */
import { createReactBlockSpec } from "@blocknote/react";
import { lazy, Suspense } from "react";

const BlockEmbedComponent = lazy(() =>
  import("../BlockEmbed").then((m) => ({
    default: m.BlockEmbed,
  })),
);

export const BlockEmbedBlock = createReactBlockSpec(
  {
    type: "blockEmbed",
    propSchema: {
      targetBlockId: { default: "" },
      targetPageId: { default: "" },
      notebookId: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { targetBlockId, targetPageId, notebookId } = props.block.props;

      if (!notebookId) {
        return (
          <div className="bn-block-embed bn-block-embed-empty" contentEditable={false}>
            <span>Block embed — no notebook context</span>
          </div>
        );
      }

      return (
        <div className="bn-block-embed" contentEditable={false}>
          <Suspense fallback={<div className="bn-loading">Loading embed...</div>}>
            <BlockEmbedComponent
              targetBlockId={targetBlockId || undefined}
              targetPageId={targetPageId || undefined}
              notebookId={notebookId}
              readOnly={false}
              onBlockSelect={(blockId: string, pageId: string) => {
                props.editor.updateBlock(props.block, {
                  props: { targetBlockId: blockId, targetPageId: pageId },
                });
              }}
              onNavigate={(pageId: string) => {
                // Dispatch navigation event for the parent to handle
                document.dispatchEvent(
                  new CustomEvent("blocknote:navigate", {
                    detail: { pageId },
                  }),
                );
              }}
            />
          </Suspense>
        </div>
      );
    },
  },
);
