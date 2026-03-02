/**
 * Custom callout block — replaces CalloutTool.ts.
 * Supports info/warning/tip/danger types with inline rich text content.
 */
import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

const CALLOUT_TYPES = {
  info: { icon: "ℹ️", className: "callout-info" },
  warning: { icon: "⚠️", className: "callout-warning" },
  tip: { icon: "💡", className: "callout-tip" },
  danger: { icon: "🚨", className: "callout-danger" },
} as const;

type CalloutType = keyof typeof CALLOUT_TYPES;

export const CalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      type: {
        default: "info" as const,
        values: ["info", "warning", "tip", "danger"] as const,
      },
    },
    content: "inline",
  },
  {
    render: (props) => {
      const calloutType = props.block.props.type as CalloutType;
      const config = CALLOUT_TYPES[calloutType] ?? CALLOUT_TYPES.info;

      const cycleType = () => {
        const types: CalloutType[] = ["info", "warning", "tip", "danger"];
        const currentIdx = types.indexOf(calloutType);
        const nextType = types[(currentIdx + 1) % types.length]!;
        props.editor.updateBlock(props.block, {
          props: { type: nextType },
        });
      };

      return (
        <div className={`bn-callout ${config.className}`}>
          <button
            onClick={cycleType}
            contentEditable={false}
            className="bn-callout-icon"
            title="Click to change callout type"
          >
            {config.icon}
          </button>
          <div ref={props.contentRef} className="bn-callout-content" />
        </div>
      );
    },
  },
);
