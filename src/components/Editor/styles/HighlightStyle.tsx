/**
 * Custom highlight style — replaces HighlighterTool.ts.
 * Supports multiple colors via string prop (e.g., "#ffff00", "yellow").
 */
import { createReactStyleSpec } from "@blocknote/react";

export const HighlightStyle = createReactStyleSpec(
  {
    type: "highlight",
    propSchema: "string",
  },
  {
    render: (props) => (
      <mark
        style={{
          backgroundColor: props.value ?? "#ffff00",
          padding: "0 2px",
          borderRadius: "2px",
        }}
        ref={props.contentRef}
      />
    ),
  },
);
