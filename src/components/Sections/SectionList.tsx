import { useState, useCallback, useMemo } from "react";
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
import type { Section, PinnedSectionEntry } from "../../types/page";
import { useThemeStore } from "../../stores/themeStore";
import { SectionSettingsDialog } from "./SectionSettingsDialog";

// Section sort options
type SectionSortOption = "manual" | "name-asc" | "name-desc" | "created-desc" | "created-asc" | "modified-desc";

const SORT_OPTIONS: { value: SectionSortOption; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "name-asc", label: "Name A→Z" },
  { value: "name-desc", label: "Name Z→A" },
  { value: "created-desc", label: "Newest First" },
  { value: "created-asc", label: "Oldest First" },
  { value: "modified-desc", label: "Recently Modified" },
];

interface SectionListProps {
  sections: Section[];
  selectedSectionId: string | null;
  onSelectSection: (sectionId: string | null) => void;
  onCreateSection: (name: string, color?: string) => Promise<Section | null>;
  onUpdateSection: (
    sectionId: string,
    updates: { name?: string; color?: string | null }
  ) => Promise<void>;
  onDeleteSection: (sectionId: string, moveItemsTo?: string) => Promise<void>;
  onReorderSections?: (sectionIds: string[]) => Promise<void>;
  // Count of pages that don't have a section assigned
  unassignedPagesCount?: number;
  // For section pinning
  notebookId?: string;
  notebookName?: string;
}

interface SortableSectionItemProps {
  section: Section;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

function SortableSectionItem({
  section,
  isSelected,
  onSelect,
  onEdit,
  isPinned,
  onTogglePin,
}: SortableSectionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <button
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit();
        }}
        className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-all"
        style={{
          backgroundColor: isSelected
            ? section.color
              ? `${section.color}15`
              : "var(--color-bg-tertiary)"
            : "transparent",
          color: isSelected
            ? "var(--color-text-primary)"
            : "var(--color-text-secondary)",
          borderLeft: isSelected
            ? `3px solid ${section.color || "var(--color-accent)"}`
            : "3px solid transparent",
        }}
        title="Right-click to edit"
      >
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="flex h-4 w-3 cursor-grab items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--color-text-muted)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <IconGrip />
        </span>
        {/* Color indicator */}
        <span
          className="h-3 w-3 flex-shrink-0 rounded-full"
          style={{
            backgroundColor: section.color || "var(--color-text-muted)",
          }}
        />
        <span className="flex-1 truncate">{section.name}</span>
        {/* Pin button on hover */}
        {onTogglePin && (
          <span
            className={`transition-opacity ${isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            title={isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill={isPinned ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: isPinned ? "var(--color-accent)" : "var(--color-text-muted)" }}
            >
              <path d="M12 17v5M9 2h6l1 7h2l-1 4H7L6 9h2z" />
            </svg>
          </span>
        )}
        {/* Edit button on hover */}
        <span
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
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
            style={{ color: "var(--color-text-muted)" }}
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </span>
      </button>
    </li>
  );
}

export function SectionList({
  sections,
  selectedSectionId,
  onSelectSection,
  onCreateSection,
  onUpdateSection,
  onDeleteSection,
  onReorderSections,
  unassignedPagesCount = 0,
  notebookId,
  notebookName,
}: SectionListProps) {
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [sortOption, setSortOption] = useState<SectionSortOption>("manual");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const autoHidePanels = useThemeStore((state) => state.autoHidePanels);
  const setAutoHidePanels = useThemeStore((state) => state.setAutoHidePanels);
  const togglePinnedSection = useThemeStore((state) => state.togglePinnedSection);
  const isPinnedSection = useThemeStore((state) => state.isPinnedSection);

  // Sort sections based on selected option
  const sortedSections = useMemo(() => {
    if (sortOption === "manual") {
      return sections;
    }

    return [...sections].sort((a, b) => {
      switch (sortOption) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "created-desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "created-asc":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "modified-desc":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        default:
          return 0;
      }
    });
  }, [sections, sortOption]);

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

  const handleCreateSection = async (name: string, color?: string) => {
    const section = await onCreateSection(name, color);
    setIsCreating(false);
    if (section) {
      onSelectSection(section.id);
    }
  };

  const handleUpdateSection = async (
    sectionId: string,
    updates: { name?: string; color?: string | null }
  ) => {
    await onUpdateSection(sectionId, updates);
    setEditingSection(null);
  };

  const handleDeleteSection = async (sectionId: string, moveItemsTo?: string) => {
    await onDeleteSection(sectionId, moveItemsTo);
    setEditingSection(null);
    if (selectedSectionId === sectionId) {
      onSelectSection(null);
    }
  };

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id && onReorderSections) {
        const oldIndex = sections.findIndex((s) => s.id === active.id);
        const newIndex = sections.findIndex((s) => s.id === over.id);

        const newOrder = arrayMove(sections, oldIndex, newIndex);
        const sectionIds = newOrder.map((s) => s.id);
        onReorderSections(sectionIds);
      }
    },
    [sections, onReorderSections]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-muted)" }}
        >
          Sections
        </span>
        <div className="flex items-center gap-1">
          {/* Sort button */}
          <div className="relative">
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: sortOption !== "manual" ? "var(--color-accent)" : "var(--color-text-muted)" }}
              title="Sort sections"
            >
              <IconSort />
            </button>
            {showSortMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowSortMenu(false)}
                />
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border py-1 shadow-lg"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                >
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSortOption(option.value);
                        setShowSortMenu(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{
                        color: sortOption === option.value ? "var(--color-accent)" : "var(--color-text-secondary)",
                      }}
                    >
                      {sortOption === option.value && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      <span className={sortOption === option.value ? "" : "ml-[20px]"}>{option.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setAutoHidePanels(!autoHidePanels)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: autoHidePanels ? "var(--color-accent)" : "var(--color-text-muted)" }}
            title={autoHidePanels ? "Disable auto-hide panels" : "Enable auto-hide panels"}
          >
            <IconPanelClose />
          </button>
          <button
            onClick={() => setIsCreating(true)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Add section"
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
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Section list */}
      <div className="flex-1 overflow-y-auto px-2">
        <ul className="space-y-1">
          {/* All sections option - only show if there are unassigned pages */}
          {unassignedPagesCount > 0 && (
            <li>
              <button
                onClick={() => onSelectSection(null)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-all"
                style={{
                  backgroundColor:
                    selectedSectionId === null
                      ? "var(--color-bg-tertiary)"
                      : "transparent",
                  color:
                    selectedSectionId === null
                      ? "var(--color-text-primary)"
                      : "var(--color-text-secondary)",
                }}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center"
                  style={{ color: "var(--color-text-muted)" }}
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
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                </span>
                <span className="font-medium">Unsorted</span>
                <span
                  className="ml-auto text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {unassignedPagesCount}
                </span>
              </button>
            </li>
          )}

          {/* Individual sections with drag-and-drop (only in manual mode) */}
          {sortOption === "manual" ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedSections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {sortedSections.map((section) => (
                  <SortableSectionItem
                    key={section.id}
                    section={section}
                    isSelected={selectedSectionId === section.id}
                    onSelect={() => onSelectSection(section.id)}
                    onEdit={() => setEditingSection(section)}
                    isPinned={isPinnedSection(section.id)}
                    onTogglePin={notebookId && notebookName ? () => {
                      const entry: PinnedSectionEntry = {
                        sectionId: section.id,
                        notebookId,
                        sectionName: section.name,
                        sectionColor: section.color,
                        notebookName,
                        pinnedAt: new Date().toISOString(),
                      };
                      togglePinnedSection(entry);
                    } : undefined}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            // Non-draggable list for sorted views
            sortedSections.map((section) => (
              <li key={section.id}>
                <button
                  onClick={() => onSelectSection(section.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setEditingSection(section);
                  }}
                  className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-all"
                  style={{
                    backgroundColor: selectedSectionId === section.id
                      ? section.color
                        ? `${section.color}15`
                        : "var(--color-bg-tertiary)"
                      : "transparent",
                    color: selectedSectionId === section.id
                      ? "var(--color-text-primary)"
                      : "var(--color-text-secondary)",
                    borderLeft: selectedSectionId === section.id
                      ? `3px solid ${section.color || "var(--color-accent)"}`
                      : "3px solid transparent",
                    paddingLeft: "calc(0.75rem + 11px)", // Account for missing grip icon
                  }}
                  title="Right-click to edit"
                >
                  {/* Color indicator */}
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor: section.color || "var(--color-text-muted)",
                    }}
                  />
                  <span className="flex-1 truncate">{section.name}</span>
                  {/* Pin button on hover */}
                  {notebookId && notebookName && (
                    <span
                      className={`transition-opacity ${isPinnedSection(section.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const entry: PinnedSectionEntry = {
                          sectionId: section.id,
                          notebookId,
                          sectionName: section.name,
                          sectionColor: section.color,
                          notebookName,
                          pinnedAt: new Date().toISOString(),
                        };
                        togglePinnedSection(entry);
                      }}
                      title={isPinnedSection(section.id) ? "Unpin from sidebar" : "Pin to sidebar"}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill={isPinnedSection(section.id) ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ color: isPinnedSection(section.id) ? "var(--color-accent)" : "var(--color-text-muted)" }}
                      >
                        <path d="M12 17v5M9 2h6l1 7h2l-1 4H7L6 9h2z" />
                      </svg>
                    </span>
                  )}
                  {/* Edit button on hover */}
                  <span
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSection(section);
                    }}
                  >
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
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="5" r="1" />
                      <circle cx="12" cy="19" r="1" />
                    </svg>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Empty state */}
        {sortedSections.length === 0 && (
          <div
            className="mt-4 rounded-lg border border-dashed p-4 text-center"
            style={{ borderColor: "var(--color-border)" }}
          >
            <p
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              No sections yet
            </p>
            <button
              onClick={() => setIsCreating(true)}
              className="mt-2 text-xs font-medium transition-colors hover:underline"
              style={{ color: "var(--color-accent)" }}
            >
              Create your first section
            </button>
          </div>
        )}
      </div>

      {/* Section settings dialog */}
      <SectionSettingsDialog
        isOpen={editingSection !== null || isCreating}
        section={editingSection}
        sections={sections}
        onClose={() => {
          setEditingSection(null);
          setIsCreating(false);
        }}
        onSave={
          editingSection
            ? (updates) => handleUpdateSection(editingSection.id, updates)
            : (updates) => handleCreateSection(updates.name!, updates.color ?? undefined)
        }
        onDelete={
          editingSection
            ? (moveItemsTo) => handleDeleteSection(editingSection.id, moveItemsTo)
            : undefined
        }
      />
    </div>
  );
}

function IconGrip() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="8"
      height="10"
      viewBox="0 0 8 10"
      fill="currentColor"
    >
      <circle cx="2" cy="1.5" r="1" />
      <circle cx="6" cy="1.5" r="1" />
      <circle cx="2" cy="5" r="1" />
      <circle cx="6" cy="5" r="1" />
      <circle cx="2" cy="8.5" r="1" />
      <circle cx="6" cy="8.5" r="1" />
    </svg>
  );
}

function IconPanelClose() {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M16 15l-3-3 3-3" />
    </svg>
  );
}

function IconSort() {
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
      <path d="M3 6h18" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}
