import type { PageTemplate } from "../../stores/templateStore";
import { BlockRenderer } from "./BlockRenderer";

interface TemplatePreviewProps {
  template: PageTemplate;
  onBack: () => void;
  onUseTemplate: () => void;
  getIconComponent: (iconName: string) => React.ReactNode;
}

export function TemplatePreview({
  template,
  onBack,
  onUseTemplate,
  getIconComponent,
}: TemplatePreviewProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onBack}
    >
      <div
        className="flex w-full max-w-2xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-4 border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
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
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {template.name}
            </h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {template.description}
            </p>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {template.content.blocks.length > 0 ? (
            <BlockRenderer blocks={template.content.blocks} />
          ) : (
            <p
              className="py-8 text-center text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              This template starts with a blank page.
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onBack}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Back
          </button>
          <button
            onClick={onUseTemplate}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Use Template
          </button>
        </div>
      </div>
    </div>
  );
}
