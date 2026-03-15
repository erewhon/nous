/**
 * Web BlockNote schema — mirrors the desktop schema for format compatibility.
 *
 * Interactive blocks (callout, quote, delimiter) are fully functional.
 * Desktop-only blocks (database, drawing, etc.) render as read-only placeholders
 * but their data is preserved through edits via matching propSchemas.
 */
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  defaultProps,
} from "@blocknote/core";
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  createReactStyleSpec,
} from "@blocknote/react";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import React from "react";

// ─── Interactive blocks ─────────────────────────────────────────────────────

const CALLOUT_TYPES = {
  info: { icon: "\u2139\uFE0F", className: "callout-info" },
  warning: { icon: "\u26A0\uFE0F", className: "callout-warning" },
  tip: { icon: "\uD83D\uDCA1", className: "callout-tip" },
  danger: { icon: "\uD83D\uDEA8", className: "callout-danger" },
} as const;

type CalloutType = keyof typeof CALLOUT_TYPES;

const CalloutBlock = createReactBlockSpec(
  {
    type: "callout" as const,
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      type: {
        default: "info" as const,
        values: ["info", "warning", "tip", "danger"] as const,
      },
    },
    content: "inline" as const,
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

      return React.createElement("div", { className: `bn-callout ${config.className}` },
        React.createElement("button", {
          onClick: cycleType,
          contentEditable: false,
          className: "bn-callout-icon",
          title: "Click to change callout type",
        }, config.icon),
        React.createElement("div", { ref: props.contentRef, className: "bn-callout-content" }),
      );
    },
  },
);

const QuoteBlock = createReactBlockSpec(
  {
    type: "quote" as const,
    propSchema: {
      textAlignment: defaultProps.textAlignment,
    },
    content: "inline" as const,
  },
  {
    render: (props) =>
      React.createElement("blockquote", { className: "bn-quote" },
        React.createElement("div", { ref: props.contentRef }),
      ),
  },
);

const DelimiterBlock = createReactBlockSpec(
  {
    type: "delimiter" as const,
    propSchema: {},
    content: "none" as const,
  },
  {
    render: () =>
      React.createElement("div", { className: "bn-delimiter" },
        React.createElement("hr"),
      ),
  },
);

// ─── Placeholder block factory ──────────────────────────────────────────────

function placeholderBlock<
  T extends string,
  P extends Record<string, { default: string | number | boolean; values?: readonly string[] }>,
>(type: T, propSchema: P, label: string) {
  return createReactBlockSpec(
    { type: type as T, propSchema, content: "none" as const },
    {
      render: () =>
        React.createElement("div", { className: "bn-placeholder-block" },
          React.createElement("span", { className: "bn-placeholder-label" }, label),
        ),
    },
  );
}

// ─── Placeholder blocks (data roundtrip via matching propSchemas) ───────────

const FlashcardBlock = placeholderBlock("flashcard", {
  front: { default: "" },
  back: { default: "" },
  cardType: { default: "basic" as const, values: ["basic", "cloze", "reversible"] as const },
  deckId: { default: "" },
  cardId: { default: "" },
}, "Flashcard");

const DatabaseBlock = placeholderBlock("database", {
  contentJson: { default: "" },
}, "Database");

const LiveQueryBlock = placeholderBlock("liveQuery", {
  configJson: { default: "" },
  notebookId: { default: "" },
}, "Live Query");

const BlockEmbedBlock = placeholderBlock("blockEmbed", {
  targetBlockId: { default: "" },
  targetPageId: { default: "" },
  notebookId: { default: "" },
}, "Block Embed");

const EmbedBlock = placeholderBlock("embed", {
  embedType: { default: "page" as const, values: ["page", "url"] as const },
  pageTitle: { default: "" },
  pageId: { default: "" },
  url: { default: "" },
  isCollapsed: { default: false },
  caption: { default: "" },
  displayMode: { default: "embed" as const, values: ["embed", "link"] as const },
}, "Embed");

const PDFBlock = placeholderBlock("pdf", {
  filename: { default: "" },
  url: { default: "" },
  originalName: { default: "" },
  caption: { default: "" },
  currentPage: { default: 1 },
  totalPages: { default: 0 },
  displayMode: { default: "preview" as const, values: ["thumbnail", "preview", "full"] as const },
}, "PDF");

const VideoBlock = placeholderBlock("video", {
  filename: { default: "" },
  url: { default: "" },
  caption: { default: "" },
  currentTime: { default: 0 },
  displayMode: { default: "standard" as const, values: ["compact", "standard", "large"] as const },
  transcription: { default: "" },
  transcriptionStatus: { default: "idle" as const, values: ["idle", "transcribing", "done", "error"] as const },
  showTranscript: { default: false },
}, "Video");

const AudioBlock = placeholderBlock("audio", {
  filename: { default: "" },
  url: { default: "" },
  caption: { default: "" },
  transcription: { default: "" },
  transcriptionStatus: { default: "idle" as const, values: ["idle", "transcribing", "done", "error"] as const },
  showTranscript: { default: false },
  recordedAt: { default: "" },
}, "Audio");

const DrawingBlock = placeholderBlock("drawing", {
  canvasDataJson: { default: "" },
  width: { default: 800 },
  height: { default: 400 },
  displayMode: { default: "standard" as const, values: ["compact", "standard", "large"] as const },
  caption: { default: "" },
}, "Drawing");

const PluginBlock = placeholderBlock("plugin", {
  pluginId: { default: "" },
  blockType: { default: "" },
  dataJson: { default: "{}" },
}, "Plugin");

// ─── Custom inline content ──────────────────────────────────────────────────

const WikiLinkInline = createReactInlineContentSpec(
  {
    type: "wikiLink" as const,
    propSchema: {
      pageTitle: { default: "" },
      pageId: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const { pageTitle } = props.inlineContent.props;
      return React.createElement("span", {
        className: "bn-wiki-link",
        style: {
          color: "var(--accent, #3b82f6)",
          cursor: "default",
          borderBottom: "1px dashed currentColor",
        },
      }, pageTitle || "untitled");
    },
    parse: (element) => {
      if (element.tagName.toLowerCase() === "wiki-link") {
        return {
          pageTitle: element.getAttribute("data-page-title") ?? "",
          pageId: element.getAttribute("data-page-id") ?? "",
        };
      }
      return undefined;
    },
  },
);

const BlockRefInline = createReactInlineContentSpec(
  {
    type: "blockRef" as const,
    propSchema: {
      blockId: { default: "" },
      pageId: { default: "" },
      text: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const { blockId, text } = props.inlineContent.props;
      return React.createElement("span", {
        className: "bn-block-ref",
        style: {
          color: "var(--accent, #8b5cf6)",
          cursor: "default",
          borderBottom: "1px dashed currentColor",
          fontSize: "0.95em",
        },
      }, text || `((${blockId.slice(0, 8)}))`);
    },
    parse: (element) => {
      if (element.tagName.toLowerCase() === "block-ref") {
        return {
          blockId: element.getAttribute("data-block-id") ?? "",
          pageId: element.getAttribute("data-page-id") ?? "",
          text: element.textContent ?? "",
        };
      }
      return undefined;
    },
  },
);

// ─── Custom styles ──────────────────────────────────────────────────────────

const HighlightStyle = createReactStyleSpec(
  {
    type: "highlight" as const,
    propSchema: "string",
  },
  {
    render: (props) =>
      React.createElement("mark", {
        style: {
          backgroundColor: props.value ?? "#ffff00",
          padding: "0 2px",
          borderRadius: "2px",
        },
        ref: props.contentRef,
      }),
  },
);

// ─── Schema assembly ────────────────────────────────────────────────────────

const baseSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: CalloutBlock(),
    quote: QuoteBlock(),
    delimiter: DelimiterBlock(),
    flashcard: FlashcardBlock(),
    database: DatabaseBlock(),
    liveQuery: LiveQueryBlock(),
    blockEmbed: BlockEmbedBlock(),
    embed: EmbedBlock(),
    pdf: PDFBlock(),
    video: VideoBlock(),
    audio: AudioBlock(),
    drawing: DrawingBlock(),
    plugin: PluginBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    wikiLink: WikiLinkInline,
    blockRef: BlockRefInline,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    highlight: HighlightStyle,
  },
});

export const schema = withMultiColumn(baseSchema);
export type WebSchema = typeof schema;
