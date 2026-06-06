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

      // Broken-state styling is owned by the "nous.wiki-link" document
      // processor: it resolves titles against the live page index and injects
      // a higher-specificity override. The base resolved appearance lives in
      // blocknote-wiki-link.css so that override can win. When the processor
      // is disabled, links simply render resolved.
      return (
        <span
          className="bn-wiki-link"
          data-page-title={pageTitle}
          data-page-id={pageId}
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
