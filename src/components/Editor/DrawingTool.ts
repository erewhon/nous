import type {
  BlockTool,
  BlockToolConstructorOptions,
  ToolConfig,
} from "@editorjs/editorjs";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type {
  DrawingBlockData,
  DrawingDisplayMode,
  FabricCanvasData,
} from "../../types/drawing";
import { DISPLAY_MODE_CONFIG } from "../../types/drawing";

interface DrawingToolConfig extends ToolConfig {
  notebookId?: string;
  onOpenFullScreen?: (blockId: string, data: DrawingBlockData) => void;
}

export class DrawingTool implements BlockTool {
  private data: DrawingBlockData;
  private config: DrawingToolConfig;
  private blockId: string;
  private wrapper: HTMLDivElement | null = null;
  private canvasRoot: Root | null = null;
  private captionEl: HTMLInputElement | null = null;
  private canvasContainerEl: HTMLDivElement | null = null;

  static get toolbox() {
    return {
      title: "Drawing",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  constructor({
    data,
    config,
    block,
  }: BlockToolConstructorOptions<DrawingBlockData, DrawingToolConfig>) {
    this.config = config || {};
    this.blockId = block?.id || crypto.randomUUID();
    this.data = {
      canvasData: data.canvasData,
      width: data.width || 800,
      height: data.height || 400,
      displayMode: data.displayMode || "standard",
      caption: data.caption || "",
      lastModified: data.lastModified,
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("drawing-block");

    if (this.data.canvasData?.objects?.length) {
      this.renderDrawingCanvas();
    } else {
      this.renderEmptyCanvas();
    }

    return this.wrapper;
  }

  private renderEmptyCanvas(): void {
    if (!this.wrapper) return;

    const placeholder = document.createElement("div");
    placeholder.classList.add("drawing-canvas-placeholder");

    const icon = document.createElement("div");
    icon.classList.add("drawing-uploader-icon");
    icon.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 19l7-7 3 3-7 7-3-3z"/>
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
        <path d="M2 2l7.586 7.586"/>
        <circle cx="11" cy="11" r="2"/>
      </svg>
    `;

    const title = document.createElement("div");
    title.classList.add("drawing-uploader-title");
    title.textContent = "Click to start drawing";

    const hint = document.createElement("div");
    hint.classList.add("drawing-uploader-hint");
    hint.textContent = "Create freehand drawings, shapes, and annotations";

    placeholder.appendChild(icon);
    placeholder.appendChild(title);
    placeholder.appendChild(hint);

    placeholder.addEventListener("click", () => {
      this.startDrawing();
    });

    this.wrapper.appendChild(placeholder);
  }

  private startDrawing(): void {
    // Initialize with empty canvas data
    this.data.canvasData = {
      version: "6.0.0",
      objects: [],
      background: "#ffffff",
    };

    // Re-render with canvas
    if (this.wrapper) {
      this.wrapper.innerHTML = "";
      this.renderDrawingCanvas();
    }
  }

  private renderDrawingCanvas(): void {
    if (!this.wrapper) return;

    // Create viewer container
    const container = document.createElement("div");
    container.classList.add("drawing-viewer-container");

    // Header with actions
    const header = document.createElement("div");
    header.classList.add("drawing-block-header");

    const leftSection = document.createElement("div");
    leftSection.classList.add("drawing-block-header-left");

    const drawingIcon = document.createElement("span");
    drawingIcon.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 19l7-7 3 3-7 7-3-3z"/>
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
      </svg>
    `;
    drawingIcon.style.color = "var(--color-text-muted)";
    leftSection.appendChild(drawingIcon);

    const label = document.createElement("span");
    label.classList.add("drawing-block-label");
    label.textContent = "Drawing";
    leftSection.appendChild(label);

    header.appendChild(leftSection);

    // Actions
    const actions = document.createElement("div");
    actions.classList.add("drawing-controls");

    // Edit button (opens full-screen)
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.classList.add("drawing-edit-btn");
    editBtn.title = "Edit in full screen";
    editBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      <span>Edit</span>
    `;
    editBtn.addEventListener("click", () => {
      if (this.config.onOpenFullScreen) {
        this.config.onOpenFullScreen(this.blockId, this.data);
      }
    });
    actions.appendChild(editBtn);

    // Fullscreen button
    const fullscreenBtn = document.createElement("button");
    fullscreenBtn.type = "button";
    fullscreenBtn.classList.add("drawing-fullscreen-btn");
    fullscreenBtn.title = "Open in full screen";
    fullscreenBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 3 21 3 21 9"/>
        <polyline points="9 21 3 21 3 15"/>
        <line x1="21" y1="3" x2="14" y2="10"/>
        <line x1="3" y1="21" x2="10" y2="14"/>
      </svg>
    `;
    fullscreenBtn.addEventListener("click", () => {
      if (this.config.onOpenFullScreen) {
        this.config.onOpenFullScreen(this.blockId, this.data);
      }
    });
    actions.appendChild(fullscreenBtn);

    header.appendChild(actions);
    container.appendChild(header);

    // Canvas container (preview)
    this.canvasContainerEl = document.createElement("div");
    this.canvasContainerEl.classList.add("drawing-canvas-wrapper");
    this.canvasContainerEl.id = `drawing-canvas-${this.blockId}`;

    const displayConfig = DISPLAY_MODE_CONFIG[this.data.displayMode];
    this.canvasContainerEl.style.height = `${displayConfig.height}px`;

    container.appendChild(this.canvasContainerEl);

    // Mount React canvas component (read-only preview)
    this.mountReactCanvas();

    // Caption
    this.captionEl = document.createElement("input");
    this.captionEl.type = "text";
    this.captionEl.classList.add("drawing-caption");
    this.captionEl.placeholder = "Add a caption...";
    this.captionEl.value = this.data.caption;
    this.captionEl.addEventListener("input", () => {
      this.data.caption = this.captionEl?.value || "";
    });

    container.appendChild(this.captionEl);
    this.wrapper.appendChild(container);
  }

  private mountReactCanvas(): void {
    if (!this.canvasContainerEl) return;

    import("../Drawing/FabricCanvas").then(({ FabricCanvas }) => {
      if (!this.canvasContainerEl) return;

      this.canvasRoot = createRoot(this.canvasContainerEl);

      const displayConfig = DISPLAY_MODE_CONFIG[this.data.displayMode];
      const containerWidth = this.canvasContainerEl.clientWidth || this.data.width;

      this.canvasRoot.render(
        createElement(FabricCanvas, {
          width: containerWidth,
          height: displayConfig.height,
          initialData: this.data.canvasData,
          selectedTool: "select",
          strokeColor: "#000000",
          fillColor: null,
          strokeWidth: 2,
          readOnly: true, // Read-only preview in editor
          onCanvasChange: (data: FabricCanvasData) => {
            this.data.canvasData = data;
            this.data.lastModified = Date.now();
          },
        })
      );
    });
  }

  save(): DrawingBlockData {
    return {
      canvasData: this.data.canvasData,
      width: this.data.width,
      height: this.data.height,
      displayMode: this.data.displayMode,
      caption: this.captionEl?.value || this.data.caption,
      lastModified: this.data.lastModified || Date.now(),
    };
  }

  validate(_savedData: DrawingBlockData): boolean {
    // Always valid - empty drawings are allowed
    return true;
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("drawing-settings");

    // Display mode section
    const modeSection = document.createElement("div");
    modeSection.classList.add("drawing-settings-section");

    const modeLabel = document.createElement("div");
    modeLabel.classList.add("drawing-settings-label");
    modeLabel.textContent = "Size";
    modeSection.appendChild(modeLabel);

    const modeButtons = document.createElement("div");
    modeButtons.classList.add("drawing-display-modes");

    (Object.keys(DISPLAY_MODE_CONFIG) as DrawingDisplayMode[]).forEach(
      (mode) => {
        const config = DISPLAY_MODE_CONFIG[mode];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("drawing-display-mode-btn");
        if (mode === this.data.displayMode) {
          btn.classList.add("drawing-display-mode-btn--active");
        }
        btn.textContent = config.label;
        btn.addEventListener("click", () => {
          this.setDisplayMode(mode);
          // Update active state
          modeButtons.querySelectorAll(".drawing-display-mode-btn").forEach((b) => {
            b.classList.remove("drawing-display-mode-btn--active");
          });
          btn.classList.add("drawing-display-mode-btn--active");
        });
        modeButtons.appendChild(btn);
      }
    );

    modeSection.appendChild(modeButtons);
    wrapper.appendChild(modeSection);

    return wrapper;
  }

  private setDisplayMode(mode: DrawingDisplayMode): void {
    this.data.displayMode = mode;

    // Update canvas height
    if (this.canvasContainerEl) {
      const config = DISPLAY_MODE_CONFIG[mode];
      this.canvasContainerEl.style.height = `${config.height}px`;

      // Re-mount canvas with new dimensions
      if (this.canvasRoot) {
        this.canvasRoot.unmount();
      }
      this.mountReactCanvas();
    }
  }

  // Method to update canvas data from full-screen editor
  updateCanvasData(data: FabricCanvasData): void {
    this.data.canvasData = data;
    this.data.lastModified = Date.now();

    // Re-render canvas preview
    if (this.canvasRoot) {
      this.canvasRoot.unmount();
    }
    this.mountReactCanvas();
  }

  destroy(): void {
    if (this.canvasRoot) {
      this.canvasRoot.unmount();
      this.canvasRoot = null;
    }
  }
}
