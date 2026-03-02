/**
 * Custom drawing block — wraps existing FabricCanvas component.
 * Replaces DrawingTool.ts.
 */
import { createReactBlockSpec } from "@blocknote/react";
import { lazy, Suspense } from "react";

const FabricCanvas = lazy(() =>
  import("../../Drawing/FabricCanvas").then((m) => ({
    default: m.FabricCanvas,
  })),
);

export const DrawingBlock = createReactBlockSpec(
  {
    type: "drawing",
    propSchema: {
      canvasDataJson: { default: "" },
      width: { default: 800 },
      height: { default: 400 },
      displayMode: {
        default: "standard" as const,
        values: ["compact", "standard", "large"] as const,
      },
      caption: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { canvasDataJson, width, height, caption } =
        props.block.props;

      const canvasData = canvasDataJson ? JSON.parse(canvasDataJson) : undefined;

      if (!canvasData) {
        return (
          <div className="bn-drawing bn-drawing-empty" contentEditable={false}>
            <div className="bn-drawing-placeholder">
              <span>✏️ Click to start drawing</span>
            </div>
          </div>
        );
      }

      return (
        <div className="bn-drawing" contentEditable={false}>
          <Suspense
            fallback={<div className="bn-loading">Loading canvas...</div>}
          >
            <FabricCanvas
              width={width}
              height={height}
              initialData={canvasData}
              selectedTool="select"
              strokeColor="#000000"
              fillColor={null}
              strokeWidth={2}
              readOnly={true}
            />
          </Suspense>
          {caption && <div className="bn-drawing-caption">{caption}</div>}
        </div>
      );
    },
  },
);
