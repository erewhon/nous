import { useEffect, useCallback } from "react";

interface KeyboardShortcuts {
  onCommandPalette?: () => void;
  onNewPage?: () => void;
  onNewNotebook?: () => void;
  onGraph?: () => void;
  onAI?: () => void;
  onWebResearch?: () => void;
  onSettings?: () => void;
  onExportPage?: () => void;
  onDuplicatePage?: () => void;
  onDeletePage?: () => void;
}

export function useKeyboardShortcuts({
  onCommandPalette,
  onNewPage,
  onNewNotebook,
  onGraph,
  onAI,
  onWebResearch,
  onSettings,
  onExportPage,
  onDuplicatePage,
  onDeletePage,
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

      // Web Research: Cmd+Shift+W / Ctrl+Shift+W
      if (isMod && e.shiftKey && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        onWebResearch?.();
        return;
      }

      // Settings: Cmd+, / Ctrl+,
      if (isMod && e.key === ",") {
        e.preventDefault();
        onSettings?.();
        return;
      }

      // Export Page: Cmd+E / Ctrl+E
      if (isMod && e.key === "e" && !e.shiftKey) {
        e.preventDefault();
        onExportPage?.();
        return;
      }

      // Duplicate Page: Cmd+D / Ctrl+D
      if (isMod && e.key === "d" && !e.shiftKey) {
        e.preventDefault();
        onDuplicatePage?.();
        return;
      }

      // Delete Page: Cmd+Backspace / Ctrl+Backspace
      if (isMod && e.key === "Backspace" && !e.shiftKey) {
        e.preventDefault();
        onDeletePage?.();
        return;
      }
    },
    [onCommandPalette, onNewPage, onNewNotebook, onGraph, onAI, onWebResearch, onSettings, onExportPage, onDuplicatePage, onDeletePage]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
