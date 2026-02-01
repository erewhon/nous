import { useState } from "react";
import type { Section } from "../../types/page";
import { SectionSettingsDialog } from "./SectionSettingsDialog";

interface SectionTabsProps {
  sections: Section[];
  selectedSectionId: string | null;
  onSelectSection: (sectionId: string | null) => void;
  onCreateSection: (name: string, color?: string) => Promise<Section | null>;
  onUpdateSection: (
    sectionId: string,
    updates: { name?: string; color?: string | null }
  ) => Promise<void>;
  onDeleteSection: (sectionId: string, moveItemsTo?: string) => Promise<void>;
}

export function SectionTabs({
  sections,
  selectedSectionId,
  onSelectSection,
  onCreateSection,
  onUpdateSection,
  onDeleteSection,
}: SectionTabsProps) {
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [isCreating, setIsCreating] = useState(false);

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

  return (
    <div className="border-b" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center gap-1 overflow-x-auto px-3 py-2">
        {/* All tab */}
        <button
          onClick={() => onSelectSection(null)}
          className="flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
          style={{
            backgroundColor:
              selectedSectionId === null
                ? "var(--color-bg-tertiary)"
                : "transparent",
            color:
              selectedSectionId === null
                ? "var(--color-text-primary)"
                : "var(--color-text-muted)",
          }}
        >
          All
        </button>

        {/* Section tabs */}
        {sections.map((section) => {
          const isSelected = selectedSectionId === section.id;
          return (
            <button
              key={section.id}
              onClick={() => onSelectSection(section.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setEditingSection(section);
              }}
              className="group flex-shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
              style={{
                backgroundColor: isSelected
                  ? section.color
                    ? `${section.color}20`
                    : "var(--color-bg-tertiary)"
                  : "transparent",
                color: isSelected
                  ? section.color || "var(--color-text-primary)"
                  : "var(--color-text-muted)",
                borderBottom: isSelected
                  ? `2px solid ${section.color || "var(--color-accent)"}`
                  : "2px solid transparent",
              }}
              title={`Right-click to edit "${section.name}"`}
            >
              {section.color && (
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: section.color }}
                />
              )}
              <span className="truncate max-w-[120px]">{section.name}</span>
            </button>
          );
        })}

        {/* Add section button */}
        <button
          onClick={() => setIsCreating(true)}
          className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
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
