import { useCallback, useRef, useEffect } from "react";
import * as fabric from "fabric";
import { useCanvasStore } from "../../../stores/canvasStore";
import { CANVAS_DEFAULTS } from "../../../types/canvas";

interface UseCanvasPanZoomOptions {
  canvas: fabric.Canvas | null;
  enabled?: boolean;
}

interface UseCanvasPanZoomReturn {
  isPanning: boolean;
  handleWheel: (e: WheelEvent) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  fitToContent: () => void;
}

/**
 * Hook for handling pan/zoom on an infinite canvas.
 * - Mouse wheel to zoom
 * - Middle-click or Space+drag to pan
 */
export function useCanvasPanZoom({
  canvas,
  enabled = true,
}: UseCanvasPanZoomOptions): UseCanvasPanZoomReturn {
  const isPanningRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const spaceKeyRef = useRef(false);

  const { viewport, setViewport, selectedTool } = useCanvasStore();

  // Handle mouse wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!canvas || !enabled) return;

      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      const zoomFactor = 0.999 ** delta;
      let newZoom = viewport.zoom * zoomFactor;

      // Clamp zoom
      newZoom = Math.max(
        CANVAS_DEFAULTS.MIN_ZOOM,
        Math.min(CANVAS_DEFAULTS.MAX_ZOOM, newZoom)
      );

      // Zoom towards mouse position
      const point = new fabric.Point(e.offsetX, e.offsetY);
      canvas.zoomToPoint(point, newZoom);

      // Update store
      const vpt = canvas.viewportTransform;
      if (vpt) {
        setViewport({
          zoom: newZoom,
          panX: vpt[4],
          panY: vpt[5],
        });
      }
    },
    [canvas, enabled, viewport.zoom, setViewport]
  );

  // Handle pan start
  const handlePanStart = useCallback(
    (e: MouseEvent) => {
      if (!canvas || !enabled) return;

      // Middle mouse button or space+left click or pan tool
      const isPanAction =
        e.button === 1 || // Middle mouse
        (spaceKeyRef.current && e.button === 0) || // Space + left click
        selectedTool === "pan"; // Pan tool selected

      if (isPanAction) {
        isPanningRef.current = true;
        lastPosRef.current = { x: e.clientX, y: e.clientY };
        canvas.selection = false;
        canvas.defaultCursor = "grabbing";
        canvas.renderAll();
      }
    },
    [canvas, enabled, selectedTool]
  );

  // Handle pan move
  const handlePanMove = useCallback(
    (e: MouseEvent) => {
      if (!canvas || !enabled || !isPanningRef.current) return;

      const vpt = canvas.viewportTransform;
      if (!vpt) return;

      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;

      vpt[4] += dx;
      vpt[5] += dy;

      lastPosRef.current = { x: e.clientX, y: e.clientY };

      canvas.requestRenderAll();

      // Update store
      setViewport({
        panX: vpt[4],
        panY: vpt[5],
      });
    },
    [canvas, enabled, setViewport]
  );

  // Handle pan end
  const handlePanEnd = useCallback(() => {
    if (!canvas) return;

    if (isPanningRef.current) {
      isPanningRef.current = false;
      canvas.selection = selectedTool === "select";
      canvas.defaultCursor = selectedTool === "pan" ? "grab" : "default";
      canvas.renderAll();
    }
  }, [canvas, selectedTool]);

  // Handle keyboard events for space key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!canvas || !enabled) return;

      if (e.code === "Space" && !spaceKeyRef.current) {
        spaceKeyRef.current = true;
        canvas.defaultCursor = "grab";
        canvas.renderAll();
      }
    },
    [canvas, enabled]
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!canvas) return;

      if (e.code === "Space") {
        spaceKeyRef.current = false;
        if (!isPanningRef.current) {
          canvas.defaultCursor = selectedTool === "pan" ? "grab" : "default";
          canvas.renderAll();
        }
      }
    },
    [canvas, selectedTool]
  );

  // Set up event listeners
  useEffect(() => {
    if (!canvas || !enabled) return;

    const canvasElement = canvas.getElement();
    const container = canvasElement.parentElement;

    if (!container) return;

    // Wheel event on container
    container.addEventListener("wheel", handleWheel, { passive: false });

    // Mouse events on container
    container.addEventListener("mousedown", handlePanStart);
    window.addEventListener("mousemove", handlePanMove);
    window.addEventListener("mouseup", handlePanEnd);

    // Keyboard events on window
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Prevent context menu on middle click
    const preventContextMenu = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };
    container.addEventListener("contextmenu", preventContextMenu);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("mousedown", handlePanStart);
      window.removeEventListener("mousemove", handlePanMove);
      window.removeEventListener("mouseup", handlePanEnd);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      container.removeEventListener("contextmenu", preventContextMenu);
    };
  }, [
    canvas,
    enabled,
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    handleKeyDown,
    handleKeyUp,
  ]);

  // Update cursor when tool changes
  useEffect(() => {
    if (!canvas) return;

    if (selectedTool === "pan") {
      canvas.defaultCursor = "grab";
    } else {
      canvas.defaultCursor = "default";
    }
    canvas.renderAll();
  }, [canvas, selectedTool]);

  // Zoom in action
  const zoomIn = useCallback(() => {
    if (!canvas) return;

    const newZoom = Math.min(
      CANVAS_DEFAULTS.MAX_ZOOM,
      viewport.zoom * 1.2
    );

    // Zoom towards center of canvas
    const centerX = canvas.getWidth() / 2;
    const centerY = canvas.getHeight() / 2;
    canvas.zoomToPoint(new fabric.Point(centerX, centerY), newZoom);

    const vpt = canvas.viewportTransform;
    if (vpt) {
      setViewport({
        zoom: newZoom,
        panX: vpt[4],
        panY: vpt[5],
      });
    }
  }, [canvas, viewport.zoom, setViewport]);

  // Zoom out action
  const zoomOut = useCallback(() => {
    if (!canvas) return;

    const newZoom = Math.max(
      CANVAS_DEFAULTS.MIN_ZOOM,
      viewport.zoom / 1.2
    );

    // Zoom towards center of canvas
    const centerX = canvas.getWidth() / 2;
    const centerY = canvas.getHeight() / 2;
    canvas.zoomToPoint(new fabric.Point(centerX, centerY), newZoom);

    const vpt = canvas.viewportTransform;
    if (vpt) {
      setViewport({
        zoom: newZoom,
        panX: vpt[4],
        panY: vpt[5],
      });
    }
  }, [canvas, viewport.zoom, setViewport]);

  // Reset view to center at 100% zoom
  const resetView = useCallback(() => {
    if (!canvas) return;

    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    setViewport({
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  }, [canvas, setViewport]);

  // Fit all content in view
  const fitToContent = useCallback(() => {
    if (!canvas) return;

    const objects = canvas.getObjects();
    if (objects.length === 0) {
      resetView();
      return;
    }

    // Get bounding box of all objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    objects.forEach((obj) => {
      const bounds = obj.getBoundingRect();
      minX = Math.min(minX, bounds.left);
      minY = Math.min(minY, bounds.top);
      maxX = Math.max(maxX, bounds.left + bounds.width);
      maxY = Math.max(maxY, bounds.top + bounds.height);
    });

    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;

    // Calculate zoom to fit
    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();
    const padding = 50;

    const zoomX = (canvasWidth - padding * 2) / boundsWidth;
    const zoomY = (canvasHeight - padding * 2) / boundsHeight;
    const zoom = Math.min(zoomX, zoomY, CANVAS_DEFAULTS.MAX_ZOOM);

    // Calculate pan to center content
    const centerX = minX + boundsWidth / 2;
    const centerY = minY + boundsHeight / 2;
    const panX = canvasWidth / 2 - centerX * zoom;
    const panY = canvasHeight / 2 - centerY * zoom;

    canvas.setViewportTransform([zoom, 0, 0, zoom, panX, panY]);
    setViewport({ zoom, panX, panY });
  }, [canvas, setViewport, resetView]);

  return {
    isPanning: isPanningRef.current,
    handleWheel,
    zoomIn,
    zoomOut,
    resetView,
    fitToContent,
  };
}
