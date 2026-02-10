import type {
  BlockTool,
  BlockToolConstructorOptions,
  API,
  OutputData,
  BlockAPI,
} from "@editorjs/editorjs";
import EditorJS from "@editorjs/editorjs";

type ColumnCount = 2 | 3 | 4;

interface ColumnData {
  blocks: OutputData["blocks"];
}

interface ColumnsData {
  columns: ColumnCount;
  columnData: ColumnData[];
}

interface ColumnsConfig {
  // Tools configuration to pass to nested editors
  tools?: Record<string, unknown>;
  placeholder?: string;
}

export class ColumnsTool implements BlockTool {
  private api: API;
  private block: BlockAPI | undefined;
  private data: ColumnsData;
  private config: ColumnsConfig;
  private wrapper: HTMLDivElement | null = null;
  private readOnly: boolean;
  private columnEditors: (EditorJS | null)[] = [];
  private columnElements: HTMLDivElement[] = [];
  private isInitialized = false;
  // Re-entry guard: prevents onChange → save() → mutation → onChange → save()
  // infinite cascade within each nested editor.
  private _columnSaving: boolean[] = [];

  static get toolbox() {
    return {
      title: "Columns",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>',
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
    api,
    readOnly,
    block,
  }: BlockToolConstructorOptions<ColumnsData, ColumnsConfig>) {
    this.api = api;
    this.block = block;
    this.config = config || {};
    this.readOnly = readOnly || false;

    // Initialize data with defaults
    const columnCount = data.columns || 2;
    this.data = {
      columns: columnCount,
      columnData: data.columnData || [],
    };

    // Ensure columnData array has correct length
    while (this.data.columnData.length < this.data.columns) {
      this.data.columnData.push({ blocks: [] });
    }
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("columns-block");
    this.wrapper.classList.add(`columns-block--${this.data.columns}`);

    // Prevent Editor.js from handling events inside columns
    this.wrapper.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });

    this.renderColumns();

    return this.wrapper;
  }

  private renderColumns(): void {
    if (!this.wrapper) return;

    // Destroy existing editors before re-rendering
    this.destroyColumnEditors();

    this.wrapper.innerHTML = "";
    this.columnElements = [];
    this.columnEditors = [];
    this._columnSaving = [];

    // Column selector (only in edit mode)
    if (!this.readOnly) {
      const selector = document.createElement("div");
      selector.classList.add("columns-selector");

      const label = document.createElement("span");
      label.classList.add("columns-selector-label");
      label.textContent = "Columns:";
      selector.appendChild(label);

      [2, 3, 4].forEach((count) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("columns-selector-btn");
        if (count === this.data.columns) {
          btn.classList.add("columns-selector-btn--active");
        }
        btn.textContent = String(count);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.setColumnCount(count as ColumnCount);
        });
        selector.appendChild(btn);
      });

      this.wrapper.appendChild(selector);
    }

    // Columns container
    const columnsContainer = document.createElement("div");
    columnsContainer.classList.add("columns-container");
    columnsContainer.style.gridTemplateColumns = `repeat(${this.data.columns}, 1fr)`;

    // Create each column with nested editor
    for (let i = 0; i < this.data.columns; i++) {
      const column = document.createElement("div");
      column.classList.add("columns-column");
      column.dataset.columnIndex = String(i);

      const editorHolder = document.createElement("div");
      editorHolder.classList.add("columns-editor-holder");
      editorHolder.id = `column-editor-${this.block?.id || Date.now()}-${i}`;

      column.appendChild(editorHolder);
      columnsContainer.appendChild(column);
      this.columnElements.push(column);

      // Setup drag and drop for the column
      if (!this.readOnly) {
        this.setupColumnDragDrop(column, i);
      }
    }

    this.wrapper.appendChild(columnsContainer);

    // Initialize nested editors after DOM is ready
    requestAnimationFrame(() => {
      this.initializeNestedEditors();
    });
  }

  private async initializeNestedEditors(): Promise<void> {
    if (this.isInitialized) return;

    const BLOCK_DATA_MARKER = "__EDITOR_BLOCK__";

    for (let i = 0; i < this.data.columns; i++) {
      const holder = this.columnElements[i]?.querySelector(".columns-editor-holder") as HTMLElement;
      if (!holder) continue;

      const columnBlocks = this.data.columnData[i]?.blocks || [];

      // Add drop interceptor on holder to prevent nested editor from handling our block data
      holder.addEventListener("drop", (e) => {
        const text = e.dataTransfer?.getData("text/plain");
        const customData = e.dataTransfer?.getData("application/x-editor-block");

        if (customData || (text && text.startsWith(BLOCK_DATA_MARKER))) {
          // Our block data - don't let nested editor handle it
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }, true); // Capture phase

      // Also intercept paste events
      holder.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text/plain");
        if (text && text.startsWith(BLOCK_DATA_MARKER)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }, true);

      try {
        // Create a minimal tool config for nested editors
        // Use the passed tools config or create basic tools
        const tools = this.config.tools || this.getBasicTools();

        const editor = new EditorJS({
          holder: holder,
          data: { blocks: columnBlocks },
          readOnly: this.readOnly,
          minHeight: 50,
          placeholder: this.config.placeholder || "Type or drop content here...",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: tools as any,
          onChange: async () => {
            // Re-entry guard: save() may trigger DOM mutations that fire
            // another onChange via Editor.js's internal MutationObserver.
            // Without this guard, the cycle save→mutation→onChange→save
            // creates an infinite microtask cascade that freezes the WebView.
            if (this._columnSaving[i]) return;
            if (this.columnEditors[i]) {
              this._columnSaving[i] = true;
              try {
                const savedData = await this.columnEditors[i]!.save();
                this.data.columnData[i] = { blocks: savedData.blocks };
              } catch (e) {
                console.error("Failed to save column data:", e);
              } finally {
                this._columnSaving[i] = false;
              }
            }
          },
        });

        this.columnEditors[i] = editor;
      } catch (e) {
        console.error(`Failed to initialize column editor ${i}:`, e);
        this.columnEditors[i] = null;
      }
    }

    this.isInitialized = true;
  }

  private getBasicTools(): Record<string, unknown> {
    // Return basic tools that don't require external dependencies
    // The parent editor's tools will be used if provided via config
    return {
      paragraph: {
        class: (window as unknown as Record<string, unknown>).Paragraph || undefined,
        inlineToolbar: true,
      },
    };
  }

  private setupColumnDragDrop(column: HTMLDivElement, columnIndex: number): void {
    // Use capture phase (third param = true) to intercept events before nested Editor.js
    column.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      column.classList.add("columns-column--dragover");
    }, true);

    column.addEventListener("dragenter", (e) => {
      e.preventDefault();
      e.stopPropagation();
      column.classList.add("columns-column--dragover");
    }, true);

    column.addEventListener("dragleave", (e) => {
      e.preventDefault();
      const relatedTarget = e.relatedTarget as HTMLElement;
      if (!column.contains(relatedTarget)) {
        column.classList.remove("columns-column--dragover");
      }
    }, true);

    column.addEventListener("drop", (e) => {
      // Check if this is our block data - if so, handle it ourselves
      const BLOCK_DATA_MARKER = "__EDITOR_BLOCK__";
      const text = e.dataTransfer?.getData("text/plain");
      const customData = e.dataTransfer?.getData("application/x-editor-block");

      const isOurBlockData = customData || (text && text.startsWith(BLOCK_DATA_MARKER));

      if (isOurBlockData) {
        // Prevent ALL default handling including nested editor
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }

      column.classList.remove("columns-column--dragover");
      this.handleDrop(e, columnIndex);
    }, true); // Capture phase
  }

  private async handleDrop(e: DragEvent, columnIndex: number): Promise<void> {
    const editor = this.columnEditors[columnIndex];
    if (!editor) return;

    const BLOCK_DATA_MARKER = "__EDITOR_BLOCK__";

    // Helper to insert block and remove original
    const insertBlockAndRemoveOriginal = async (blockType: string, blockData: Record<string, unknown>) => {
      await editor.blocks.insert(blockType, blockData);
      const draggingBlock = document.querySelector(".ce-block--dragging");
      if (draggingBlock) {
        this.removeOriginalBlock(draggingBlock as HTMLElement);
      }
    };

    // First, check for Editor.js block data from custom drag handles (custom MIME type)
    const editorBlockData = e.dataTransfer?.getData("application/x-editor-block");
    if (editorBlockData) {
      try {
        const blockInfo = JSON.parse(editorBlockData) as {
          blockIndex: number;
          blockType: string;
          blockData: Record<string, unknown>;
        };
        await insertBlockAndRemoveOriginal(blockInfo.blockType, blockInfo.blockData);
        return;
      } catch (err) {
        console.error("Failed to parse editor block data:", err);
      }
    }

    // Check text/plain for our marked block data (fallback when custom MIME type doesn't work)
    const text = e.dataTransfer?.getData("text/plain");
    if (text && text.startsWith(BLOCK_DATA_MARKER)) {
      try {
        const jsonData = text.slice(BLOCK_DATA_MARKER.length);
        const blockInfo = JSON.parse(jsonData) as {
          blockIndex: number;
          blockType: string;
          blockData: Record<string, unknown>;
        };
        await insertBlockAndRemoveOriginal(blockInfo.blockType, blockInfo.blockData);
        return;
      } catch (err) {
        console.error("Failed to parse marked block data:", err);
      }
    }

    // Handle file drops (images)
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith("image/")) {
        // Convert to base64 and insert as image block
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          try {
            await editor.blocks.insert("image", {
              file: { url: base64 },
              caption: file.name,
              withBorder: false,
              withBackground: false,
              stretched: false,
            });
          } catch {
            // If image tool not available, insert as paragraph with link
            await editor.blocks.insert("paragraph", {
              text: `<img src="${base64}" alt="${file.name}" style="max-width:100%"/>`,
            });
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }

    // Try to handle dragged Editor.js blocks (fallback for direct DOM drag)
    const draggingBlock = document.querySelector(".ce-block--dragging");
    if (draggingBlock) {
      const blockContent = this.extractBlockData(draggingBlock as HTMLElement);
      if (blockContent) {
        await insertBlockAndRemoveOriginal(blockContent.type, blockContent.data);
        return;
      }
    }

    // Handle text/HTML drops (from external sources)
    const html = e.dataTransfer?.getData("text/html");

    if (text && !text.startsWith(BLOCK_DATA_MARKER)) {
      // Insert as plain text paragraph (only if not our block data)
      await editor.blocks.insert("paragraph", { text: text });
    } else if (html) {
      // Try to insert as HTML paragraph (stripped)
      await editor.blocks.insert("paragraph", { text: this.stripHtmlTags(html) });
    }
  }

  private stripHtmlTags(html: string): string {
    const temp = document.createElement("div");
    temp.innerHTML = html;
    return temp.textContent || "";
  }

  private extractBlockData(blockElement: HTMLElement): { type: string; data: Record<string, unknown> } | null {
    const blockContent = blockElement.querySelector(".ce-block__content");
    if (!blockContent) return null;

    // Try to identify block type
    const paragraph = blockContent.querySelector(".ce-paragraph");
    if (paragraph) {
      return { type: "paragraph", data: { text: paragraph.innerHTML } };
    }

    const header = blockContent.querySelector("[class*='ce-header']");
    if (header) {
      const level = parseInt(header.tagName.replace("H", "")) || 2;
      return { type: "header", data: { text: header.innerHTML, level } };
    }

    // Fallback to text content
    const text = blockContent.textContent?.trim();
    if (text) {
      return { type: "paragraph", data: { text } };
    }

    return null;
  }

  private removeOriginalBlock(blockElement: HTMLElement): void {
    const blocks = document.querySelectorAll(".ce-block");
    let blockIndex = -1;
    blocks.forEach((block, index) => {
      if (block === blockElement) {
        blockIndex = index;
      }
    });

    if (blockIndex >= 0) {
      try {
        this.api.blocks.delete(blockIndex);
      } catch {
        blockElement.style.display = "none";
      }
    }
  }

  private setColumnCount(count: ColumnCount): void {
    // Save current editor data before changing
    this.saveAllColumns().then(() => {
      // Ensure columnData array has correct length
      while (this.data.columnData.length < count) {
        this.data.columnData.push({ blocks: [] });
      }

      this.data.columns = count;

      // Update wrapper class
      if (this.wrapper) {
        this.wrapper.classList.remove("columns-block--2", "columns-block--3", "columns-block--4");
        this.wrapper.classList.add(`columns-block--${count}`);
      }

      // Reset initialization flag and re-render
      this.isInitialized = false;
      this.renderColumns();
    });
  }

  private async saveAllColumns(): Promise<void> {
    for (let i = 0; i < this.columnEditors.length; i++) {
      const editor = this.columnEditors[i];
      if (editor) {
        try {
          const savedData = await editor.save();
          this.data.columnData[i] = { blocks: savedData.blocks };
        } catch (e) {
          console.error(`Failed to save column ${i}:`, e);
        }
      }
    }
  }

  private destroyColumnEditors(): void {
    for (const editor of this.columnEditors) {
      if (editor) {
        try {
          editor.destroy();
        } catch (e) {
          console.error("Failed to destroy column editor:", e);
        }
      }
    }
    this.columnEditors = [];
    this.isInitialized = false;
  }

  async save(): Promise<ColumnsData> {
    // Save all column editors
    await this.saveAllColumns();

    return {
      columns: this.data.columns,
      columnData: this.data.columnData.slice(0, this.data.columns),
    };
  }

  validate(savedData: ColumnsData): boolean {
    // At least one column should have content
    return savedData.columnData.some((col) => col.blocks && col.blocks.length > 0);
  }

  destroy(): void {
    this.destroyColumnEditors();
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");

    // Column count settings
    [2, 3, 4].forEach((count) => {
      const btn = document.createElement("div");
      btn.classList.add("cdx-settings-button");
      if (count === this.data.columns) {
        btn.classList.add("cdx-settings-button--active");
      }

      const icon = this.getColumnIcon(count);
      btn.innerHTML = `${icon} ${count} Columns`;

      btn.addEventListener("click", () => {
        this.setColumnCount(count as ColumnCount);
        wrapper.querySelectorAll(".cdx-settings-button").forEach((b, i) => {
          b.classList.toggle("cdx-settings-button--active", i + 2 === count);
        });
      });

      wrapper.appendChild(btn);
    });

    return wrapper;
  }

  private getColumnIcon(count: number): string {
    switch (count) {
      case 2:
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>';
      case 3:
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="5" height="18" rx="1"/><rect x="9" y="3" width="5" height="18" rx="1"/><rect x="16" y="3" width="5" height="18" rx="1"/></svg>';
      case 4:
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="4" height="18" rx="1"/><rect x="7" y="3" width="4" height="18" rx="1"/><rect x="12" y="3" width="4" height="18" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>';
      default:
        return "";
    }
  }
}
