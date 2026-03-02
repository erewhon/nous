/**
 * Custom block-ref inline content — replaces BlockRefTool.ts.
 */
import { createReactInlineContentSpec } from "@blocknote/react";

export const BlockRefInline = createReactInlineContentSpec(
  {
    type: "blockRef",
    propSchema: {
      blockId: { default: "" },
      pageId: { default: "" },
      text: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { blockId, pageId, text } = props.inlineContent.props;

      return (
        <span
          className="bn-block-ref"
          data-block-id={blockId}
          data-page-id={pageId}
          style={{
            color: "var(--block-ref-color, #8b5cf6)",
            cursor: "pointer",
            borderBottom: "1px dashed currentColor",
            fontSize: "0.95em",
          }}
        >
          {text || `((${blockId.slice(0, 8)}))`}
        </span>
      );
    },
    parse: (element) => {
      if (element.tagName.toLowerCase() === "block-ref") {
        return {
          blockId: element.getAttribute("data-block-id") ?? "",
          pageId: element.getAttribute("data-page-id") ?? "",
          text: element.textContent ?? "",
        };
      }
      return undefined;
    },
  },
);
