import type {
  BlockTool,
  BlockToolConstructorOptions,
} from "@editorjs/editorjs";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { LiveQueryConfig } from "../../types/liveQuery";

interface LiveQueryBlockData {
  config?: LiveQueryConfig;
}

interface LiveQueryToolConfig {
  notebookId?: string;
}

export class LiveQueryBlockTool implements BlockTool {
  private data: { config: LiveQueryConfig };
  private notebookId: string;
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;

  static get toolbox() {
    return {
      title: "Live Query",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get enableLineBreaks() {
    return true;
  }

  constructor({ data, config }: BlockToolConstructorOptions<LiveQueryBlockData, LiveQueryToolConfig>) {
    this.data = {
      config: data.config || { filters: [] },
    };
    this.notebookId = config?.notebookId || "";
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("live-query-block-wrapper");

    // Prevent Editor.js from intercepting keys used by the config panel
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

    import("./LiveQueryBlock").then(({ LiveQueryBlock }) => {
      if (!this.wrapper) return;

      if (!this.root) {
        this.root = createRoot(this.wrapper);
      }
      this.root.render(
        createElement(LiveQueryBlock, {
          config: this.data.config,
          notebookId: this.notebookId,
          onConfigChange: (config: LiveQueryConfig) => {
            this.data.config = config;
            // Re-render React tree with updated config prop
            this.mountReact();
          },
          onPageClick: (pageId: string) => {
            this.wrapper?.dispatchEvent(
              new CustomEvent("livequery:navigate", {
                detail: { pageId },
                bubbles: true,
              })
            );
          },
        })
      );
    });
  }

  save(): LiveQueryBlockData {
    return { config: this.data.config };
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
