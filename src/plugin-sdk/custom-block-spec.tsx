/**
 * Host adapter: turn a CustomBlockContribution into a BlockNote block spec.
 *
 * Kept separate from the contract so the contract module stays importable
 * without @blocknote/react. Inline styles only — this file is bundled by
 * both the desktop/web app and the guest editor, which has no Tailwind.
 */
import { createReactBlockSpec } from "@blocknote/react";
import type {
  CustomBlockContribution,
  CustomBlockRenderProps,
} from "./custom-block";
import {
  getCustomBlocks,
  isCustomBlockEnabled,
  useDisabledCustomBlocks,
} from "./custom-block";

// ─── Editor context ─────────────────────────────────────────────────────────
//
// Contributions receive { notebookId, pageId } at render time. The schema is
// built at module load (long before any editor exists), so the host registers
// the context per editor instance and the render wrapper looks it up. Hosts
// that don't register (e.g. the guest editor) yield an empty ctx.

type EditorCtx = { notebookId?: string; pageId?: string };

const editorContexts = new WeakMap<object, EditorCtx>();

/** Associate notebook/page identity with an editor instance (host-side). */
export function setCustomBlockEditorContext(
  editor: object,
  ctx: EditorCtx,
): void {
  editorContexts.set(editor, ctx);
}

// ─── Render wrapper ─────────────────────────────────────────────────────────

interface HostProps {
  contribution: CustomBlockContribution;
  block: { props: Record<string, string> };
  editor: {
    isEditable: boolean;
    updateBlock: (
      block: unknown,
      update: { props: Record<string, string> },
    ) => void;
  };
  contentRef?: (el: HTMLElement | null) => void;
}

/** Exported for tests. Renders the contribution, or a placeholder when disabled. */
export function CustomBlockHost({
  contribution,
  block,
  editor,
  contentRef,
}: HostProps) {
  const disabled = useDisabledCustomBlocks();

  if (!isCustomBlockEnabled(contribution, disabled)) {
    // Disable never unregisters: the data stays in the document untouched;
    // only the live rendering is replaced.
    return (
      <div
        contentEditable={false}
        style={{
          opacity: 0.55,
          padding: "6px 10px",
          border: "1px dashed var(--color-border, #8884)",
          borderRadius: "6px",
          fontSize: "0.85em",
          color: "var(--color-text-muted, #888)",
          userSelect: "none",
        }}
      >
        {contribution.title} is disabled — enable in Settings
      </div>
    );
  }

  const renderProps: CustomBlockRenderProps = {
    props: block.props,
    updateProps: (patch) => editor.updateBlock(block, { props: patch }),
    readOnly: !editor.isEditable,
    ctx: editorContexts.get(editor as object) ?? {},
    contentRef,
  };

  return <contribution.Render {...renderProps} />;
}

// ─── Spec adapter ───────────────────────────────────────────────────────────

/** Thin adapter onto createReactBlockSpec. */
export function toBlockSpec(contribution: CustomBlockContribution) {
  return createReactBlockSpec(
    {
      type: contribution.id,
      propSchema: contribution.propSchema,
      content: contribution.content ?? "none",
    },
    {
      render: (props) => (
        <CustomBlockHost
          contribution={contribution}
          block={props.block as HostProps["block"]}
          editor={props.editor as unknown as HostProps["editor"]}
          contentRef={
            contribution.content === "inline" ? props.contentRef : undefined
          }
        />
      ),
    },
  );
}

/** Block specs for every registered contribution, for schema assembly. */
export function buildCustomBlockSpecs(): Record<
  string,
  ReturnType<ReturnType<typeof toBlockSpec>>
> {
  return Object.fromEntries(
    getCustomBlocks().map((c) => [c.id, toBlockSpec(c)()]),
  );
}
