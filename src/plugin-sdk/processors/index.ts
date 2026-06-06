/**
 * Built-in document processors.
 *
 * Importing this module registers the processors that ship with Nous. The
 * editor host imports it for its side effect before reading the registry.
 * New built-ins (spell-check, tag suggester, outline, …) register here.
 */
import { registerDocumentProcessor } from "../document-processor";
import { wikiLinkProcessor } from "./wikiLinkProcessor";

let registered = false;

/** Register all built-in processors. Idempotent. */
export function registerBuiltinProcessors(): void {
  if (registered) return;
  registered = true;
  registerDocumentProcessor(wikiLinkProcessor);
}
