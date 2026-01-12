import { useEffect, useCallback } from "react";

interface KeyboardShortcuts {
  onCommandPalette?: () => void;
  onNewPage?: () => void;
  onNewNotebook?: () => void;
  onGraph?: () => void;
  onAI?: () => void;
}

export function useKeyboardShortcuts({
  onCommandPalette,
  onNewPage,
  onNewNotebook,
  onGraph,
  onAI,
}: KeyboardShortcuts) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Command Palette: Cmd+K / Ctrl+K
      if (isMod && e.key === "k") {
        e.preventDefault();
        onCommandPalette?.();
        return;
      }

      // New Page: Cmd+N / Ctrl+N
      if (isMod && e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        onNewPage?.();
        return;
      }

      // New Notebook: Cmd+Shift+N / Ctrl+Shift+N
      if (isMod && e.key === "N" && e.shiftKey) {
        e.preventDefault();
        onNewNotebook?.();
        return;
      }

      // Graph View: Cmd+G / Ctrl+G
      if (isMod && e.key === "g") {
        e.preventDefault();
        onGraph?.();
        return;
      }

      // AI Chat: Cmd+Shift+A / Ctrl+Shift+A
      if (isMod && e.shiftKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        onAI?.();
        return;
      }
    },
    [onCommandPalette, onNewPage, onNewNotebook, onGraph, onAI]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
