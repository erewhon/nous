import { useState, useCallback } from "react";
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
import type { Section } from "../../types/page";
import { useThemeStore } from "../../stores/themeStore";
import { SectionSettingsDialog } from "./SectionSettingsDialog";

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
}

interface SortableSectionItemProps {
  section: Section;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

function SortableSectionItem({
  section,
  isSelected,
  onSelect,
  onEdit,
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
}: SectionListProps) {
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const autoHidePanels = useThemeStore((state) => state.autoHidePanels);
  const setAutoHidePanels = useThemeStore((state) => state.setAutoHidePanels);

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

          {/* Individual sections with drag-and-drop */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {sections.map((section) => (
                <SortableSectionItem
                  key={section.id}
                  section={section}
                  isSelected={selectedSectionId === section.id}
                  onSelect={() => onSelectSection(section.id)}
                  onEdit={() => setEditingSection(section)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </ul>

        {/* Empty state */}
        {sections.length === 0 && (
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
