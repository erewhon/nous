/**
 * Custom wiki-link inline content — replaces WikiLinkTool.ts.
 *
 * In BlockNote, this is a proper inline content node with typed props,
 * not an HTML custom element requiring regex-based extraction.
 */
import { createReactInlineContentSpec } from "@blocknote/react";

export const WikiLinkInline = createReactInlineContentSpec(
  {
    type: "wikiLink",
    propSchema: {
      pageTitle: { default: "" },
      pageId: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { pageTitle, pageId } = props.inlineContent.props;
      const isBroken = !pageId;

      return (
        <span
          className="bn-wiki-link"
          data-page-title={pageTitle}
          data-page-id={pageId}
          data-broken={isBroken ? "true" : undefined}
          style={{
            color: isBroken
              ? "var(--bn-colors-editor-text-muted, #999)"
              : "var(--wiki-link-color, #3b82f6)",
            textDecoration: isBroken ? "line-through" : "none",
            cursor: "pointer",
            borderBottom: "1px dashed currentColor",
          }}
        >
          {pageTitle || "untitled"}
        </span>
      );
    },
    parse: (element) => {
      if (element.tagName.toLowerCase() === "wiki-link") {
        return {
          pageTitle: element.getAttribute("data-page-title") ?? "",
          pageId: element.getAttribute("data-page-id") ?? "",
        };
      }
      return undefined;
    },
  },
);
