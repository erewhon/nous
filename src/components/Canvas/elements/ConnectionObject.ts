import * as fabric from "fabric";

export interface ConnectionOptions {
  id?: string;
  sourceId: string;
  targetId: string;
  label?: string;
  arrowEnd?: boolean;
  connectionColor?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

/**
 * Custom Fabric.js object for connection lines between cards.
 * Automatically updates when connected cards move.
 */
export class ConnectionObject extends fabric.Group {
  static type = "Connection";

  // Custom properties
  connectionId: string;
  sourceId: string;
  targetId: string;
  connectionLabel: string;
  arrowEnd: boolean;
  connectionColor: string;

  // Internal elements
  private lineElement: fabric.Line;
  private arrowHead: fabric.Triangle | null = null;
  private labelElement: fabric.Text | null = null;

  constructor(options: ConnectionOptions) {
    const connectionId = options.id ?? crypto.randomUUID();
    const arrowEnd = options.arrowEnd ?? true;
    const connectionColor = options.connectionColor ?? "#808080";
    const label = options.label ?? "";

    // Default line coordinates (will be updated when attached to cards)
    const x1 = options.x1 ?? 0;
    const y1 = options.y1 ?? 0;
    const x2 = options.x2 ?? 100;
    const y2 = options.y2 ?? 100;

    // Create the main line
    const lineElement = new fabric.Line([x1, y1, x2, y2], {
      stroke: connectionColor,
      strokeWidth: 2,
      selectable: false,
      evented: false,
    });

    const elements: fabric.FabricObject[] = [lineElement];

    // Create arrow head if enabled
    let arrowHeadElement: fabric.Triangle | null = null;
    if (arrowEnd) {
      const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
      arrowHeadElement = new fabric.Triangle({
        left: x2,
        top: y2,
        width: 12,
        height: 15,
        fill: connectionColor,
        angle: angle + 90,
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false,
      });
      elements.push(arrowHeadElement);
    }

    // Create label if provided
    let labelElement: fabric.Text | null = null;
    if (label) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      labelElement = new fabric.Text(label, {
        left: midX,
        top: midY - 15,
        fontFamily: "Inter, sans-serif",
        fontSize: 12,
        fill: connectionColor,
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false,
      });
      elements.push(labelElement);
    }

    super(elements, {
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
    });

    this.connectionId = connectionId;
    this.sourceId = options.sourceId;
    this.targetId = options.targetId;
    this.connectionLabel = label;
    this.arrowEnd = arrowEnd;
    this.connectionColor = connectionColor;
    this.lineElement = lineElement;
    this.arrowHead = arrowHeadElement;
    this.labelElement = labelElement;
  }

  /**
   * Update the connection endpoints
   */
  updateEndpoints(x1: number, y1: number, x2: number, y2: number): void {
    // Update line
    this.lineElement.set({ x1, y1, x2, y2 });

    // Update arrow head position and rotation
    if (this.arrowHead) {
      const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
      this.arrowHead.set({
        left: x2,
        top: y2,
        angle: angle + 90,
      });
    }

    // Update label position
    if (this.labelElement) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      this.labelElement.set({
        left: midX,
        top: midY - 15,
      });
    }

    this.setCoords();
    this.canvas?.renderAll();
  }

  /**
   * Update connection from source and target objects
   */
  updateFromObjects(
    source: fabric.FabricObject,
    target: fabric.FabricObject
  ): void {
    const sourceBounds = source.getBoundingRect();
    const targetBounds = target.getBoundingRect();

    // Calculate connection points (center of source to center of target)
    const sourceX = sourceBounds.left + sourceBounds.width / 2;
    const sourceY = sourceBounds.top + sourceBounds.height / 2;
    const targetX = targetBounds.left + targetBounds.width / 2;
    const targetY = targetBounds.top + targetBounds.height / 2;

    // Calculate edge points for cleaner connections
    const { x1, y1, x2, y2 } = this.calculateEdgePoints(
      sourceX,
      sourceY,
      sourceBounds.width,
      sourceBounds.height,
      targetX,
      targetY,
      targetBounds.width,
      targetBounds.height
    );

    this.updateEndpoints(x1, y1, x2, y2);
  }

  /**
   * Calculate connection points at the edges of rectangles
   */
  private calculateEdgePoints(
    cx1: number,
    cy1: number,
    w1: number,
    h1: number,
    cx2: number,
    cy2: number,
    w2: number,
    h2: number
  ): { x1: number; y1: number; x2: number; y2: number } {
    const dx = cx2 - cx1;
    const dy = cy2 - cy1;
    const angle = Math.atan2(dy, dx);

    // Calculate intersection with source edge
    const sourceIntersect = this.getEdgeIntersection(w1 / 2, h1 / 2, angle);
    const startX = cx1 + sourceIntersect.x;
    const startY = cy1 + sourceIntersect.y;

    // Calculate intersection with target edge (opposite direction)
    const targetIntersect = this.getEdgeIntersection(
      w2 / 2,
      h2 / 2,
      angle + Math.PI
    );
    const endX = cx2 + targetIntersect.x;
    const endY = cy2 + targetIntersect.y;

    return { x1: startX, y1: startY, x2: endX, y2: endY };
  }

  /**
   * Get the intersection point on the edge of a rectangle
   */
  private getEdgeIntersection(
    halfWidth: number,
    halfHeight: number,
    angle: number
  ): { x: number; y: number } {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Calculate intersection with horizontal and vertical edges
    let x: number, y: number;

    if (Math.abs(cos) * halfHeight > Math.abs(sin) * halfWidth) {
      // Intersects with left or right edge
      x = Math.sign(cos) * halfWidth;
      y = (x * sin) / cos;
    } else {
      // Intersects with top or bottom edge
      y = Math.sign(sin) * halfHeight;
      x = (y * cos) / sin;
    }

    return { x, y };
  }

  /**
   * Set the connection label
   */
  setLabel(label: string): void {
    this.connectionLabel = label;
    if (this.labelElement) {
      this.labelElement.set("text", label);
    } else if (label) {
      // Create label if it didn't exist
      const line = this.lineElement;
      const midX = ((line.x1 ?? 0) + (line.x2 ?? 0)) / 2;
      const midY = ((line.y1 ?? 0) + (line.y2 ?? 0)) / 2;
      this.labelElement = new fabric.Text(label, {
        left: midX,
        top: midY - 15,
        fontFamily: "Inter, sans-serif",
        fontSize: 12,
        fill: this.connectionColor,
        originX: "center",
        originY: "center",
      });
      this.add(this.labelElement);
    }
    this.canvas?.renderAll();
  }

  /**
   * Set the connection color
   */
  setConnectionColor(color: string): void {
    this.connectionColor = color;
    this.lineElement.set("stroke", color);
    if (this.arrowHead) {
      this.arrowHead.set("fill", color);
    }
    if (this.labelElement) {
      this.labelElement.set("fill", color);
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
      type: ConnectionObject.type,
      connectionId: this.connectionId,
      sourceId: this.sourceId,
      targetId: this.targetId,
      connectionLabel: this.connectionLabel,
      arrowEnd: this.arrowEnd,
      connectionColor: this.connectionColor,
      x1: this.lineElement.x1,
      y1: this.lineElement.y1,
      x2: this.lineElement.x2,
      y2: this.lineElement.y2,
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromObject(object: Record<string, unknown>): Promise<ConnectionObject> {
    return Promise.resolve(
      new ConnectionObject({
        id: object.connectionId as string,
        sourceId: object.sourceId as string,
        targetId: object.targetId as string,
        label: object.connectionLabel as string,
        arrowEnd: object.arrowEnd as boolean,
        connectionColor: object.connectionColor as string,
        x1: object.x1 as number,
        y1: object.y1 as number,
        x2: object.x2 as number,
        y2: object.y2 as number,
      })
    );
  }
}

// Register with Fabric.js class registry
fabric.classRegistry.setClass(ConnectionObject, ConnectionObject.type);
