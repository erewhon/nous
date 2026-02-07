import type {
  BlockTool,
  BlockToolConstructorOptions,
} from "@editorjs/editorjs";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";

interface BlockEmbedData {
  targetBlockId?: string;
  targetPageId?: string;
}

interface BlockEmbedToolConfig {
  notebookId?: string;
}

export class BlockEmbedTool implements BlockTool {
  private data: BlockEmbedData;
  private notebookId: string;
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;
  private readOnly: boolean;

  static get toolbox() {
    return {
      title: "Block Embed",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get enableLineBreaks() {
    return true;
  }

  constructor({
    data,
    config,
    readOnly,
  }: BlockToolConstructorOptions<BlockEmbedData, BlockEmbedToolConfig>) {
    this.data = {
      targetBlockId: data.targetBlockId || undefined,
      targetPageId: data.targetPageId || undefined,
    };
    this.notebookId = config?.notebookId || "";
    this.readOnly = readOnly;
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("block-embed-wrapper");

    // Prevent Editor.js from intercepting keys used by the picker/editor
    this.wrapper.addEventListener("keydown", (e) => {
      const key = e.key;
      if (
        key === "Tab" ||
        key === "Enter" ||
        key === "Escape" ||
        key === "ArrowUp" ||
        key === "ArrowDown"
      ) {
        e.stopPropagation();
      }
    });

    this.mountReact();

    return this.wrapper;
  }

  private mountReact(): void {
    if (!this.wrapper) return;

    import("./BlockEmbed").then(({ BlockEmbed }) => {
      if (!this.wrapper) return;

      if (!this.root) {
        this.root = createRoot(this.wrapper);
      }
      this.root.render(
        createElement(BlockEmbed, {
          targetBlockId: this.data.targetBlockId,
          targetPageId: this.data.targetPageId,
          notebookId: this.notebookId,
          readOnly: this.readOnly,
          onBlockSelect: (blockId: string, pageId: string) => {
            this.data.targetBlockId = blockId;
            this.data.targetPageId = pageId;
            this.mountReact();
          },
          onNavigate: (pageId: string) => {
            this.wrapper?.dispatchEvent(
              new CustomEvent("blockembed:navigate", {
                detail: { pageId },
                bubbles: true,
              })
            );
          },
        })
      );
    });
  }

  save(): BlockEmbedData {
    return {
      targetBlockId: this.data.targetBlockId,
      targetPageId: this.data.targetPageId,
    };
  }

  validate(): boolean {
    return true;
  }

  destroy(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
