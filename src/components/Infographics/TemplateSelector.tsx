import type { InfographicTemplate } from "../../types/infographic";
import { INFOGRAPHIC_TEMPLATES } from "../../types/infographic";

interface TemplateSelectorProps {
  selected: InfographicTemplate;
  onSelect: (template: InfographicTemplate) => void;
  disabled?: boolean;
}

export function TemplateSelector({
  selected,
  onSelect,
  disabled,
}: TemplateSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {INFOGRAPHIC_TEMPLATES.map((template) => (
        <button
          key={template.id}
          onClick={() => onSelect(template.id)}
          disabled={disabled}
          className={`p-4 rounded-lg border text-left transition-all ${
            selected === template.id
              ? "border-[--color-accent] ring-2 ring-[--color-accent] ring-opacity-50"
              : "hover:border-[--color-accent] hover:border-opacity-50"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          style={{
            backgroundColor:
              selected === template.id
                ? "var(--color-accent-light)"
                : "var(--color-bg-secondary)",
            borderColor:
              selected === template.id
                ? "var(--color-accent)"
                : "var(--color-border)",
          }}
        >
          <div
            className="font-medium text-sm"
            style={{ color: "var(--color-text-primary)" }}
          >
            {template.name}
          </div>
          <div
            className="text-xs mt-1"
            style={{ color: "var(--color-text-muted)" }}
          >
            {template.description}
          </div>
          <div
            className="text-xs mt-2 px-2 py-0.5 rounded-full inline-block"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            From: {template.dataSource}
          </div>
        </button>
      ))}
    </div>
  );
}
