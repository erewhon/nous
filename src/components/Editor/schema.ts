/**
 * BlockNote schema with all custom blocks, inline content, and styles.
 *
 * This schema is the single source of truth for the editor's type system.
 * It defines every block type, inline content type, and style that can
 * appear in the editor.
 */
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { withMultiColumn } from "@blocknote/xl-multi-column";

// Custom blocks
import { CalloutBlock } from "./blocks/CalloutBlock";
import { QuoteBlock } from "./blocks/QuoteBlock";
import { DelimiterBlock } from "./blocks/DelimiterBlock";
import { FlashcardBlock } from "./blocks/FlashcardBlock";
import { DatabaseBlock } from "./blocks/DatabaseBlock";
import { LiveQueryBlock } from "./blocks/LiveQueryBlock";
import { BlockEmbedBlock } from "./blocks/BlockEmbedBlock";
import { EmbedBlock } from "./blocks/EmbedBlock";
import { PDFBlock } from "./blocks/PDFBlock";
import { VideoBlock } from "./blocks/VideoBlock";
import { AudioBlock } from "./blocks/AudioBlock";
import { DrawingBlock } from "./blocks/DrawingBlock";
import { PluginBlock } from "./blocks/PluginBlock";

// Custom inline content
import { WikiLinkInline } from "./inline/WikiLinkInline";
import { BlockRefInline } from "./inline/BlockRefInline";

// Custom styles
import { HighlightStyle } from "./styles/HighlightStyle";

// Unknown-type fallback (lossless round-trip for unrecognized blocks)
import { UnknownBlock } from "./blocks/UnknownBlock";

// SDK-contributed blocks (plugin contribution point)
import { registerBuiltinBlocks } from "../../plugin-sdk/blocks";
import { buildCustomBlockSpecs } from "../../plugin-sdk/custom-block-spec";

// Contributions must be registered before the schema is built — the schema
// is static per build, so every client of the same version agrees on it.
registerBuiltinBlocks();

// createReactBlockSpec returns a factory — call it to get the BlockSpec
const baseSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    // Custom blocks
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
    unknownBlock: UnknownBlock(),
    // SDK-contributed blocks
    ...buildCustomBlockSpecs(),
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

// Add multi-column support (replaces ColumnsTool's nested Editor.js hack)
export const schema = withMultiColumn(baseSchema);

export type NousSchema = typeof schema;
