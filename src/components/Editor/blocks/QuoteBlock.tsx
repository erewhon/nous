/**
 * Custom quote block — BlockNote has no built-in blockquote.
 * Replaces @editorjs/quote.
 */
import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

export const QuoteBlock = createReactBlockSpec(
  {
    type: "quote",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
    },
    content: "inline",
  },
  {
    render: (props) => (
      <blockquote className="bn-quote">
        <div ref={props.contentRef} />
      </blockquote>
    ),
  },
);
