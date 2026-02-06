import type { InlineTool, API } from "@editorjs/editorjs";

interface BlockRefToolConfig {
  onBlockRefClick?: (blockId: string, pageId: string) => void;
}

/**
 * BlockRef Inline Tool for Editor.js
 * Creates ((block-ref)) references for block-level bi-directional linking
 */
export class BlockRefTool implements InlineTool {
  private api: API;
  private button: HTMLButtonElement | null = null;
  private config: BlockRefToolConfig;
  private _state: boolean = false;

  static get isInline() {
    return true;
  }

  static get sanitize() {
    return {
      "block-ref": {
        "data-block-id": true,
        "data-page-id": true,
      },
    };
  }

  static get title() {
    return "Block Reference";
  }

  constructor({ api, config }: { api: API; config?: BlockRefToolConfig }) {
    this.api = api;
    this.config = config || {};
  }

  render(): HTMLButtonElement {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </svg>
    `;
    this.button.classList.add("ce-inline-tool");

    return this.button;
  }

  surround(range: Range): void {
    if (this._state) {
      this.unwrap(range);
    } else {
      this.wrap(range);
    }
  }

  private wrap(range: Range): void {
    const selectedText = range.extractContents();
    const text = selectedText.textContent || "";

    const blockRef = document.createElement("block-ref");
    blockRef.setAttribute("data-block-id", "");
    blockRef.setAttribute("data-page-id", "");
    blockRef.textContent = text;

    blockRef.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const blockId = blockRef.getAttribute("data-block-id");
      const pageId = blockRef.getAttribute("data-page-id");
      if (blockId && pageId && this.config.onBlockRefClick) {
        this.config.onBlockRefClick(blockId, pageId);
      }
    });

    range.insertNode(blockRef);
    this.api.selection.expandToTag(blockRef);
  }

  private unwrap(_range: Range): void {
    const blockRef = this.api.selection.findParentTag("BLOCK-REF");
    if (!blockRef) return;

    const text = blockRef.textContent || "";
    const textNode = document.createTextNode(text);

    blockRef.parentNode?.replaceChild(textNode, blockRef);
  }

  checkState(): boolean {
    const blockRef = this.api.selection.findParentTag("BLOCK-REF");
    this._state = !!blockRef;

    if (this.button) {
      this.button.classList.toggle("ce-inline-tool--active", this._state);
    }

    return this._state;
  }

  /**
   * Extract block references from Editor.js blocks
   * Returns array of { blockId, pageId } for each <block-ref> found
   */
  static extractBlockRefs(
    blocks: Array<{ type: string; data: Record<string, unknown> }>
  ): Array<{ blockId: string; pageId: string }> {
    const refs: Array<{ blockId: string; pageId: string }> = [];
    const blockRefRegex =
      /<block-ref\s+data-block-id="([^"]*?)"\s+data-page-id="([^"]*?)"[^>]*>/g;
    // Also match with attributes in reverse order
    const blockRefRegexAlt =
      /<block-ref\s+data-page-id="([^"]*?)"\s+data-block-id="([^"]*?)"[^>]*>/g;

    const extractFromText = (text: string) => {
      let match;
      blockRefRegex.lastIndex = 0;
      while ((match = blockRefRegex.exec(text)) !== null) {
        if (match[1] && match[2]) {
          refs.push({ blockId: match[1], pageId: match[2] });
        }
      }
      blockRefRegexAlt.lastIndex = 0;
      while ((match = blockRefRegexAlt.exec(text)) !== null) {
        if (match[2] && match[1]) {
          refs.push({ blockId: match[2], pageId: match[1] });
        }
      }
    };

    for (const block of blocks) {
      if (
        (block.type === "paragraph" || block.type === "header") &&
        typeof block.data.text === "string"
      ) {
        extractFromText(block.data.text);
      }

      if (block.type === "list" && Array.isArray(block.data.items)) {
        for (const item of block.data.items) {
          if (typeof item === "string") {
            extractFromText(item);
          }
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return refs.filter((r) => {
      const key = `${r.blockId}:${r.pageId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Update block-ref preview text to match the current content of target blocks.
   * Keeps inline previews fresh when the referenced block is edited elsewhere.
   */
  static updateBlockRefPreviews(
    container: HTMLElement,
    pages: Array<{
      id: string;
      content?: { blocks: Array<{ id: string; type: string; data: Record<string, unknown> }> };
    }>
  ): void {
    const refs = container.querySelectorAll("block-ref");
    if (refs.length === 0) return;

    // Build a map of blockId -> plain text preview
    const blockTextMap = new Map<string, string>();
    for (const page of pages) {
      if (!page.content?.blocks) continue;
      for (const block of page.content.blocks) {
        let text = "";
        if (
          (block.type === "paragraph" || block.type === "header") &&
          typeof block.data.text === "string"
        ) {
          const tmp = document.createElement("div");
          tmp.innerHTML = block.data.text;
          text = tmp.textContent || tmp.innerText || "";
        } else if (block.type === "list" && Array.isArray(block.data.items)) {
          text = block.data.items
            .map((item: unknown) => {
              if (typeof item !== "string") return "";
              const tmp = document.createElement("div");
              tmp.innerHTML = item;
              return tmp.textContent || tmp.innerText || "";
            })
            .join(" ");
        }
        if (text) {
          blockTextMap.set(
            block.id,
            text.length > 120 ? text.slice(0, 120) + "..." : text
          );
        }
      }
    }

    refs.forEach((ref) => {
      const blockId = ref.getAttribute("data-block-id");
      if (!blockId) return;
      const freshText = blockTextMap.get(blockId);
      if (freshText && ref.textContent !== freshText) {
        ref.textContent = freshText;
      }
    });
  }

  /**
   * Mark block references as broken if their target block no longer exists
   */
  static markBrokenBlockRefs(
    container: HTMLElement,
    pages: Array<{
      id: string;
      content?: { blocks: Array<{ id: string }> };
    }>
  ): void {
    const refs = container.querySelectorAll("block-ref");

    // Build a set of all existing block IDs
    const existingBlockIds = new Set<string>();
    for (const page of pages) {
      if (page.content?.blocks) {
        for (const block of page.content.blocks) {
          existingBlockIds.add(block.id);
        }
      }
    }

    refs.forEach((ref) => {
      const blockId = ref.getAttribute("data-block-id");
      if (!blockId) {
        ref.classList.add("broken");
        return;
      }
      ref.classList.toggle("broken", !existingBlockIds.has(blockId));
    });
  }
}
