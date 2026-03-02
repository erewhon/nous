/**
 * Custom database block — wraps existing DatabaseEditor component.
 * Replaces DatabaseBlockTool.ts.
 */
import { createReactBlockSpec } from "@blocknote/react";
import { lazy, Suspense, useCallback } from "react";
import type { DatabaseContentV2 } from "../../../types/database";

const DatabaseEditor = lazy(() =>
  import("../../Database/DatabaseEditor").then((m) => ({
    default: m.DatabaseEditor,
  })),
);

export const DatabaseBlock = createReactBlockSpec(
  {
    type: "database",
    propSchema: {
      // Content stored as serialized JSON string to fit BlockNote's string-only props
      contentJson: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const contentJson = props.block.props.contentJson;
      const content: DatabaseContentV2 | undefined = contentJson
        ? JSON.parse(contentJson)
        : undefined;

      const handleChange = useCallback(
        (newContent: DatabaseContentV2) => {
          props.editor.updateBlock(props.block, {
            props: { contentJson: JSON.stringify(newContent) },
          });
        },
        [props.editor, props.block],
      );

      return (
        <div className="bn-database" contentEditable={false}>
          <Suspense fallback={<div className="bn-loading">Loading database...</div>}>
            <DatabaseEditor
              initialContent={content}
              onContentChange={handleChange}
              compact={true}
            />
          </Suspense>
        </div>
      );
    },
  },
);
