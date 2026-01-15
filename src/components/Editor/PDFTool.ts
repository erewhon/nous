import type {
  BlockTool,
  BlockToolConstructorOptions,
  ToolConfig,
} from "@editorjs/editorjs";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { PDFBlockData, PDFDisplayMode } from "../../types/pdf";
import { createPDFUploader } from "./pdfUploader";

interface PDFToolConfig extends ToolConfig {
  notebookId?: string;
  onOpenFullScreen?: (blockId: string, data: PDFBlockData) => void;
}

const DISPLAY_MODE_CONFIG: Record<
  PDFDisplayMode,
  { icon: string; label: string; height: string }
> = {
  thumbnail: { icon: "S", label: "Small", height: "200px" },
  preview: { icon: "M", label: "Medium", height: "400px" },
  full: { icon: "L", label: "Large", height: "auto" },
};

export class PDFTool implements BlockTool {
  private data: PDFBlockData;
  private config: PDFToolConfig;
  private blockId: string;
  private wrapper: HTMLDivElement | null = null;
  private viewerRoot: Root | null = null;
  private captionEl: HTMLInputElement | null = null;

  static get toolbox() {
    return {
      title: "PDF",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12h4"/><path d="M10 16h4"/><path d="M10 8h1"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get pasteConfig() {
    return {
      files: {
        mimeTypes: ["application/pdf"],
        extensions: ["pdf"],
      },
    };
  }

  constructor({
    data,
    config,
    block,
  }: BlockToolConstructorOptions<PDFBlockData, PDFToolConfig>) {
    this.config = config || {};
    this.blockId = block?.id || crypto.randomUUID();
    this.data = {
      filename: data.filename || "",
      url: data.url || "",
      originalName: data.originalName || "",
      caption: data.caption || "",
      currentPage: data.currentPage || 1,
      totalPages: data.totalPages,
      displayMode: data.displayMode || "preview",
      highlights: data.highlights || [],
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("pdf-block");

    if (this.data.url) {
      this.renderPDFViewer();
    } else {
      this.renderUploader();
    }

    return this.wrapper;
  }

  private renderUploader(): void {
    if (!this.wrapper) return;

    const uploader = document.createElement("div");
    uploader.classList.add("pdf-uploader");
    uploader.innerHTML = `
      <div class="pdf-uploader-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--color-text-muted)">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <path d="M12 12v6"/>
          <path d="M9 15l3-3 3 3"/>
        </svg>
        <p style="color: var(--color-text-secondary); margin: 8px 0 4px 0;">Click to upload a PDF</p>
        <p style="color: var(--color-text-muted); font-size: 12px;">or drag and drop</p>
      </div>
      <input type="file" accept=".pdf,application/pdf" style="display: none;" />
    `;

    const fileInput = uploader.querySelector("input") as HTMLInputElement;

    uploader.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (file) {
        await this.handleFileUpload(file);
      }
    });

    // Drag and drop
    uploader.addEventListener("dragover", (e) => {
      e.preventDefault();
      uploader.classList.add("pdf-uploader--dragover");
    });

    uploader.addEventListener("dragleave", () => {
      uploader.classList.remove("pdf-uploader--dragover");
    });

    uploader.addEventListener("drop", async (e) => {
      e.preventDefault();
      uploader.classList.remove("pdf-uploader--dragover");
      const file = e.dataTransfer?.files[0];
      if (file && (file.type === "application/pdf" || file.name.endsWith(".pdf"))) {
        await this.handleFileUpload(file);
      }
    });

    this.wrapper.appendChild(uploader);
  }

  private async handleFileUpload(file: File): Promise<void> {
    if (!this.config.notebookId || !this.wrapper) return;

    // Show loading state
    const uploader = this.wrapper.querySelector(".pdf-uploader");
    if (uploader) {
      uploader.innerHTML = `
        <div class="pdf-uploader-content">
          <svg class="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-accent)">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.75"/>
          </svg>
          <p style="color: var(--color-text-secondary); margin-top: 8px;">Uploading PDF...</p>
        </div>
      `;
    }

    const pdfUploader = createPDFUploader({ notebookId: this.config.notebookId });
    const result = await pdfUploader.uploadByFile(file);

    if (result.success) {
      this.data.url = result.file.url;
      this.data.filename = result.file.filename;
      this.data.originalName = result.file.originalName;

      // Clear wrapper and render PDF viewer
      this.wrapper.innerHTML = "";
      this.renderPDFViewer();
    } else {
      // Show error
      if (uploader) {
        uploader.innerHTML = `
          <div class="pdf-uploader-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style="color: var(--color-error); margin-top: 8px;">Failed to upload PDF</p>
            <p style="color: var(--color-text-muted); font-size: 12px;">Click to try again</p>
          </div>
        `;
      }
    }
  }

  private renderPDFViewer(): void {
    if (!this.wrapper) return;

    // Create container structure
    const container = document.createElement("div");
    container.classList.add("pdf-viewer-container");

    // Header with filename and controls
    const header = document.createElement("div");
    header.classList.add("pdf-block-header");

    const filenameEl = document.createElement("span");
    filenameEl.classList.add("pdf-filename");
    filenameEl.textContent = this.data.originalName || "PDF Document";
    filenameEl.title = this.data.originalName || "";

    const controls = document.createElement("div");
    controls.classList.add("pdf-controls");

    // Page navigation
    const pageNav = document.createElement("div");
    pageNav.classList.add("pdf-page-nav");

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.classList.add("pdf-nav-btn");
    prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    prevBtn.title = "Previous page";
    prevBtn.addEventListener("click", () => this.changePage(-1));

    const pageInfo = document.createElement("span");
    pageInfo.classList.add("pdf-page-info");
    pageInfo.textContent = `${this.data.currentPage}${this.data.totalPages ? ` / ${this.data.totalPages}` : ""}`;

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.classList.add("pdf-nav-btn");
    nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    nextBtn.title = "Next page";
    nextBtn.addEventListener("click", () => this.changePage(1));

    pageNav.appendChild(prevBtn);
    pageNav.appendChild(pageInfo);
    pageNav.appendChild(nextBtn);

    // Full screen button
    const fullScreenBtn = document.createElement("button");
    fullScreenBtn.type = "button";
    fullScreenBtn.classList.add("pdf-fullscreen-btn");
    fullScreenBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    fullScreenBtn.title = "Open in full screen";
    fullScreenBtn.addEventListener("click", () => {
      this.config.onOpenFullScreen?.(this.blockId, this.data);
    });

    controls.appendChild(pageNav);
    controls.appendChild(fullScreenBtn);

    header.appendChild(filenameEl);
    header.appendChild(controls);

    // PDF viewer container
    const viewerEl = document.createElement("div");
    viewerEl.classList.add("pdf-viewer-wrapper");
    viewerEl.id = `pdf-viewer-${this.blockId}`;

    // Caption input
    this.captionEl = document.createElement("input");
    this.captionEl.type = "text";
    this.captionEl.classList.add("pdf-caption");
    this.captionEl.placeholder = "Add a caption...";
    this.captionEl.value = this.data.caption;
    this.captionEl.addEventListener("input", () => {
      this.data.caption = this.captionEl?.value || "";
    });

    container.appendChild(header);
    container.appendChild(viewerEl);
    container.appendChild(this.captionEl);

    this.wrapper.appendChild(container);

    // Render React PDF viewer
    this.mountReactViewer(viewerEl);

    // Store reference for page info updates
    (this.wrapper as HTMLDivElement & { pageInfoEl?: HTMLSpanElement }).pageInfoEl = pageInfo;
  }

  private mountReactViewer(container: HTMLElement): void {
    // Dynamically import and render PDFViewer
    import("../PDF/PDFViewer").then(({ PDFViewer }) => {
      this.viewerRoot = createRoot(container);
      this.viewerRoot.render(
        createElement(PDFViewer, {
          url: this.data.url,
          currentPage: this.data.currentPage,
          onPageChange: (page: number) => {
            this.data.currentPage = page;
            this.updatePageInfo();
          },
          totalPages: this.data.totalPages,
          onLoadSuccess: (numPages: number) => {
            this.data.totalPages = numPages;
            this.updatePageInfo();
          },
          highlights: this.data.highlights,
          onHighlightClick: (id: string) => {
            console.log("Highlight clicked:", id);
            // TODO: Open full screen with highlight selected
          },
          displayMode: this.data.displayMode,
          zoom: 1,
          showTextLayer: true,
        })
      );
    });
  }

  private changePage(delta: number): void {
    const newPage = this.data.currentPage + delta;
    if (newPage >= 1 && (!this.data.totalPages || newPage <= this.data.totalPages)) {
      this.data.currentPage = newPage;
      this.updatePageInfo();

      // Re-render the viewer with new page
      const viewerEl = this.wrapper?.querySelector(`#pdf-viewer-${this.blockId}`);
      if (viewerEl && this.viewerRoot) {
        import("../PDF/PDFViewer").then(({ PDFViewer }) => {
          this.viewerRoot?.render(
            createElement(PDFViewer, {
              url: this.data.url,
              currentPage: this.data.currentPage,
              onPageChange: (page: number) => {
                this.data.currentPage = page;
                this.updatePageInfo();
              },
              totalPages: this.data.totalPages,
              onLoadSuccess: (numPages: number) => {
                this.data.totalPages = numPages;
                this.updatePageInfo();
              },
              highlights: this.data.highlights,
              displayMode: this.data.displayMode,
              zoom: 1,
              showTextLayer: true,
            })
          );
        });
      }
    }
  }

  private updatePageInfo(): void {
    const pageInfoEl = (this.wrapper as HTMLDivElement & { pageInfoEl?: HTMLSpanElement })?.pageInfoEl;
    if (pageInfoEl) {
      pageInfoEl.textContent = `${this.data.currentPage}${this.data.totalPages ? ` / ${this.data.totalPages}` : ""}`;
    }
  }

  save(): PDFBlockData {
    return {
      filename: this.data.filename,
      url: this.data.url,
      originalName: this.data.originalName,
      caption: this.captionEl?.value || this.data.caption,
      currentPage: this.data.currentPage,
      totalPages: this.data.totalPages,
      displayMode: this.data.displayMode,
      highlights: this.data.highlights,
    };
  }

  validate(savedData: PDFBlockData): boolean {
    return !!savedData.url;
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("pdf-settings");

    // Display mode settings
    const modeSection = document.createElement("div");
    modeSection.classList.add("pdf-settings-section");

    const modeLabel = document.createElement("div");
    modeLabel.classList.add("cdx-settings-label");
    modeLabel.textContent = "Display Size";
    modeSection.appendChild(modeLabel);

    (Object.keys(DISPLAY_MODE_CONFIG) as PDFDisplayMode[]).forEach((mode) => {
      const btn = document.createElement("div");
      btn.classList.add("cdx-settings-button");
      if (mode === this.data.displayMode) {
        btn.classList.add("cdx-settings-button--active");
      }
      btn.innerHTML = `${DISPLAY_MODE_CONFIG[mode].icon} ${DISPLAY_MODE_CONFIG[mode].label}`;
      btn.title = `Height: ${DISPLAY_MODE_CONFIG[mode].height}`;
      btn.addEventListener("click", () => {
        this.setDisplayMode(mode);
        modeSection.querySelectorAll(".cdx-settings-button").forEach((b) => {
          b.classList.remove("cdx-settings-button--active");
        });
        btn.classList.add("cdx-settings-button--active");
      });
      modeSection.appendChild(btn);
    });

    wrapper.appendChild(modeSection);

    return wrapper;
  }

  private setDisplayMode(mode: PDFDisplayMode): void {
    this.data.displayMode = mode;

    // Re-render viewer with new display mode
    const viewerEl = this.wrapper?.querySelector(`#pdf-viewer-${this.blockId}`);
    if (viewerEl && this.viewerRoot) {
      import("../PDF/PDFViewer").then(({ PDFViewer }) => {
        this.viewerRoot?.render(
          createElement(PDFViewer, {
            url: this.data.url,
            currentPage: this.data.currentPage,
            onPageChange: (page: number) => {
              this.data.currentPage = page;
              this.updatePageInfo();
            },
            totalPages: this.data.totalPages,
            onLoadSuccess: (numPages: number) => {
              this.data.totalPages = numPages;
              this.updatePageInfo();
            },
            highlights: this.data.highlights,
            displayMode: mode,
            zoom: 1,
            showTextLayer: true,
          })
        );
      });
    }
  }

  // Cleanup
  destroy(): void {
    if (this.viewerRoot) {
      this.viewerRoot.unmount();
      this.viewerRoot = null;
    }
  }
}
