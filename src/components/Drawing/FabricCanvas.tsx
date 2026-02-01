import {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import * as fabric from "fabric";
import type { DrawingToolType, FabricCanvasData } from "../../types/drawing";

export interface FabricCanvasRef {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  exportPNG: () => string | null;
  getCanvasData: () => FabricCanvasData | null;
  addShape: (shape: DrawingToolType) => void;
}

interface FabricCanvasProps {
  width: number;
  height: number;
  initialData?: FabricCanvasData;
  selectedTool: DrawingToolType;
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  readOnly?: boolean;
  backgroundColor?: string;
  onCanvasChange?: (data: FabricCanvasData) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
}

export const FabricCanvas = forwardRef<FabricCanvasRef, FabricCanvasProps>(
  function FabricCanvas(
    {
      width,
      height,
      initialData,
      selectedTool,
      strokeColor,
      fillColor,
      strokeWidth,
      readOnly = false,
      backgroundColor = "#ffffff",
      onCanvasChange,
      onHistoryChange,
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);
    const historyRef = useRef<string[]>([]);
    const historyIndexRef = useRef<number>(-1);
    const isLoadingRef = useRef<boolean>(false);

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

      onHistoryChange?.(
        historyIndexRef.current > 0,
        historyIndexRef.current < historyRef.current.length - 1
      );

      // Notify parent of changes
      onCanvasChange?.(JSON.parse(json));
    }, [onCanvasChange, onHistoryChange]);

    // Initialize Fabric.js canvas
    useEffect(() => {
      if (!canvasRef.current) return;

      const canvas = new fabric.Canvas(canvasRef.current, {
        width,
        height,
        isDrawingMode: false,
        selection: true,
        backgroundColor,
        preserveObjectStacking: true,
      });

      fabricRef.current = canvas;

      // Load initial data if provided
      if (initialData) {
        isLoadingRef.current = true;
        canvas.loadFromJSON(initialData).then(() => {
          canvas.renderAll();
          isLoadingRef.current = false;
          // Save initial state to history
          historyRef.current = [JSON.stringify(canvas.toJSON())];
          historyIndexRef.current = 0;
          onHistoryChange?.(false, false);
        });
      } else {
        // Save empty state to history
        historyRef.current = [JSON.stringify(canvas.toJSON())];
        historyIndexRef.current = 0;
      }

      // Set up event listeners for changes
      const handleModification = () => saveHistory();

      canvas.on("object:added", handleModification);
      canvas.on("object:modified", handleModification);
      canvas.on("object:removed", handleModification);
      canvas.on("path:created", handleModification);

      return () => {
        canvas.off("object:added", handleModification);
        canvas.off("object:modified", handleModification);
        canvas.off("object:removed", handleModification);
        canvas.off("path:created", handleModification);
        canvas.dispose();
        fabricRef.current = null;
      };
    }, []);

    // Update canvas size when dimensions change
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      canvas.setDimensions({ width, height });
      canvas.renderAll();
    }, [width, height]);

    // Update drawing mode when tool changes
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas || readOnly) return;

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
          // Use white color as eraser effect
          canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
          canvas.freeDrawingBrush.color = backgroundColor;
          canvas.freeDrawingBrush.width = strokeWidth * 3;
          break;

        case "select":
          canvas.selection = true;
          break;

        default:
          // For shapes and text, we use click-to-add
          canvas.selection = false;
          break;
      }
    }, [selectedTool, strokeColor, strokeWidth, readOnly, backgroundColor]);

    // Update brush color/width when they change
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas || !canvas.freeDrawingBrush) return;

      if (selectedTool === "pen") {
        canvas.freeDrawingBrush.color = strokeColor;
        canvas.freeDrawingBrush.width = strokeWidth;
      } else if (selectedTool === "eraser") {
        canvas.freeDrawingBrush.color = backgroundColor;
        canvas.freeDrawingBrush.width = strokeWidth * 3;
      }
    }, [strokeColor, strokeWidth, selectedTool, backgroundColor]);

    // Handle click to add shapes
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas || readOnly) return;

      const handleMouseDown = (opt: fabric.TPointerEventInfo) => {
        if (
          selectedTool === "select" ||
          selectedTool === "pen" ||
          selectedTool === "eraser"
        ) {
          return;
        }

        const pointer = canvas.getScenePoint(opt.e);
        addShapeAtPoint(selectedTool, pointer.x, pointer.y);
      };

      canvas.on("mouse:down", handleMouseDown);

      return () => {
        canvas.off("mouse:down", handleMouseDown);
      };
    }, [selectedTool, strokeColor, fillColor, strokeWidth, readOnly]);

    // Add shape at specific point
    const addShapeAtPoint = useCallback(
      (tool: DrawingToolType, x: number, y: number) => {
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
            // Create arrow as a group of line + triangle
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
        }

        if (shape) {
          canvas.add(shape);
          canvas.setActiveObject(shape);
          canvas.renderAll();
        }
      },
      [strokeColor, fillColor, strokeWidth]
    );

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
        onHistoryChange?.(
          historyIndexRef.current > 0,
          historyIndexRef.current < historyRef.current.length - 1
        );
        onCanvasChange?.(JSON.parse(historyRef.current[historyIndexRef.current]));
      });
    }, [onHistoryChange, onCanvasChange]);

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
        onHistoryChange?.(
          historyIndexRef.current > 0,
          historyIndexRef.current < historyRef.current.length - 1
        );
        onCanvasChange?.(JSON.parse(historyRef.current[historyIndexRef.current]));
      });
    }, [onHistoryChange, onCanvasChange]);

    // Clear canvas
    const clear = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      canvas.clear();
      canvas.backgroundColor = backgroundColor;
      canvas.renderAll();
      saveHistory();
    }, [backgroundColor, saveHistory]);

    // Export to PNG
    const exportPNG = useCallback((): string | null => {
      const canvas = fabricRef.current;
      if (!canvas) return null;

      return canvas.toDataURL({
        format: "png",
        quality: 1,
        multiplier: 2, // Higher resolution
      });
    }, []);

    // Get canvas data as JSON
    const getCanvasData = useCallback((): FabricCanvasData | null => {
      const canvas = fabricRef.current;
      if (!canvas) return null;

      return canvas.toJSON() as FabricCanvasData;
    }, []);

    // Add shape programmatically
    const addShape = useCallback(
      (shape: DrawingToolType) => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        // Add shape at center of canvas
        addShapeAtPoint(shape, width / 2, height / 2);
      },
      [width, height, addShapeAtPoint]
    );

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      undo,
      redo,
      clear,
      exportPNG,
      getCanvasData,
      addShape,
    }));

    // Handle keyboard shortcuts
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas || readOnly) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        // Delete selected object
        if (e.key === "Delete" || e.key === "Backspace") {
          const activeObject = canvas.getActiveObject();
          if (activeObject) {
            canvas.remove(activeObject);
            canvas.renderAll();
          }
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
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [readOnly, undo, redo]);

    return (
      <div className="fabric-canvas-container">
        <canvas ref={canvasRef} />
      </div>
    );
  }
);
