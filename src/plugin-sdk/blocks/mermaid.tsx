/**
 * Mermaid diagram block — the first SDK-contributed block.
 *
 * Pure frontend render: the mermaid library is dynamically imported on first
 * render so it lands in its own bundle chunk. Diagram source lives in the
 * `code` prop (string, Editor.js `data.code` on disk). Double-click to edit;
 * blur commits.
 *
 * Inline styles only — this file is also bundled by the guest editor.
 */
import { useEffect, useRef, useState } from "react";
import type {
  CustomBlockContribution,
  CustomBlockRenderProps,
} from "../custom-block";

let mermaidModule: Promise<typeof import("mermaid")> | null = null;

function loadMermaid() {
  if (!mermaidModule) {
    mermaidModule = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
      });
      return m;
    });
  }
  return mermaidModule;
}

let renderSeq = 0;

function MermaidRender({ props, updateProps, readOnly }: CustomBlockRenderProps) {
  const code = props.code ?? "";
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!code.trim()) {
      setSvg("");
      setError(null);
      return;
    }
    let cancelled = false;
    loadMermaid()
      .then(async (m) => {
        // Unique id per render call — mermaid requires one for its temp element.
        const { svg } = await m.default.render(`nous-mermaid-${renderSeq++}`, code);
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (editing) {
      setDraft(code);
      textareaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset draft only when opening
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== code) updateProps({ code: draft });
  };

  if (editing && !readOnly) {
    return (
      <div contentEditable={false} style={{ width: "100%" }}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") commit();
            e.stopPropagation();
          }}
          rows={Math.max(4, draft.split("\n").length + 1)}
          placeholder={"graph TD\n  A[Start] --> B[End]"}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "0.85em",
            padding: "8px",
            border: "1px solid var(--color-border, #8884)",
            borderRadius: "6px",
            background: "var(--color-bg-secondary, transparent)",
            color: "inherit",
            resize: "vertical",
          }}
        />
      </div>
    );
  }

  return (
    <div
      contentEditable={false}
      onDoubleClick={readOnly ? undefined : () => setEditing(true)}
      title={readOnly ? undefined : "Double-click to edit diagram source"}
      style={{ width: "100%", cursor: readOnly ? "default" : "pointer" }}
    >
      {error ? (
        <div
          style={{
            padding: "8px 10px",
            border: "1px solid #d9534f88",
            borderRadius: "6px",
            fontSize: "0.85em",
            color: "#d9534f",
          }}
        >
          Mermaid error: {error}
        </div>
      ) : svg ? (
        // eslint-disable-next-line react/no-danger -- mermaid's own SVG output
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div
          style={{
            padding: "8px 10px",
            border: "1px dashed var(--color-border, #8884)",
            borderRadius: "6px",
            fontSize: "0.85em",
            color: "var(--color-text-muted, #888)",
          }}
        >
          Empty mermaid diagram — double-click to edit
        </div>
      )}
    </div>
  );
}

export const mermaidBlock: CustomBlockContribution = {
  id: "mermaid",
  title: "Mermaid Diagram",
  group: "Custom",
  keywords: ["mermaid", "diagram", "flowchart", "graph", "sequence"],
  propSchema: {
    code: { default: "" },
  },
  content: "none",
  Render: MermaidRender,
};
