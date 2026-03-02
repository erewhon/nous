/**
 * Custom delimiter/horizontal rule — replaces @editorjs/delimiter.
 * No editable content.
 */
import { createReactBlockSpec } from "@blocknote/react";

export const DelimiterBlock = createReactBlockSpec(
  {
    type: "delimiter",
    propSchema: {},
    content: "none",
  },
  {
    render: () => (
      <div className="bn-delimiter">
        <hr />
      </div>
    ),
  },
);
