/**
 * Shared guest schema.
 *
 * Default BlockNote specs plus the SDK-contributed custom blocks from the
 * main app (imported from the same plugin-sdk registry the desktop schema
 * uses), so guests render contributed types like mermaid instead of hitting
 * BlockNote's unknown-type throw. Contributions are compiled in — desktop
 * and guest bundles built from the same commit agree on the schema.
 */
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { registerBuiltinBlocks } from "../../../src/plugin-sdk/blocks";
import { buildCustomBlockSpecs } from "../../../src/plugin-sdk/custom-block-spec";

registerBuiltinBlocks();

export const guestSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    ...buildCustomBlockSpecs(),
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});
