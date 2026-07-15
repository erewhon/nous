/**
 * Built-in custom blocks.
 *
 * Importing this module and calling registerBuiltinBlocks() registers the
 * block contributions that ship with Nous. Both editor hosts (the app's
 * schema.ts and the guest editor) call it before building their BlockNote
 * schema so every client agrees on the block types. New built-ins register
 * here.
 */
import { registerCustomBlock } from "../custom-block";
import { mermaidBlock } from "./mermaid";
import { animationBlock } from "./animation";
import { externalDataBlock } from "./externalData";

let registered = false;

/** Register all built-in custom blocks. Idempotent. */
export function registerBuiltinBlocks(): void {
  if (registered) return;
  registered = true;
  registerCustomBlock(mermaidBlock);
  registerCustomBlock(animationBlock);
  registerCustomBlock(externalDataBlock);
}
