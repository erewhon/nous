import type {
  BlockTool,
  BlockToolConstructorOptions,
} from "@editorjs/editorjs";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { DatabaseContentV2 } from "../../types/database";
import { createDefaultDatabaseContent } from "../../types/database";

interface DatabaseBlockData {
  content?: DatabaseContentV2;
}

export class DatabaseBlockTool implements BlockTool {
  private data: { content: DatabaseContentV2 };
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;

  static get toolbox() {
    return {
      title: "Database",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get enableLineBreaks() {
    return true;
  }

  constructor({ data }: BlockToolConstructorOptions<DatabaseBlockData>) {
    this.data = {
      content: data.content || createDefaultDatabaseContent(),
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("database-block");

    // Prevent Editor.js from intercepting keys used by database cell editing
    this.wrapper.addEventListener("keydown", (e) => {
      const key = e.key;
      if (
        key === "Tab" ||
        key === "Enter" ||
        key === "Escape" ||
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        key === "ArrowLeft" ||
        key === "ArrowRight"
      ) {
        e.stopPropagation();
      }
    });

    this.mountReactEditor();

    return this.wrapper;
  }

  private mountReactEditor(): void {
    if (!this.wrapper) return;

    import("../Database/DatabaseEditor").then(({ DatabaseEditor }) => {
      if (!this.wrapper) return;

      this.root = createRoot(this.wrapper);
      this.root.render(
        createElement(DatabaseEditor, {
          initialContent: this.data.content,
          onContentChange: (content: DatabaseContentV2) => {
            this.data.content = content;
          },
          compact: true,
        })
      );
    });
  }

  save(): DatabaseBlockData {
    return { content: this.data.content };
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
