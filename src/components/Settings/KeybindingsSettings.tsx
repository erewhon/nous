import { useState, useCallback, useEffect, useRef } from "react";
import {
  useKeybindingsStore,
  type Keybinding,
  type KeybindingAction,
  DEFAULT_KEYBINDINGS,
} from "../../stores/keybindingsStore";

// Helper to detect if running on Mac
const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function KeybindingsSettings() {
  const {
    keybindings,
    updateKeybinding,
    resetKeybinding,
    resetAllKeybindings,
    formatKeybinding,
    checkConflict,
  } = useKeybindingsStore();

  const [editingAction, setEditingAction] = useState<KeybindingAction | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingModifiers, setPendingModifiers] = useState<Keybinding["modifiers"] | null>(null);
  const [conflict, setConflict] = useState<Keybinding | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when editing starts
  useEffect(() => {
    if (editingAction && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingAction]);

  const handleStartEditing = useCallback((action: KeybindingAction) => {
    setEditingAction(action);
    setPendingKey(null);
    setPendingModifiers(null);
    setConflict(null);
  }, []);

  const handleCancelEditing = useCallback(() => {
    setEditingAction(null);
    setPendingKey(null);
    setPendingModifiers(null);
    setConflict(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels editing
      if (e.key === "Escape") {
        handleCancelEditing();
        return;
      }

      // Don't capture modifier-only presses
      if (["Control", "Shift", "Alt", "Meta", "Command"].includes(e.key)) {
        return;
      }

      const modifiers: Keybinding["modifiers"] = {
        ctrl: e.metaKey || e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
      };

      // Require at least Ctrl/Cmd modifier
      if (!modifiers.ctrl) {
        return;
      }

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      setPendingKey(key);
      setPendingModifiers(modifiers);

      // Check for conflicts
      const conflictingBinding = checkConflict(key, modifiers, editingAction!);
      setConflict(conflictingBinding);
    },
    [editingAction, checkConflict, handleCancelEditing]
  );

  const handleSaveKeybinding = useCallback(() => {
    if (editingAction && pendingKey && pendingModifiers) {
      updateKeybinding(editingAction, pendingKey, pendingModifiers);
      handleCancelEditing();
    }
  }, [editingAction, pendingKey, pendingModifiers, updateKeybinding, handleCancelEditing]);

  const handleResetKeybinding = useCallback(
    (action: KeybindingAction) => {
      resetKeybinding(action);
    },
    [resetKeybinding]
  );

  const handleResetAll = useCallback(() => {
    if (window.confirm("Reset all keyboard shortcuts to defaults?")) {
      resetAllKeybindings();
    }
  }, [resetAllKeybindings]);

  // Check if a keybinding has been modified from default
  const isModified = useCallback((keybinding: Keybinding) => {
    const defaultBinding = DEFAULT_KEYBINDINGS.find((kb) => kb.action === keybinding.action);
    if (!defaultBinding) return false;

    return (
      keybinding.key !== defaultBinding.key ||
      keybinding.modifiers.ctrl !== defaultBinding.modifiers.ctrl ||
      keybinding.modifiers.shift !== defaultBinding.modifiers.shift ||
      keybinding.modifiers.alt !== defaultBinding.modifiers.alt
    );
  }, []);

  // Format pending keybinding for display
  const formatPendingKeybinding = useCallback(() => {
    if (!pendingKey || !pendingModifiers) return "Press a key combination...";

    const parts: string[] = [];
    if (pendingModifiers.ctrl) parts.push(isMac ? "Cmd" : "Ctrl");
    if (pendingModifiers.alt) parts.push(isMac ? "Option" : "Alt");
    if (pendingModifiers.shift) parts.push("Shift");

    let keyDisplay = pendingKey;
    if (keyDisplay === "Backspace") keyDisplay = isMac ? "Delete" : "Backspace";
    else if (keyDisplay === " ") keyDisplay = "Space";
    else if (keyDisplay.length === 1) keyDisplay = keyDisplay.toUpperCase();

    parts.push(keyDisplay);
    return parts.join(" + ");
  }, [pendingKey, pendingModifiers]);

  // Group keybindings by category
  const categories = [
    {
      name: "General",
      actions: ["commandPalette", "settings", "newPage", "newNotebook"] as KeybindingAction[],
    },
    {
      name: "AI & Research",
      actions: ["aiChat", "webResearch", "actions"] as KeybindingAction[],
    },
    {
      name: "Page Actions",
      actions: ["exportPage", "duplicatePage", "deletePage", "tagManager"] as KeybindingAction[],
    },
    {
      name: "Tools",
      actions: ["quickCapture", "inbox", "flashcards", "graph"] as KeybindingAction[],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Keyboard Shortcuts
          </h3>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--color-text-muted)" }}
          >
            Customize keyboard shortcuts for quick actions. All shortcuts require {isMac ? "Cmd" : "Ctrl"} modifier.
          </p>
        </div>
        <button
          onClick={handleResetAll}
          className="px-3 py-1.5 text-sm rounded-lg transition-colors"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Reset All
        </button>
      </div>

      {/* Keybinding categories */}
      {categories.map((category) => (
        <div key={category.name}>
          <h4
            className="text-sm font-medium mb-3 uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            {category.name}
          </h4>
          <div
            className="rounded-lg border divide-y"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            {category.actions.map((action) => {
              const keybinding = keybindings.find((kb) => kb.action === action);
              if (!keybinding) return null;

              const isEditing = editingAction === action;
              const modified = isModified(keybinding);

              return (
                <div
                  key={action}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-sm font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {keybinding.label}
                      </span>
                      {modified && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: "rgba(139, 92, 246, 0.15)",
                            color: "var(--color-accent)",
                          }}
                        >
                          Modified
                        </span>
                      )}
                    </div>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {keybinding.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <input
                            ref={inputRef}
                            type="text"
                            readOnly
                            value={formatPendingKeybinding()}
                            onKeyDown={handleKeyDown}
                            onBlur={handleCancelEditing}
                            className="w-48 px-3 py-1.5 text-sm rounded-lg outline-none text-center"
                            style={{
                              backgroundColor: "var(--color-bg-tertiary)",
                              color: pendingKey ? "var(--color-text-primary)" : "var(--color-text-muted)",
                              border: conflict
                                ? "2px solid var(--color-error, #ef4444)"
                                : "2px solid var(--color-accent)",
                            }}
                          />
                          {conflict && (
                            <div
                              className="absolute top-full left-0 right-0 mt-1 p-2 text-xs rounded-lg z-10"
                              style={{
                                backgroundColor: "var(--color-bg-tertiary)",
                                color: "var(--color-error, #ef4444)",
                                border: "1px solid var(--color-error, #ef4444)",
                              }}
                            >
                              Conflicts with "{conflict.label}"
                            </div>
                          )}
                        </div>
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleSaveKeybinding();
                          }}
                          disabled={!pendingKey || !!conflict}
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                          style={{
                            backgroundColor: "var(--color-accent)",
                            color: "white",
                          }}
                          title="Save"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleCancelEditing();
                          }}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                            color: "var(--color-text-secondary)",
                          }}
                          title="Cancel"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStartEditing(action)}
                          className="px-3 py-1.5 text-sm rounded-lg font-mono transition-colors hover:opacity-80"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                            color: "var(--color-text-primary)",
                          }}
                        >
                          {formatKeybinding(keybinding)}
                        </button>
                        {modified && (
                          <button
                            onClick={() => handleResetKeybinding(action)}
                            className="p-1.5 rounded-lg transition-colors hover:opacity-80"
                            style={{
                              backgroundColor: "transparent",
                              color: "var(--color-text-muted)",
                            }}
                            title="Reset to default"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                              <path d="M3 3v5h5" />
                            </svg>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Help text */}
      <div
        className="p-4 rounded-lg"
        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
      >
        <h4
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text-primary)" }}
        >
          Tips
        </h4>
        <ul
          className="text-sm space-y-1"
          style={{ color: "var(--color-text-muted)" }}
        >
          <li>Click on a shortcut to change it</li>
          <li>Press the new key combination while the input is focused</li>
          <li>All shortcuts require {isMac ? "Cmd" : "Ctrl"} modifier</li>
          <li>Press Escape to cancel editing</li>
          <li>Conflicts with existing shortcuts are highlighted in red</li>
        </ul>
      </div>
    </div>
  );
}
