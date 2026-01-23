import { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Notebook } from "../../types/notebook";
import { useNotebookStore } from "../../stores/notebookStore";
import { useThemeStore, type NotebookSortOption } from "../../stores/themeStore";
import { NotebookSettingsDialog } from "../NotebookSettings";

const SORT_OPTIONS: { value: NotebookSortOption; label: string }[] = [
  { value: "position", label: "Manual" },
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Recently created" },
];

interface NotebookListProps {
  notebooks: Notebook[];
  selectedNotebookId: string | null;
}

interface SortableNotebookItemProps {
  notebook: Notebook;
  isSelected: boolean;
  isHovered: boolean;
  isDraggable: boolean;
  onSelect: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onOpenSettings: () => void;
}

function SortableNotebookItem({
  notebook,
  isSelected,
  isHovered,
  isDraggable,
  onSelect,
  onHoverStart,
  onHoverEnd,
  onOpenSettings,
}: SortableNotebookItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: notebook.id, disabled: !isDraggable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
    >
      <div
        className="relative flex w-full items-center gap-3 rounded-lg text-left transition-all p-3"
        style={{
          backgroundColor: isSelected ? "var(--color-bg-tertiary)" : "transparent",
          color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          borderLeft: `3px solid ${
            isSelected
              ? notebook.color || "var(--color-accent)"
              : notebook.color
                ? `${notebook.color}40`
                : "transparent"
          }`,
        }}
      >
        {/* Drag handle - only show when in manual sort mode */}
        {isDraggable && (
          <button
            {...attributes}
            {...listeners}
            className="flex h-6 w-4 cursor-grab items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-[--color-bg-tertiary] transition-opacity"
            style={{
              color: "var(--color-text-muted)",
              opacity: isHovered || isDragging ? 1 : 0,
            }}
            title="Drag to reorder"
          >
            <IconGrip />
          </button>
        )}
        <button
          onClick={onSelect}
          className="flex flex-1 items-center gap-3 text-left"
        >
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: notebook.color
                ? notebook.color
                : isSelected
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              color: notebook.color || isSelected ? "white" : "var(--color-text-muted)",
            }}
          >
            <NotebookIcon type={notebook.type} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="block truncate font-medium">{notebook.name}</span>
              {notebook.archived && (
                <span
                  title="Archived"
                  className="flex h-4 w-4 items-center justify-center"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <IconArchive />
                </span>
              )}
              {notebook.systemPrompt && (
                <span
                  title="Has custom AI prompt"
                  className="flex h-4 w-4 items-center justify-center"
                  style={{ color: "var(--color-accent)" }}
                >
                  <IconPrompt />
                </span>
              )}
            </div>
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {notebook.type === "zettelkasten" ? "Zettelkasten" : "Notebook"}
            </span>
          </div>
        </button>
        {/* Settings button - visible on hover */}
        {(isHovered || isSelected) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings();
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-secondary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Notebook settings"
          >
            <IconSettings />
          </button>
        )}
      </div>
    </li>
  );
}

export function NotebookList({
  notebooks,
  selectedNotebookId,
}: NotebookListProps) {
  const { selectNotebook, reorderNotebooks } = useNotebookStore();
  const { notebookSortBy: sortBy, setNotebookSortBy: setSortBy } = useThemeStore();
  const [settingsNotebook, setSettingsNotebook] = useState<Notebook | null>(null);
  const [hoveredNotebookId, setHoveredNotebookId] = useState<string | null>(null);
  const [showSortMenu, setShowSortMenu] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sort notebooks based on selected option
  const sortedNotebooks = useMemo(() => {
    return [...notebooks].sort((a, b) => {
      switch (sortBy) {
        case "position":
          return a.position - b.position;
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "updated":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case "created":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return 0;
      }
    });
  }, [notebooks, sortBy]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = sortedNotebooks.findIndex((n) => n.id === active.id);
        const newIndex = sortedNotebooks.findIndex((n) => n.id === over.id);

        const newOrder = arrayMove(sortedNotebooks, oldIndex, newIndex);
        const notebookIds = newOrder.map((n) => n.id);
        reorderNotebooks(notebookIds);
      }
    },
    [sortedNotebooks, reorderNotebooks]
  );

  const isDraggable = sortBy === "position";

  if (notebooks.length === 0) {
    return (
      <div
        className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="text-2xl opacity-50">📓</div>
        <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          No notebooks yet
        </span>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Create one to get started
        </span>
      </div>
    );
  }

  return (
    <>
      {/* Sort button */}
      <div className="mb-2 flex justify-end px-1">
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Sort notebooks"
          >
            <IconSort />
            <span>{SORT_OPTIONS.find((o) => o.value === sortBy)?.label}</span>
          </button>

          {showSortMenu && (
            <div
              className="absolute right-0 top-full z-50 mt-1 min-w-36 rounded-lg border py-1 shadow-lg"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
              }}
              onMouseLeave={() => setShowSortMenu(false)}
            >
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setSortBy(option.value);
                    setShowSortMenu(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{
                    color: sortBy === option.value ? "var(--color-accent)" : "var(--color-text-primary)",
                  }}
                >
                  {option.label}
                  {sortBy === option.value && <span className="text-[--color-accent]">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedNotebooks.map((n) => n.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-1">
            {sortedNotebooks.map((notebook) => (
              <SortableNotebookItem
                key={notebook.id}
                notebook={notebook}
                isSelected={selectedNotebookId === notebook.id}
                isHovered={hoveredNotebookId === notebook.id}
                isDraggable={isDraggable}
                onSelect={() => selectNotebook(notebook.id)}
                onHoverStart={() => setHoveredNotebookId(notebook.id)}
                onHoverEnd={() => setHoveredNotebookId(null)}
                onOpenSettings={() => setSettingsNotebook(notebook)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {/* Notebook Settings Dialog */}
      <NotebookSettingsDialog
        isOpen={settingsNotebook !== null}
        notebook={settingsNotebook}
        onClose={() => setSettingsNotebook(null)}
      />
    </>
  );
}

function IconGrip() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <circle cx="3" cy="2" r="1.5" />
      <circle cx="9" cy="2" r="1.5" />
      <circle cx="3" cy="6" r="1.5" />
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="3" cy="10" r="1.5" />
      <circle cx="9" cy="10" r="1.5" />
    </svg>
  );
}

function IconSettings() {
  return (
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
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function IconPrompt() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconArchive() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="5" rx="2" />
      <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}

function IconSort() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5h10" />
      <path d="M11 9h7" />
      <path d="M11 13h4" />
      <path d="M3 17l3 3 3-3" />
      <path d="M6 18V4" />
    </svg>
  );
}

function NotebookIcon({ type }: { type: Notebook["type"] }) {
  if (type === "zettelkasten") {
    return (
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
        <circle cx="12" cy="12" r="3" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <line x1="14.5" y1="9.5" x2="17.5" y2="6.5" />
        <line x1="9.5" y1="14.5" x2="6.5" y2="17.5" />
      </svg>
    );
  }

  return (
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
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}
