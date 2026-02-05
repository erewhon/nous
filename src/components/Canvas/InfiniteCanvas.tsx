import {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import * as fabric from "fabric";
import { useCanvasStore } from "../../stores/canvasStore";
import { useCanvasPanZoom } from "./hooks/useCanvasPanZoom";
import type { CanvasToolType, CanvasPageContent } from "../../types/canvas";
import type { FabricCanvasData } from "../../types/drawing";
import { TextCardObject } from "./elements/TextCardObject";
import { PageCardObject } from "./elements/PageCardObject";
import { ConnectionObject } from "./elements/ConnectionObject";

export interface InfiniteCanvasRef {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  exportPNG: () => string | null;
  getCanvasData: () => FabricCanvasData | null;
  getFullContent: () => CanvasPageContent;
  addTextCard: (x?: number, y?: number) => void;
  addPageCard: (pageId: string, pageTitle: string, notebookId: string, x?: number, y?: number) => void;
  deleteSelected: () => void;
}

interface InfiniteCanvasProps {
  width: number;
  height: number;
  initialContent?: CanvasPageContent;
  notebookId: string;
  onContentChange?: (content: CanvasPageContent) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  onNavigateToPage?: (pageId: string) => void;
}

export const InfiniteCanvas = forwardRef<InfiniteCanvasRef, InfiniteCanvasProps>(
  function InfiniteCanvas(
    {
      width,
      height,
      initialContent,
      notebookId,
      onContentChange,
      onHistoryChange,
      onNavigateToPage,
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);
    const historyRef = useRef<string[]>([]);
    const historyIndexRef = useRef<number>(-1);
    const isLoadingRef = useRef<boolean>(false);
    const connectionSourceRef = useRef<fabric.FabricObject | null>(null);

    const {
      selectedTool,
      strokeColor,
      fillColor,
      strokeWidth,
      settings,
      viewport,
      setViewport,
      setHistoryState,
      setContent,
      setLoaded,
    } = useCanvasStore();

    // Initialize canvas pan/zoom
    useCanvasPanZoom({
      canvas: fabricRef.current,
      enabled: true,
    });

    // Save current state to history
    const saveHistory = useCallback(() => {
      if (isLoadingRef.current) return;

      const canvas = fabricRef.current;
      if (!canvas) return;

      const json = JSON.stringify(canvas.toJSON());
      const history = historyRef.current;
      const index = historyIndexRef.current;

      // Truncate any redo states
      historyRef.current = history.slice(0, index + 1);
      historyRef.current.push(json);
      historyIndexRef.current = historyRef.current.length - 1;

      // Limit history size
      if (historyRef.current.length > 50) {
        historyRef.current = historyRef.current.slice(-50);
        historyIndexRef.current = historyRef.current.length - 1;
      }

      const canUndo = historyIndexRef.current > 0;
      const canRedo = historyIndexRef.current < historyRef.current.length - 1;

      setHistoryState(canUndo, canRedo);
      onHistoryChange?.(canUndo, canRedo);

      // Notify parent of changes
      const content = getFullContent();
      setContent(content);
      onContentChange?.(content);
    }, [onContentChange, onHistoryChange, setHistoryState, setContent]);

    // Get full canvas content
    const getFullContent = useCallback((): CanvasPageContent => {
      const canvas = fabricRef.current;
      if (!canvas) {
        return {
          version: "1.0",
          fabricData: undefined,
          viewport: { panX: 0, panY: 0, zoom: 1 },
          elements: {},
          settings: settings,
        };
      }

      const fabricData = canvas.toJSON() as FabricCanvasData;

      const vpt = canvas.viewportTransform;

      return {
        version: "1.0",
        fabricData,
        viewport: vpt
          ? { panX: vpt[4], panY: vpt[5], zoom: canvas.getZoom() }
          : viewport,
        elements: {},
        settings,
      };
    }, [viewport, settings]);

    // Draw grid background
    const drawGrid = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas || !settings.gridEnabled) return;

      const gridSize = settings.gridSize;
      const zoom = canvas.getZoom();
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];

      // Clear existing grid
      const existingGrid = canvas.getObjects().filter((obj) =>
        (obj as fabric.FabricObject & { isGrid?: boolean }).isGrid
      );
      existingGrid.forEach((obj) => canvas.remove(obj));

      // Calculate visible area
      const canvasWidth = canvas.getWidth() / zoom;
      const canvasHeight = canvas.getHeight() / zoom;
      const offsetX = -vpt[4] / zoom;
      const offsetY = -vpt[5] / zoom;

      // Snap to grid
      const startX = Math.floor(offsetX / gridSize) * gridSize;
      const startY = Math.floor(offsetY / gridSize) * gridSize;
      const endX = offsetX + canvasWidth + gridSize;
      const endY = offsetY + canvasHeight + gridSize;

      // Draw vertical lines
      for (let x = startX; x <= endX; x += gridSize) {
        const line = new fabric.Line([x, startY - gridSize, x, endY], {
          stroke: "rgba(100, 100, 120, 0.2)",
          strokeWidth: 1 / zoom,
          selectable: false,
          evented: false,
        });
        (line as fabric.Line & { isGrid?: boolean }).isGrid = true;
        canvas.add(line);
        canvas.sendObjectToBack(line);
      }

      // Draw horizontal lines
      for (let y = startY; y <= endY; y += gridSize) {
        const line = new fabric.Line([startX - gridSize, y, endX, y], {
          stroke: "rgba(100, 100, 120, 0.2)",
          strokeWidth: 1 / zoom,
          selectable: false,
          evented: false,
        });
        (line as fabric.Line & { isGrid?: boolean }).isGrid = true;
        canvas.add(line);
        canvas.sendObjectToBack(line);
      }

      canvas.renderAll();
    }, [settings.gridEnabled, settings.gridSize]);

    // Initialize Fabric.js canvas
    useEffect(() => {
      if (!canvasRef.current) return;

      const canvas = new fabric.Canvas(canvasRef.current, {
        width,
        height,
        isDrawingMode: false,
        selection: true,
        backgroundColor: settings.backgroundColor,
        preserveObjectStacking: true,
      });

      fabricRef.current = canvas;

      // Load initial content if provided
      if (initialContent?.fabricData) {
        isLoadingRef.current = true;
        canvas.loadFromJSON(initialContent.fabricData).then(() => {
          // Restore viewport
          if (initialContent.viewport) {
            const { panX, panY, zoom } = initialContent.viewport;
            canvas.setViewportTransform([zoom, 0, 0, zoom, panX, panY]);
            setViewport({ panX, panY, zoom });
          }
          canvas.renderAll();
          isLoadingRef.current = false;

          // Save initial state to history
          historyRef.current = [JSON.stringify(canvas.toJSON())];
          historyIndexRef.current = 0;
          setHistoryState(false, false);
          onHistoryChange?.(false, false);
          setLoaded(true);

          // Draw grid after loading
          drawGrid();
        });
      } else {
        // Save empty state to history
        historyRef.current = [JSON.stringify(canvas.toJSON())];
        historyIndexRef.current = 0;
        setLoaded(true);
        drawGrid();
      }

      // Set up event listeners for changes
      const handleModification = () => saveHistory();

      canvas.on("object:added", handleModification);
      canvas.on("object:modified", handleModification);
      canvas.on("object:removed", handleModification);
      canvas.on("path:created", handleModification);

      // Update connections when objects move
      canvas.on("object:moving", (e) => {
        updateConnections(e.target);
      });

      // Redraw grid on viewport change
      canvas.on("after:render", () => {
        // Only redraw grid periodically to avoid performance issues
      });

      return () => {
        canvas.off("object:added", handleModification);
        canvas.off("object:modified", handleModification);
        canvas.off("object:removed", handleModification);
        canvas.off("path:created", handleModification);
        canvas.dispose();
        fabricRef.current = null;
      };
    }, []);

    // Update connections when an object moves
    const updateConnections = useCallback((movedObject: fabric.FabricObject | undefined) => {
      if (!movedObject || !fabricRef.current) return;

      const canvas = fabricRef.current;
      const connections = canvas.getObjects().filter(
        (obj) => obj instanceof ConnectionObject
      ) as ConnectionObject[];

      const objectId = (movedObject as TextCardObject | PageCardObject).cardId;
      if (!objectId) return;

      connections.forEach((conn) => {
        if (conn.sourceId === objectId || conn.targetId === objectId) {
          const source = canvas.getObjects().find(
            (obj) =>
              (obj as TextCardObject | PageCardObject).cardId === conn.sourceId
          );
          const target = canvas.getObjects().find(
            (obj) =>
              (obj as TextCardObject | PageCardObject).cardId === conn.targetId
          );

          if (source && target) {
            conn.updateFromObjects(source, target);
          }
        }
      });
    }, []);

    // Update canvas size when dimensions change
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      canvas.setDimensions({ width, height });
      canvas.renderAll();
      drawGrid();
    }, [width, height, drawGrid]);

    // Update drawing mode when tool changes
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      // Reset drawing mode
      canvas.isDrawingMode = false;
      canvas.selection = true;

      switch (selectedTool) {
        case "pen":
          canvas.isDrawingMode = true;
          canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
          canvas.freeDrawingBrush.color = strokeColor;
          canvas.freeDrawingBrush.width = strokeWidth;
          break;

        case "eraser":
          canvas.isDrawingMode = true;
          canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
          canvas.freeDrawingBrush.color = settings.backgroundColor;
          canvas.freeDrawingBrush.width = strokeWidth * 3;
          break;

        case "select":
          canvas.selection = true;
          break;

        case "pan":
          canvas.selection = false;
          break;

        default:
          // For shapes, text cards, page cards, and connections
          canvas.selection = false;
          break;
      }
    }, [selectedTool, strokeColor, strokeWidth, settings.backgroundColor]);

    // Update brush color/width when they change
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas || !canvas.freeDrawingBrush) return;

      if (selectedTool === "pen") {
        canvas.freeDrawingBrush.color = strokeColor;
        canvas.freeDrawingBrush.width = strokeWidth;
      } else if (selectedTool === "eraser") {
        canvas.freeDrawingBrush.color = settings.backgroundColor;
        canvas.freeDrawingBrush.width = strokeWidth * 3;
      }
    }, [strokeColor, strokeWidth, selectedTool, settings.backgroundColor]);

    // Handle click to add shapes and cards
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const handleMouseDown = (opt: fabric.TPointerEventInfo) => {
        if (
          selectedTool === "select" ||
          selectedTool === "pan" ||
          selectedTool === "pen" ||
          selectedTool === "eraser"
        ) {
          return;
        }

        const pointer = canvas.getScenePoint(opt.e);

        // Handle connection tool
        if (selectedTool === "connection") {
          const target = canvas.findTarget(opt.e);
          if (target && (target instanceof TextCardObject || target instanceof PageCardObject)) {
            if (!connectionSourceRef.current) {
              // First click - set source
              connectionSourceRef.current = target;
              target.set("stroke", "#60a5fa");
              canvas.renderAll();
            } else if (connectionSourceRef.current !== target) {
              // Second click - create connection
              const sourceId = (connectionSourceRef.current as TextCardObject | PageCardObject).cardId;
              const targetId = (target as TextCardObject | PageCardObject).cardId;

              const connection = new ConnectionObject({
                sourceId,
                targetId,
                x1: connectionSourceRef.current.left || 0,
                y1: connectionSourceRef.current.top || 0,
                x2: target.left || 0,
                y2: target.top || 0,
              });

              connection.updateFromObjects(connectionSourceRef.current, target);
              canvas.add(connection);

              // Reset source highlight
              connectionSourceRef.current.set("stroke", undefined);
              connectionSourceRef.current = null;
              canvas.renderAll();
            }
            return;
          } else if (connectionSourceRef.current) {
            // Clicked elsewhere - cancel connection
            connectionSourceRef.current.set("stroke", undefined);
            connectionSourceRef.current = null;
            canvas.renderAll();
          }
          return;
        }

        addShapeAtPoint(selectedTool, pointer.x, pointer.y);
      };

      canvas.on("mouse:down", handleMouseDown);

      return () => {
        canvas.off("mouse:down", handleMouseDown);
      };
    }, [selectedTool, strokeColor, fillColor, strokeWidth, notebookId]);

    // Add shape at specific point
    const addShapeAtPoint = useCallback(
      (tool: CanvasToolType, x: number, y: number) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        let shape: fabric.FabricObject | null = null;

        const commonProps = {
          left: x,
          top: y,
          fill: fillColor || "transparent",
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          originX: "center" as const,
          originY: "center" as const,
        };

        switch (tool) {
          case "rectangle":
            shape = new fabric.Rect({
              ...commonProps,
              width: 100,
              height: 80,
            });
            break;

          case "circle":
            shape = new fabric.Circle({
              ...commonProps,
              radius: 50,
            });
            break;

          case "ellipse":
            shape = new fabric.Ellipse({
              ...commonProps,
              rx: 60,
              ry: 40,
            });
            break;

          case "line":
            shape = new fabric.Line([x - 50, y, x + 50, y], {
              stroke: strokeColor,
              strokeWidth: strokeWidth,
              originX: "center",
              originY: "center",
            });
            break;

          case "arrow": {
            const arrowLine = new fabric.Line([0, 0, 80, 0], {
              stroke: strokeColor,
              strokeWidth: strokeWidth,
            });

            const arrowHead = new fabric.Triangle({
              left: 80,
              top: 0,
              width: 15,
              height: 20,
              fill: strokeColor,
              angle: 90,
              originX: "center",
              originY: "center",
            });

            shape = new fabric.Group([arrowLine, arrowHead], {
              left: x,
              top: y,
              originX: "center",
              originY: "center",
            });
            break;
          }

          case "text":
            shape = new fabric.IText("Text", {
              left: x,
              top: y,
              fontFamily: "Inter, sans-serif",
              fontSize: 20,
              fill: strokeColor,
              originX: "center",
              originY: "center",
            });
            break;

          case "textCard":
            shape = new TextCardObject({
              left: x,
              top: y,
              originX: "center",
              originY: "center",
            });
            break;

          case "pageCard":
            // This is handled separately via addPageCard
            // For click-to-add, show a placeholder
            shape = new TextCardObject({
              left: x,
              top: y,
              content: "Select a page...",
              originX: "center",
              originY: "center",
            });
            break;
        }

        if (shape) {
          canvas.add(shape);
          canvas.setActiveObject(shape);
          canvas.renderAll();
        }
      },
      [strokeColor, fillColor, strokeWidth]
    );

    // Add text card
    const addTextCard = useCallback(
      (x?: number, y?: number) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const posX = x ?? width / 2;
        const posY = y ?? height / 2;

        const textCard = new TextCardObject({
          left: posX,
          top: posY,
          originX: "center",
          originY: "center",
        });

        canvas.add(textCard);
        canvas.setActiveObject(textCard);
        canvas.renderAll();
      },
      [width, height]
    );

    // Add page card
    const addPageCard = useCallback(
      (pageId: string, pageTitle: string, notebookId: string, x?: number, y?: number) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const posX = x ?? width / 2;
        const posY = y ?? height / 2;

        const pageCard = new PageCardObject({
          pageId,
          pageTitle,
          notebookId,
          left: posX,
          top: posY,
          originX: "center",
          originY: "center",
          onNavigate: onNavigateToPage,
        });

        canvas.add(pageCard);
        canvas.setActiveObject(pageCard);
        canvas.renderAll();
      },
      [width, height, onNavigateToPage]
    );

    // Delete selected objects
    const deleteSelected = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const activeObjects = canvas.getActiveObjects();
      activeObjects.forEach((obj) => {
        // Don't delete grid lines
        if ((obj as fabric.FabricObject & { isGrid?: boolean }).isGrid) return;

        // Also delete connections to/from this object
        if (obj instanceof TextCardObject || obj instanceof PageCardObject) {
          const cardId = obj.cardId;
          const connections = canvas.getObjects().filter(
            (o) =>
              o instanceof ConnectionObject &&
              (o.sourceId === cardId || o.targetId === cardId)
          );
          connections.forEach((conn) => canvas.remove(conn));
        }

        canvas.remove(obj);
      });
      canvas.discardActiveObject();
      canvas.renderAll();
    }, []);

    // Undo
    const undo = useCallback(() => {
      if (historyIndexRef.current <= 0) return;

      const canvas = fabricRef.current;
      if (!canvas) return;

      historyIndexRef.current--;
      isLoadingRef.current = true;

      canvas.loadFromJSON(JSON.parse(historyRef.current[historyIndexRef.current])).then(() => {
        canvas.renderAll();
        isLoadingRef.current = false;
        const canUndo = historyIndexRef.current > 0;
        const canRedo = historyIndexRef.current < historyRef.current.length - 1;
        setHistoryState(canUndo, canRedo);
        onHistoryChange?.(canUndo, canRedo);

        const content = getFullContent();
        setContent(content);
        onContentChange?.(content);
      });
    }, [onHistoryChange, onContentChange, setHistoryState, setContent, getFullContent]);

    // Redo
    const redo = useCallback(() => {
      if (historyIndexRef.current >= historyRef.current.length - 1) return;

      const canvas = fabricRef.current;
      if (!canvas) return;

      historyIndexRef.current++;
      isLoadingRef.current = true;

      canvas.loadFromJSON(JSON.parse(historyRef.current[historyIndexRef.current])).then(() => {
        canvas.renderAll();
        isLoadingRef.current = false;
        const canUndo = historyIndexRef.current > 0;
        const canRedo = historyIndexRef.current < historyRef.current.length - 1;
        setHistoryState(canUndo, canRedo);
        onHistoryChange?.(canUndo, canRedo);

        const content = getFullContent();
        setContent(content);
        onContentChange?.(content);
      });
    }, [onHistoryChange, onContentChange, setHistoryState, setContent, getFullContent]);

    // Clear canvas
    const clear = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      // Remove all objects except grid
      const objects = canvas.getObjects().filter(
        (obj) => !(obj as fabric.FabricObject & { isGrid?: boolean }).isGrid
      );
      objects.forEach((obj) => canvas.remove(obj));
      canvas.renderAll();
      saveHistory();
    }, [saveHistory]);

    // Export to PNG
    const exportPNG = useCallback((): string | null => {
      const canvas = fabricRef.current;
      if (!canvas) return null;

      // Temporarily hide grid
      const gridObjects = canvas.getObjects().filter(
        (obj) => (obj as fabric.FabricObject & { isGrid?: boolean }).isGrid
      );
      gridObjects.forEach((obj) => obj.set("visible", false));

      const dataUrl = canvas.toDataURL({
        format: "png",
        quality: 1,
        multiplier: 2,
      });

      // Restore grid
      gridObjects.forEach((obj) => obj.set("visible", true));
      canvas.renderAll();

      return dataUrl;
    }, []);

    // Get canvas data as JSON
    const getCanvasData = useCallback((): FabricCanvasData | null => {
      const canvas = fabricRef.current;
      if (!canvas) return null;

      return canvas.toJSON() as FabricCanvasData;
    }, []);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      undo,
      redo,
      clear,
      exportPNG,
      getCanvasData,
      getFullContent,
      addTextCard,
      addPageCard,
      deleteSelected,
    }));

    // Handle keyboard shortcuts
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        // Don't handle shortcuts if editing text
        const activeObject = canvas.getActiveObject();
        if (activeObject instanceof fabric.IText && activeObject.isEditing) {
          return;
        }

        // Delete selected object
        if (e.key === "Delete" || e.key === "Backspace") {
          deleteSelected();
        }

        // Undo: Ctrl+Z
        if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault();
          undo();
        }

        // Redo: Ctrl+Y or Ctrl+Shift+Z
        if (
          (e.key === "y" && (e.ctrlKey || e.metaKey)) ||
          (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey)
        ) {
          e.preventDefault();
          redo();
        }

        // Duplicate: Ctrl+D
        if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          const active = canvas.getActiveObject();
          if (active) {
            active.clone().then((cloned: fabric.FabricObject) => {
              cloned.set({
                left: (active.left || 0) + 20,
                top: (active.top || 0) + 20,
              });
              canvas.add(cloned);
              canvas.setActiveObject(cloned);
              canvas.renderAll();
            });
          }
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [undo, redo, deleteSelected]);

    return (
      <div
        className="infinite-canvas-container relative"
        style={{ width, height }}
      >
        <canvas ref={canvasRef} />
      </div>
    );
  }
);
