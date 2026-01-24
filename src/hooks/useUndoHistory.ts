import { useCallback, useEffect, useRef } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useUndoHistoryStore } from "../stores/undoHistoryStore";

interface UseUndoHistoryOptions {
  pageId: string;
  enabled?: boolean;
  onStateChange?: (data: OutputData) => void;
}

/**
 * Hook for managing undo/redo history for a page.
 * Integrates with the undo history store and provides
 * debounced state capture.
 */
export function useUndoHistory({
  pageId,
  enabled = true,
  onStateChange,
}: UseUndoHistoryOptions) {
  const pushState = useUndoHistoryStore((state) => state.pushState);
  const undoAction = useUndoHistoryStore((state) => state.undo);
  const redoAction = useUndoHistoryStore((state) => state.redo);
  const jumpToState = useUndoHistoryStore((state) => state.jumpToState);
  const canUndoCheck = useUndoHistoryStore((state) => state.canUndo);
  const canRedoCheck = useUndoHistoryStore((state) => state.canRedo);
  const settings = useUndoHistoryStore((state) => state.settings);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDataRef = useRef<OutputData | null>(null);

  // Capture state with debouncing
  const captureState = useCallback(
    (data: OutputData, description?: string) => {
      if (!enabled) return;

      // Clear existing debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Store latest data
      lastDataRef.current = data;

      // Debounce the actual push
      debounceRef.current = setTimeout(() => {
        if (lastDataRef.current) {
          pushState(pageId, lastDataRef.current, description);
        }
      }, settings.captureInterval);
    },
    [enabled, pageId, pushState, settings.captureInterval]
  );

  // Immediate capture (for explicit saves)
  const captureStateNow = useCallback(
    (data: OutputData, description?: string) => {
      if (!enabled) return;

      // Clear any pending debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      pushState(pageId, data, description);
    },
    [enabled, pageId, pushState]
  );

  // Undo action
  const undo = useCallback(() => {
    if (!enabled) return null;

    const data = undoAction(pageId);
    if (data && onStateChange) {
      onStateChange(data);
    }
    return data;
  }, [enabled, pageId, undoAction, onStateChange]);

  // Redo action
  const redo = useCallback(() => {
    if (!enabled) return null;

    const data = redoAction(pageId);
    if (data && onStateChange) {
      onStateChange(data);
    }
    return data;
  }, [enabled, pageId, redoAction, onStateChange]);

  // Jump to specific state
  const jumpTo = useCallback(
    (entryId: string) => {
      if (!enabled) return null;

      const data = jumpToState(pageId, entryId);
      if (data && onStateChange) {
        onStateChange(data);
      }
      return data;
    },
    [enabled, pageId, jumpToState, onStateChange]
  );

  // Check if can undo/redo
  const canUndo = useCallback(() => {
    return enabled && canUndoCheck(pageId);
  }, [enabled, pageId, canUndoCheck]);

  const canRedo = useCallback(() => {
    return enabled && canRedoCheck(pageId);
  }, [enabled, pageId, canRedoCheck]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd/Ctrl+Z (undo) or Cmd/Ctrl+Shift+Z (redo)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        // Don't interfere if typing in an input/textarea
        const target = e.target as HTMLElement;
        const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
        if (isInput) return;

        if (e.shiftKey) {
          // Redo
          e.preventDefault();
          redo();
        } else {
          // Undo
          e.preventDefault();
          undo();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, undo, redo]);

  return {
    captureState,
    captureStateNow,
    undo,
    redo,
    jumpTo,
    canUndo,
    canRedo,
  };
}
