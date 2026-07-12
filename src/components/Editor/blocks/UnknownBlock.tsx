/**
 * Unknown-block fallback — lossless round-trip for unrecognized block types.
 *
 * When the Editor.js → BlockNote converter meets a block type that is neither
 * built-in nor a registered custom-block contribution, it lands here with the
 * original type and data preserved verbatim in props. The reverse converter
 * re-emits the original `{type, data}`, so loading and saving a document with
 * unknown blocks is lossless (previously they were replaced by a plain
 * "[Unsupported block]" paragraph and the data was gone on next save).
 *
 * Deliberately not a plugin-sdk contribution: it must never appear in the
 * slash menu and can't be disabled.
 */
import { createReactBlockSpec } from "@blocknote/react";

export const UnknownBlock = createReactBlockSpec(
  {
    type: "unknownBlock",
    propSchema: {
      originalType: { default: "" },
      dataJson: { default: "{}" },
    },
    content: "none",
  },
  {
    render: (props) => (
      <div
        contentEditable={false}
        className="bn-unknown-block"
        style={{
          padding: "4px 10px",
          border: "1px dashed var(--color-border, #8884)",
          borderRadius: "6px",
          fontSize: "0.85em",
          color: "var(--color-text-muted, #888)",
          userSelect: "none",
        }}
        title="This block type isn't supported by this version of Nous. Its data is kept intact and will survive saving."
      >
        Unsupported block: {props.block.props.originalType || "unknown"}{" "}
        (content preserved)
      </div>
    ),
  },
);
