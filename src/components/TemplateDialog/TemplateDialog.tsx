import { useCallback, useState } from "react";
import { useTemplateStore, type PageTemplate } from "../../stores/templateStore";
import { usePageStore } from "../../stores/pageStore";
import type { EditorData } from "../../types/page";

interface TemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string | null;
}

export function TemplateDialog({ isOpen, onClose, notebookId }: TemplateDialogProps) {
  const { templates, deleteTemplate, updateTemplate } = useTemplateStore();
  const { createPage, updatePageContent } = usePageStore();
  const [isManageMode, setIsManageMode] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PageTemplate | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const customTemplates = templates.filter((t) => !t.isBuiltIn);
  const builtInTemplates = templates.filter((t) => t.isBuiltIn);

  const handleSelectTemplate = useCallback(
    async (template: PageTemplate) => {
      if (!notebookId) return;

      // Generate title based on template
      let title = "Untitled";
      if (template.id === "daily-journal") {
        title = new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      } else if (template.id === "meeting-notes") {
        title = `Meeting Notes - ${new Date().toLocaleDateString()}`;
      } else if (template.id !== "blank") {
        title = template.name;
      }

      // Create the page
      await createPage(notebookId, title);

      // Get the newly created page (it should be selected after creation)
      const state = usePageStore.getState();
      const newPageId = state.selectedPageId;

      if (newPageId && template.content.blocks.length > 0) {
        // Deep clone the content and generate new block IDs
        const contentWithNewIds: EditorData = {
          time: Date.now(),
          version: template.content.version,
          blocks: template.content.blocks.map((block) => ({
            ...block,
            id: crypto.randomUUID(),
            data: { ...block.data },
          })),
        };

        // Update with template content
        await updatePageContent(notebookId, newPageId, contentWithNewIds);
      }

      onClose();
    },
    [notebookId, createPage, updatePageContent, onClose]
  );

  const handleStartEdit = (template: PageTemplate) => {
    setEditingTemplate(template);
    setEditName(template.name);
    setEditDescription(template.description);
  };

  const handleSaveEdit = () => {
    if (editingTemplate && editName.trim()) {
      updateTemplate(editingTemplate.id, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      setEditingTemplate(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingTemplate(null);
    setEditName("");
    setEditDescription("");
  };

  const handleDeleteClick = (templateId: string) => {
    setDeleteConfirm(templateId);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm) {
      deleteTemplate(deleteConfirm);
      setDeleteConfirm(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirm(null);
  };

  const handleClose = () => {
    setIsManageMode(false);
    setEditingTemplate(null);
    setDeleteConfirm(null);
    onClose();
  };

  if (!isOpen) return null;

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case "file":
        return <IconFile />;
      case "users":
        return <IconUsers />;
      case "calendar":
        return <IconCalendar />;
      case "folder":
        return <IconFolder />;
      case "book":
        return <IconBook />;
      case "star":
        return <IconStar />;
      case "lightbulb":
        return <IconLightbulb />;
      case "code":
        return <IconCode />;
      case "list":
        return <IconList />;
      case "clipboard":
        return <IconClipboard />;
      default:
        return <IconFile />;
    }
  };

  // Delete confirmation modal
  if (deleteConfirm) {
    const templateToDelete = templates.find((t) => t.id === deleteConfirm);
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={handleCancelDelete}
      >
        <div
          className="w-full max-w-sm rounded-xl border p-6 shadow-2xl"
          style={{
            backgroundColor: "var(--color-bg-primary)",
            borderColor: "var(--color-border)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
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
                className="text-red-400"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </div>
            <div>
              <h3
                className="font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                Delete Template
              </h3>
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                This action cannot be undone
              </p>
            </div>
          </div>
          <p
            className="mb-6 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Are you sure you want to delete "{templateToDelete?.name}"?
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={handleCancelDelete}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Edit template modal
  if (editingTemplate) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={handleCancelEdit}
      >
        <div
          className="w-full max-w-md rounded-xl border shadow-2xl"
          style={{
            backgroundColor: "var(--color-bg-primary)",
            borderColor: "var(--color-border)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center justify-between border-b px-6 py-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Edit Template
            </h2>
            <button
              onClick={handleCancelEdit}
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
                style={{ color: "var(--color-text-muted)" }}
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="space-y-4 p-6">
            <div>
              <label
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>
            <div>
              <label
                className="mb-1.5 block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Description
              </label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>
          </div>
          <div
            className="flex justify-end gap-3 border-t px-6 py-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <button
              onClick={handleCancelEdit}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Manage templates mode
  if (isManageMode) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={handleClose}
      >
        <div
          className="w-full max-w-2xl rounded-xl border shadow-2xl"
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
              <button
                onClick={() => setIsManageMode(false)}
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
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <path d="M19 12H5" />
                  <path d="M12 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h2
                  className="text-lg font-semibold"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Manage Templates
                </h2>
                <p
                  className="text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Edit or delete your custom templates
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
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
                style={{ color: "var(--color-text-muted)" }}
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Template list */}
          <div className="max-h-96 overflow-y-auto p-6">
            {customTemplates.length === 0 ? (
              <div className="py-8 text-center">
                <div
                  className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14,2 14,8 20,8" />
                  </svg>
                </div>
                <p style={{ color: "var(--color-text-muted)" }}>
                  No custom templates yet
                </p>
                <p
                  className="mt-1 text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Save a page as a template from the page menu
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {customTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center gap-4 rounded-lg border p-4"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    <div
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                    >
                      <span style={{ color: "var(--color-accent)" }}>
                        {getIconComponent(template.icon)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {template.name}
                      </div>
                      <div
                        className="truncate text-sm"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {template.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStartEdit(template)}
                        className="rounded-lg p-2 transition-colors hover:opacity-80"
                        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                        title="Edit template"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteClick(template.id)}
                        className="rounded-lg p-2 transition-colors hover:bg-red-500/10"
                        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                        title="Delete template"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="text-red-400"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main template selection view
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border shadow-2xl"
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
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Choose a Template
            </h2>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              Start with a pre-made structure or blank page
            </p>
          </div>
          <div className="flex items-center gap-2">
            {customTemplates.length > 0 && (
              <button
                onClick={() => setIsManageMode(true)}
                className="rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:opacity-80"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Manage Templates
              </button>
            )}
            <button
              onClick={handleClose}
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
        </div>

        {/* Templates Grid */}
        <div className="max-h-96 overflow-y-auto p-6">
          {/* Custom templates section */}
          {customTemplates.length > 0 && (
            <>
              <h3
                className="mb-3 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)" }}
              >
                My Templates
              </h3>
              <div className="mb-6 grid grid-cols-2 gap-4">
                {customTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template)}
                    className="flex items-start gap-4 rounded-lg border p-4 text-left transition-all hover:border-[--color-accent] hover:shadow-md"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    <div
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                    >
                      <span style={{ color: "var(--color-accent)" }}>
                        {getIconComponent(template.icon)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {template.name}
                      </div>
                      <div
                        className="mt-0.5 text-sm"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {template.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Built-in templates section */}
          <h3
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Built-in Templates
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {builtInTemplates.map((template) => (
              <button
                key={template.id}
                onClick={() => handleSelectTemplate(template)}
                className="flex items-start gap-4 rounded-lg border p-4 text-left transition-all hover:border-[--color-accent] hover:shadow-md"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <div
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                >
                  <span style={{ color: "var(--color-accent)" }}>
                    {getIconComponent(template.icon)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {template.name}
                  </div>
                  <div
                    className="mt-0.5 text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {template.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer hint */}
        <div
          className="border-t px-6 py-3 text-center text-xs"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          Press{" "}
          <kbd
            className="rounded px-1"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            Esc
          </kbd>{" "}
          to cancel
        </div>
      </div>
    </div>
  );
}

// Icons
function IconFile() {
  return (
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
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  );
}

function IconUsers() {
  return (
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
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconCalendar() {
  return (
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
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconFolder() {
  return (
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
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconBook() {
  return (
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
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function IconStar() {
  return (
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
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconLightbulb() {
  return (
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
    >
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

function IconCode() {
  return (
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
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function IconList() {
  return (
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
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function IconClipboard() {
  return (
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
    >
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}
