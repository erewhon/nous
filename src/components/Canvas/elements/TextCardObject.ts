import * as fabric from "fabric";

export interface TextCardOptions {
  id?: string;
  content?: string;
  cardWidth?: number;
  cardHeight?: number;
  cardBackgroundColor?: string;
  left?: number;
  top?: number;
  originX?: string;
  originY?: string;
}

/**
 * Custom Fabric.js object for editable text cards on the canvas.
 * Renders as a rounded rectangle with editable text content.
 */
export class TextCardObject extends fabric.Group {
  static type = "TextCard";

  // Custom properties
  cardId: string;
  cardContent: string;
  cardWidth: number;
  cardHeight: number;
  cardBackgroundColor: string;

  // Internal elements
  private background: fabric.Rect;
  private textElement: fabric.IText;

  constructor(options: TextCardOptions = {}) {
    const cardWidth = options.cardWidth ?? 200;
    const cardHeight = options.cardHeight ?? 150;
    const cardBackgroundColor = options.cardBackgroundColor ?? "#2d2d3d";
    const content = options.content ?? "New Card";
    const cardId = options.id ?? crypto.randomUUID();

    // Create background rectangle
    const background = new fabric.Rect({
      width: cardWidth,
      height: cardHeight,
      fill: cardBackgroundColor,
      rx: 8,
      ry: 8,
      stroke: "#3d3d4d",
      strokeWidth: 1,
      originX: "left",
      originY: "top",
    });

    // Create text element
    const textElement = new fabric.IText(content, {
      left: 12,
      top: 12,
      width: cardWidth - 24,
      fontFamily: "Inter, sans-serif",
      fontSize: 14,
      fill: "#e0e0e0",
      originX: "left",
      originY: "top",
      editable: true,
    });

    super([background, textElement], {
      left: options.left,
      top: options.top,
      originX: options.originX as "center" | "left" | "right" | undefined,
      originY: options.originY as "center" | "top" | "bottom" | undefined,
      subTargetCheck: true,
      interactive: true,
    });

    this.cardId = cardId;
    this.cardContent = content;
    this.cardWidth = cardWidth;
    this.cardHeight = cardHeight;
    this.cardBackgroundColor = cardBackgroundColor;
    this.background = background;
    this.textElement = textElement;

    // Set up double-click to edit text
    this.on("mousedblclick", () => {
      this.enterEditMode();
    });
  }

  /**
   * Enter text editing mode
   */
  enterEditMode(): void {
    const canvas = this.canvas;
    if (!canvas) return;

    // Make the text element editable
    this.textElement.enterEditing();
    this.textElement.selectAll();
  }

  /**
   * Update the card content
   */
  setContent(content: string): void {
    this.cardContent = content;
    this.textElement.set("text", content);
    this.canvas?.renderAll();
  }

  /**
   * Get the current card content
   */
  getContent(): string {
    return this.textElement.text || this.cardContent;
  }

  /**
   * Update the card background color
   */
  setCardBackgroundColor(color: string): void {
    this.cardBackgroundColor = color;
    this.background.set("fill", color);
    this.canvas?.renderAll();
  }

  /**
   * Resize the card
   */
  setCardSize(width: number, height: number): void {
    this.cardWidth = width;
    this.cardHeight = height;
    this.background.set({ width, height });
    this.textElement.set({ width: width - 24 });
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
      type: TextCardObject.type,
      cardId: this.cardId,
      cardContent: this.getContent(),
      cardWidth: this.cardWidth,
      cardHeight: this.cardHeight,
      cardBackgroundColor: this.cardBackgroundColor,
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromObject(object: Record<string, unknown>): Promise<TextCardObject> {
    return Promise.resolve(
      new TextCardObject({
        id: object.cardId as string,
        content: object.cardContent as string,
        cardWidth: object.cardWidth as number,
        cardHeight: object.cardHeight as number,
        cardBackgroundColor: object.cardBackgroundColor as string,
        left: object.left as number,
        top: object.top as number,
      })
    );
  }
}

// Register with Fabric.js class registry
fabric.classRegistry.setClass(TextCardObject, TextCardObject.type);
