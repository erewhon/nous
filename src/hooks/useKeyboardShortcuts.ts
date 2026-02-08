import { useEffect, useCallback } from "react";
import { useKeybindingsStore, type KeybindingAction } from "../stores/keybindingsStore";

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
  onTagManager?: () => void;
  onActions?: () => void;
  onQuickCapture?: () => void;
  onInbox?: () => void;
  onFlashcards?: () => void;
  onZenMode?: () => void;
  onDailyNote?: () => void;
  onToggleFavorite?: () => void;
  onWebClipper?: () => void;
}

// Map action names to callback property names
const ACTION_TO_CALLBACK: Record<KeybindingAction, keyof KeyboardShortcuts> = {
  commandPalette: "onCommandPalette",
  newPage: "onNewPage",
  newNotebook: "onNewNotebook",
  graph: "onGraph",
  aiChat: "onAI",
  webResearch: "onWebResearch",
  settings: "onSettings",
  exportPage: "onExportPage",
  duplicatePage: "onDuplicatePage",
  deletePage: "onDeletePage",
  tagManager: "onTagManager",
  actions: "onActions",
  quickCapture: "onQuickCapture",
  inbox: "onInbox",
  flashcards: "onFlashcards",
  zenMode: "onZenMode",
  dailyNote: "onDailyNote",
  toggleFavorite: "onToggleFavorite",
  webClipper: "onWebClipper",
};

export function useKeyboardShortcuts(callbacks: KeyboardShortcuts) {
  const keybindings = useKeybindingsStore((state) => state.keybindings);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Only process if at least the mod key is pressed
      if (!isMod) return;

      // Get the pressed key (normalize to lowercase for comparison)
      const pressedKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      // Check each keybinding
      for (const keybinding of keybindings) {
        const matchesMod = keybinding.modifiers.ctrl === isMod;
        const matchesShift = keybinding.modifiers.shift === e.shiftKey;
        const matchesAlt = keybinding.modifiers.alt === e.altKey;
        const matchesKey = keybinding.key.toLowerCase() === pressedKey;

        if (matchesMod && matchesShift && matchesAlt && matchesKey) {
          e.preventDefault();

          // Get the callback for this action
          const callbackName = ACTION_TO_CALLBACK[keybinding.action];
          const callback = callbacks[callbackName];

          if (callback) {
            callback();
          }

          return;
        }
      }
    },
    [keybindings, callbacks]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
