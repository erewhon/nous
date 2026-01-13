import { useState, useEffect, useRef } from "react";
import { useTemplateStore } from "../../stores/templateStore";
import type { Page } from "../../types/page";

interface SaveAsTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  page: Page;
}

const ICON_OPTIONS = [
  { value: "file", label: "File" },
  { value: "users", label: "Meeting" },
  { value: "calendar", label: "Calendar" },
  { value: "folder", label: "Folder" },
  { value: "book", label: "Book" },
  { value: "star", label: "Star" },
  { value: "lightbulb", label: "Idea" },
  { value: "code", label: "Code" },
  { value: "list", label: "List" },
  { value: "clipboard", label: "Clipboard" },
];

export function SaveAsTemplateDialog({
  isOpen,
  onClose,
  page,
}: SaveAsTemplateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("file");
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { addTemplate, templates } = useTemplateStore();

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      setName(page.title || "");
      setDescription("");
      setIcon("file");
      setError(null);
      // Focus the name input
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen, page.title]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = () => {
    // Validate name
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Template name is required");
      return;
    }

    // Check for duplicate names
    const duplicate = templates.find(
      (t) => t.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      setError("A template with this name already exists");
      return;
    }

    // Check if page has content
    if (!page.content || page.content.blocks.length === 0) {
      setError("Cannot save an empty page as a template");
      return;
    }

    // Add the template
    addTemplate({
      name: trimmedName,
      description: description.trim() || `Custom template based on "${page.title}"`,
      icon,
      sourcePageId: page.id, // Link template back to source page
      content: {
        time: Date.now(),
        version: page.content.version,
        blocks: page.content.blocks.map((block) => ({
          ...block,
          // Keep original IDs for template (they'll be regenerated when used)
          data: { ...block.data },
        })),
      },
    });

    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: "var(--color-accent)/10" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-accent)" }}
              >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </div>
            <div>
              <h2
                className="text-lg font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                Save as Template
              </h2>
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Create a reusable template from this page
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:opacity-80"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--color-text-muted)" }}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4 p-6">
          {/* Template Name */}
          <div>
            <label
              className="mb-1.5 block text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Template Name <span className="text-red-400">*</span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Weekly Review"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label
              className="mb-1.5 block text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this template..."
              rows={2}
              className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Icon Selection */}
          <div>
            <label
              className="mb-1.5 block text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Icon
            </label>
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setIcon(opt.value)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                    icon === opt.value
                      ? "border-[--color-accent] bg-[--color-accent]/10"
                      : "hover:bg-[--color-bg-tertiary]"
                  }`}
                  style={{
                    borderColor:
                      icon === opt.value ? "var(--color-accent)" : "var(--color-border)",
                  }}
                  title={opt.label}
                >
                  <IconComponent name={opt.value} selected={icon === opt.value} />
                </button>
              ))}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Save Template
          </button>
        </div>
      </div>
    </div>
  );
}

// Icon component for the selector
function IconComponent({ name, selected }: { name: string; selected: boolean }) {
  const color = selected ? "var(--color-accent)" : "var(--color-text-muted)";

  switch (name) {
    case "file":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>
      );
    case "users":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "calendar":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "folder":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "book":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
      );
    case "star":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "lightbulb":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
          <path d="M9 18h6" />
          <path d="M10 22h4" />
        </svg>
      );
    case "code":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "list":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      );
    case "clipboard":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>
      );
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>
      );
  }
}
