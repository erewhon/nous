/**
 * Custom PDF viewer block — wraps existing PDFViewer component.
 * Replaces PDFTool.ts.
 */
import { createReactBlockSpec } from "@blocknote/react";
import { lazy, Suspense, useCallback } from "react";

const PDFViewer = lazy(() =>
  import("../../PDF/PDFViewer").then((m) => ({
    default: m.PDFViewer,
  })),
);

export const PDFBlock = createReactBlockSpec(
  {
    type: "pdf",
    propSchema: {
      filename: { default: "" },
      url: { default: "" },
      originalName: { default: "" },
      caption: { default: "" },
      currentPage: { default: 1 },
      totalPages: { default: 0 },
      displayMode: {
        default: "preview" as const,
        values: ["thumbnail", "preview", "full"] as const,
      },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { filename, url, originalName, caption, currentPage, displayMode } =
        props.block.props;

      const updateProps = useCallback(
        (update: Record<string, unknown>) => {
          props.editor.updateBlock(props.block, { props: update });
        },
        [props.editor, props.block],
      );

      if (!url) {
        return (
          <div className="bn-pdf bn-pdf-empty" contentEditable={false}>
            <div className="bn-pdf-upload">
              <span>📄 Drop a PDF here or click to upload</span>
            </div>
          </div>
        );
      }

      return (
        <div
          className={`bn-pdf bn-pdf-${displayMode}`}
          contentEditable={false}
        >
          <div className="bn-pdf-header">
            <span className="bn-pdf-filename">
              {filename || originalName || "PDF"}
            </span>
            <span className="bn-pdf-page-info">Page {currentPage}</span>
          </div>
          <Suspense
            fallback={<div className="bn-loading">Loading PDF...</div>}
          >
            <PDFViewer
              url={url}
              currentPage={currentPage}
              onPageChange={(page: number) =>
                updateProps({ currentPage: page })
              }
              onLoadSuccess={(numPages: number) =>
                updateProps({ totalPages: numPages })
              }
            />
          </Suspense>
          {caption && <div className="bn-pdf-caption">{caption}</div>}
        </div>
      );
    },
  },
);
