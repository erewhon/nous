import { create } from "zustand";
import { persist } from "zustand/middleware";

// Keybinding action identifiers
export type KeybindingAction =
  | "commandPalette"
  | "newPage"
  | "newNotebook"
  | "graph"
  | "aiChat"
  | "webResearch"
  | "settings"
  | "exportPage"
  | "duplicatePage"
  | "deletePage"
  | "tagManager"
  | "actions"
  | "quickCapture"
  | "inbox"
  | "flashcards"
  | "zenMode"
  | "dailyNote"
  | "toggleFavorite";

// Keybinding definition
export interface Keybinding {
  action: KeybindingAction;
  label: string;
  description: string;
  key: string; // The key (e.g., "k", "n", ",", "Backspace")
  modifiers: {
    ctrl: boolean; // Ctrl on Windows/Linux, Cmd on Mac
    shift: boolean;
    alt: boolean;
  };
}

// Default keybindings
export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  {
    action: "commandPalette",
    label: "Command Palette",
    description: "Open the command palette for quick actions",
    key: "k",
    modifiers: { ctrl: true, shift: false, alt: false },
  },
  {
    action: "newPage",
    label: "New Page",
    description: "Create a new page in the current notebook",
    key: "n",
    modifiers: { ctrl: true, shift: false, alt: false },
  },
  {
    action: "newNotebook",
    label: "New Notebook",
    description: "Create a new notebook",
    key: "n",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "graph",
    label: "Graph View",
    description: "Open the knowledge graph view",
    key: "g",
    modifiers: { ctrl: true, shift: false, alt: false },
  },
  {
    action: "aiChat",
    label: "AI Chat",
    description: "Open AI chat assistant",
    key: "a",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "webResearch",
    label: "Web Research",
    description: "Open web research panel",
    key: "w",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "settings",
    label: "Settings",
    description: "Open application settings",
    key: ",",
    modifiers: { ctrl: true, shift: false, alt: false },
  },
  {
    action: "exportPage",
    label: "Export Page",
    description: "Export the current page",
    key: "e",
    modifiers: { ctrl: true, shift: false, alt: false },
  },
  {
    action: "duplicatePage",
    label: "Duplicate Page",
    description: "Duplicate the current page",
    key: "d",
    modifiers: { ctrl: true, shift: false, alt: false },
  },
  {
    action: "deletePage",
    label: "Delete Page",
    description: "Delete the current page",
    key: "Backspace",
    modifiers: { ctrl: true, shift: false, alt: false },
  },
  {
    action: "tagManager",
    label: "Tag Manager",
    description: "Open tag manager",
    key: "t",
    modifiers: { ctrl: true, shift: false, alt: false },
  },
  {
    action: "actions",
    label: "Actions Library",
    description: "Open AI actions library",
    key: "x",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "quickCapture",
    label: "Quick Capture",
    description: "Quick capture a note",
    key: "c",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "inbox",
    label: "Inbox",
    description: "Open inbox",
    key: "i",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "flashcards",
    label: "Flashcards",
    description: "Open flashcards",
    key: "f",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "zenMode",
    label: "Zen Mode",
    description: "Toggle distraction-free writing mode",
    key: ".",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "dailyNote",
    label: "Daily Note",
    description: "Open today's daily note",
    key: "d",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
  {
    action: "toggleFavorite",
    label: "Toggle Star",
    description: "Star or unstar the current page",
    key: "s",
    modifiers: { ctrl: true, shift: true, alt: false },
  },
];

interface KeybindingsState {
  keybindings: Keybinding[];
}

interface KeybindingsActions {
  updateKeybinding: (action: KeybindingAction, key: string, modifiers: Keybinding["modifiers"]) => void;
  resetKeybinding: (action: KeybindingAction) => void;
  resetAllKeybindings: () => void;
  getKeybinding: (action: KeybindingAction) => Keybinding | undefined;
  formatKeybinding: (keybinding: Keybinding) => string;
  checkConflict: (key: string, modifiers: Keybinding["modifiers"], excludeAction?: KeybindingAction) => Keybinding | null;
}

type KeybindingsStore = KeybindingsState & KeybindingsActions;

// Helper to detect if running on Mac
const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const useKeybindingsStore = create<KeybindingsStore>()(
  persist(
    (set, get) => ({
      keybindings: [...DEFAULT_KEYBINDINGS],

      updateKeybinding: (action, key, modifiers) => {
        set((state) => ({
          keybindings: state.keybindings.map((kb) =>
            kb.action === action ? { ...kb, key, modifiers } : kb
          ),
        }));
      },

      resetKeybinding: (action) => {
        const defaultBinding = DEFAULT_KEYBINDINGS.find((kb) => kb.action === action);
        if (defaultBinding) {
          set((state) => ({
            keybindings: state.keybindings.map((kb) =>
              kb.action === action ? { ...defaultBinding } : kb
            ),
          }));
        }
      },

      resetAllKeybindings: () => {
        set({ keybindings: [...DEFAULT_KEYBINDINGS] });
      },

      getKeybinding: (action) => {
        return get().keybindings.find((kb) => kb.action === action);
      },

      formatKeybinding: (keybinding) => {
        const parts: string[] = [];

        if (keybinding.modifiers.ctrl) {
          parts.push(isMac ? "Cmd" : "Ctrl");
        }
        if (keybinding.modifiers.alt) {
          parts.push(isMac ? "Option" : "Alt");
        }
        if (keybinding.modifiers.shift) {
          parts.push("Shift");
        }

        // Format the key nicely
        let keyDisplay = keybinding.key;
        if (keyDisplay === "Backspace") {
          keyDisplay = isMac ? "Delete" : "Backspace";
        } else if (keyDisplay === " ") {
          keyDisplay = "Space";
        } else if (keyDisplay.length === 1) {
          keyDisplay = keyDisplay.toUpperCase();
        }

        parts.push(keyDisplay);

        return parts.join(" + ");
      },

      checkConflict: (key, modifiers, excludeAction) => {
        const keybindings = get().keybindings;
        const normalizedKey = key.toLowerCase();

        for (const kb of keybindings) {
          if (excludeAction && kb.action === excludeAction) continue;

          if (
            kb.key.toLowerCase() === normalizedKey &&
            kb.modifiers.ctrl === modifiers.ctrl &&
            kb.modifiers.shift === modifiers.shift &&
            kb.modifiers.alt === modifiers.alt
          ) {
            return kb;
          }
        }

        return null;
      },
    }),
    {
      name: "nous-keybindings",
      partialize: (state) => ({ keybindings: state.keybindings }),
    }
  )
);
