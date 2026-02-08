import * as fabric from "fabric";

export interface PageCardOptions {
  id?: string;
  pageId: string;
  pageTitle: string;
  notebookId: string;
  cardWidth?: number;
  cardHeight?: number;
  showPreview?: boolean;
  onNavigate?: (pageId: string) => void;
  left?: number;
  top?: number;
  originX?: string;
  originY?: string;
}

/**
 * Custom Fabric.js object for embedded page references on the canvas.
 * Displays page title and optional preview, clicking navigates to the page.
 */
export class PageCardObject extends fabric.Group {
  static type = "PageCard";

  // Custom properties
  cardId: string;
  pageId: string;
  pageTitle: string;
  notebookId: string;
  cardWidth: number;
  cardHeight: number;
  showPreview: boolean;
  onNavigate?: (pageId: string) => void;

  // Internal elements
  private background: fabric.Rect;
  private titleElement: fabric.Text;
  private previewElement: fabric.Text | null = null;

  constructor(options: PageCardOptions) {
    const cardWidth = options.cardWidth ?? 220;
    const cardHeight = options.cardHeight ?? 160;
    const showPreview = options.showPreview ?? true;
    const cardId = options.id ?? crypto.randomUUID();

    // Create background rectangle
    const background = new fabric.Rect({
      width: cardWidth,
      height: cardHeight,
      fill: "#252536",
      rx: 8,
      ry: 8,
      stroke: "#3b82f6",
      strokeWidth: 2,
      originX: "left",
      originY: "top",
    });

    // Create page icon (document icon using text)
    const iconElement = new fabric.Text("\u{1F4C4}", {
      left: 12,
      top: 12,
      fontSize: 20,
      originX: "left",
      originY: "top",
    });

    // Create title text
    const titleElement = new fabric.Text(options.pageTitle, {
      left: 40,
      top: 14,
      width: cardWidth - 52,
      fontFamily: "Inter, sans-serif",
      fontSize: 14,
      fontWeight: "bold",
      fill: "#e0e0e0",
      originX: "left",
      originY: "top",
    });

    const elements: fabric.FabricObject[] = [background, iconElement, titleElement];

    // Create preview text if enabled
    let previewElement: fabric.Text | null = null;
    if (showPreview) {
      previewElement = new fabric.Text("Click to open page", {
        left: 12,
        top: 50,
        width: cardWidth - 24,
        fontFamily: "Inter, sans-serif",
        fontSize: 12,
        fill: "#808080",
        originX: "left",
        originY: "top",
      });
      elements.push(previewElement);
    }

    super(elements, {
      left: options.left,
      top: options.top,
      originX: options.originX as "center" | "left" | "right" | undefined,
      originY: options.originY as "center" | "top" | "bottom" | undefined,
      subTargetCheck: false,
      interactive: true,
    });

    this.cardId = cardId;
    this.pageId = options.pageId;
    this.pageTitle = options.pageTitle;
    this.notebookId = options.notebookId;
    this.cardWidth = cardWidth;
    this.cardHeight = cardHeight;
    this.showPreview = showPreview;
    this.onNavigate = options.onNavigate;
    this.background = background;
    this.titleElement = titleElement;
    this.previewElement = previewElement;

    // Set up click to navigate
    this.on("mousedblclick", () => {
      this.navigateToPage();
    });

    // Hover effects
    this.on("mouseover", () => {
      this.background.set("stroke", "#60a5fa");
      this.canvas?.renderAll();
    });

    this.on("mouseout", () => {
      this.background.set("stroke", "#3b82f6");
      this.canvas?.renderAll();
    });
  }

  /**
   * Navigate to the linked page
   */
  navigateToPage(): void {
    if (this.onNavigate) {
      this.onNavigate(this.pageId);
    }
  }

  /**
   * Set the navigation callback
   */
  setOnNavigate(callback: (pageId: string) => void): void {
    this.onNavigate = callback;
  }

  /**
   * Update the page title
   */
  setPageTitle(title: string): void {
    this.pageTitle = title;
    this.titleElement.set("text", title);
    this.canvas?.renderAll();
  }

  /**
   * Update the preview text
   */
  setPreviewText(preview: string): void {
    if (this.previewElement) {
      this.previewElement.set("text", preview);
      this.canvas?.renderAll();
    }
  }

  /**
   * Resize the card
   */
  setCardSize(width: number, height: number): void {
    this.cardWidth = width;
    this.cardHeight = height;
    this.background.set({ width, height });
    this.titleElement.set({ width: width - 52 });
    if (this.previewElement) {
      this.previewElement.set({ width: width - 24 });
    }
    this.canvas?.renderAll();
  }

  /**
   * Serialize to JSON (for Fabric.js persistence)
   * @ts-ignore - Fabric.js toObject override with custom properties
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toObject(propertiesToInclude?: any): any {
    return {
      ...super.toObject(propertiesToInclude),
      type: PageCardObject.type,
      cardId: this.cardId,
      pageId: this.pageId,
      pageTitle: this.pageTitle,
      notebookId: this.notebookId,
      cardWidth: this.cardWidth,
      cardHeight: this.cardHeight,
      showPreview: this.showPreview,
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromObject(object: Record<string, unknown>): Promise<PageCardObject> {
    return Promise.resolve(
      new PageCardObject({
        id: object.cardId as string,
        pageId: object.pageId as string,
        pageTitle: object.pageTitle as string,
        notebookId: object.notebookId as string,
        cardWidth: object.cardWidth as number,
        cardHeight: object.cardHeight as number,
        showPreview: object.showPreview as boolean,
        left: object.left as number,
        top: object.top as number,
      })
    );
  }
}

// Register with Fabric.js class registry
fabric.classRegistry.setClass(PageCardObject, PageCardObject.type);
