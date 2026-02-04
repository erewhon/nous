import { useState, useEffect } from "react";
import { useInfographicStore } from "../../stores/infographicStore";
import { useStudyToolsStore } from "../../stores/studyToolsStore";
import { useToastStore } from "../../stores/toastStore";
import { TemplateSelector } from "./TemplateSelector";
import { InfographicPreview } from "./InfographicPreview";
import type {
  InfographicTemplate,
  InfographicTheme,
} from "../../types/infographic";
import { INFOGRAPHIC_SIZE_PRESETS } from "../../types/infographic";

interface InfographicGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
}

export function InfographicGenerator({
  isOpen,
  onClose,
  notebookId,
}: InfographicGeneratorProps) {
  const infographicStore = useInfographicStore();
  const studyToolsStore = useStudyToolsStore();
  const toast = useToastStore();

  const [title, setTitle] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("presentation");

  // Check availability on mount
  useEffect(() => {
    if (isOpen && !infographicStore.availability) {
      infographicStore.checkAvailability();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      infographicStore.clearResult();
      infographicStore.clearError();
      setTitle("");
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  // Get data based on selected template
  const getDataForTemplate = (template: InfographicTemplate) => {
    switch (template) {
      case "key_concepts":
        return { key_concepts: studyToolsStore.studyGuide?.keyConcepts || [] };
      case "executive_summary":
        return studyToolsStore.briefing || {};
      case "timeline":
        return { events: studyToolsStore.timeline?.events || [] };
      case "concept_map":
        return {
          nodes: studyToolsStore.conceptGraph?.nodes || [],
          links: studyToolsStore.conceptGraph?.links || [],
        };
      default:
        return {};
    }
  };

  // Check if data is available for template
  const hasDataForTemplate = (template: InfographicTemplate): boolean => {
    switch (template) {
      case "key_concepts":
        return (studyToolsStore.studyGuide?.keyConcepts?.length ?? 0) > 0;
      case "executive_summary":
        return studyToolsStore.briefing !== null;
      case "timeline":
        return (studyToolsStore.timeline?.events?.length ?? 0) > 0;
      case "concept_map":
        return (studyToolsStore.conceptGraph?.nodes?.length ?? 0) > 0;
      default:
        return false;
    }
  };

  const handleGenerate = async () => {
    const data = getDataForTemplate(infographicStore.selectedTemplate);

    const result = await infographicStore.generateInfographic(
      notebookId,
      infographicStore.selectedTemplate,
      data,
      title || undefined
    );

    if (result) {
      toast.success("Infographic generated successfully");
    } else {
      toast.error(infographicStore.error || "Failed to generate infographic");
    }
  };

  const availability = infographicStore.availability;
  const canGenerate =
    hasDataForTemplate(infographicStore.selectedTemplate) &&
    !infographicStore.isGenerating &&
    availability?.svgGeneration;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-4xl flex-col rounded-xl border shadow-2xl"
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
              Generate Infographic
            </h2>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              Create visual summaries from your study tools content
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[--color-bg-tertiary]"
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {infographicStore.result ? (
            // Show preview
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3
                  className="font-semibold"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Generated Infographic
                </h3>
                <button
                  onClick={() => infographicStore.clearResult()}
                  className="text-sm hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Generate new
                </button>
              </div>

              <InfographicPreview
                result={infographicStore.result}
                title={title || infographicStore.selectedTemplate}
              />
            </div>
          ) : (
            // Configuration form
            <div className="space-y-6">
              {/* Availability warnings */}
              {availability && !availability.svgGeneration && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "#ef4444",
                  }}
                >
                  SVG generation is not available. Please install the svgwrite
                  package.
                </div>
              )}

              {availability && availability.svgGeneration && !availability.pngExport && (
                <div
                  className="p-3 rounded-lg text-sm flex items-start gap-2"
                  style={{
                    backgroundColor: "rgba(245, 158, 11, 0.1)",
                    color: "#f59e0b",
                  }}
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
                    className="flex-shrink-0 mt-0.5"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>
                    <strong>PNG export unavailable.</strong> Install cairosvg to enable PNG export:{" "}
                    <code
                      className="px-1 rounded text-xs"
                      style={{ backgroundColor: "rgba(245, 158, 11, 0.2)" }}
                    >
                      pip install cairosvg
                    </code>
                    . SVG export will still work.
                  </span>
                </div>
              )}

              {/* Template selection */}
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Template
                </label>
                <TemplateSelector
                  selected={infographicStore.selectedTemplate}
                  onSelect={infographicStore.setSelectedTemplate}
                  disabled={infographicStore.isGenerating}
                />
              </div>

              {/* Data availability indicator */}
              <div
                className={`p-3 rounded-lg text-sm ${
                  hasDataForTemplate(infographicStore.selectedTemplate)
                    ? ""
                    : "border"
                }`}
                style={{
                  backgroundColor: hasDataForTemplate(
                    infographicStore.selectedTemplate
                  )
                    ? "rgba(16, 185, 129, 0.1)"
                    : "var(--color-bg-secondary)",
                  color: hasDataForTemplate(infographicStore.selectedTemplate)
                    ? "#10b981"
                    : "var(--color-text-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                {hasDataForTemplate(infographicStore.selectedTemplate) ? (
                  <>
                    <span className="font-medium">Data available</span> - Ready
                    to generate infographic
                  </>
                ) : (
                  <>
                    <span className="font-medium">No data available</span> -
                    Generate{" "}
                    {infographicStore.selectedTemplate === "key_concepts"
                      ? "a Study Guide"
                      : infographicStore.selectedTemplate === "executive_summary"
                      ? "a Briefing Document"
                      : infographicStore.selectedTemplate === "timeline"
                      ? "a Timeline"
                      : "a Concept Map"}{" "}
                    first using Study Tools
                  </>
                )}
              </div>

              {/* Title */}
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Title (optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter infographic title..."
                  disabled={infographicStore.isGenerating}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>

              {/* Theme selection */}
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Theme
                </label>
                <div className="flex gap-3">
                  {(["light", "dark"] as InfographicTheme[]).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => infographicStore.setTheme(theme)}
                      disabled={infographicStore.isGenerating}
                      className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                        infographicStore.settings.theme === theme
                          ? "ring-2 ring-[--color-accent]"
                          : ""
                      }`}
                      style={{
                        backgroundColor:
                          theme === "dark" ? "#1a1a2e" : "#ffffff",
                        color: theme === "dark" ? "#eaeaea" : "#2c3e50",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size Presets */}
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Size
                </label>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {INFOGRAPHIC_SIZE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setSelectedPreset(preset.id);
                        if (preset.id !== "custom") {
                          infographicStore.setWidth(preset.width);
                          infographicStore.setHeight(preset.height);
                        }
                      }}
                      disabled={infographicStore.isGenerating}
                      className={`p-2 rounded-lg text-left transition-colors ${
                        selectedPreset === preset.id
                          ? "ring-2 ring-[--color-accent]"
                          : ""
                      }`}
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor: "var(--color-border)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div
                        className="text-sm font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {preset.name}
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {preset.width}x{preset.height}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Custom size inputs */}
                {selectedPreset === "custom" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Width
                      </label>
                      <input
                        type="number"
                        value={infographicStore.settings.width}
                        onChange={(e) =>
                          infographicStore.setWidth(parseInt(e.target.value) || 1200)
                        }
                        min={400}
                        max={3000}
                        step={100}
                        disabled={infographicStore.isGenerating}
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        style={{
                          backgroundColor: "var(--color-bg-primary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-medium mb-1"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Height
                      </label>
                      <input
                        type="number"
                        value={infographicStore.settings.height}
                        onChange={(e) =>
                          infographicStore.setHeight(parseInt(e.target.value) || 800)
                        }
                        min={400}
                        max={3000}
                        step={100}
                        disabled={infographicStore.isGenerating}
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                        style={{
                          backgroundColor: "var(--color-bg-primary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Error display */}
              {infographicStore.error && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "#ef4444",
                  }}
                >
                  {infographicStore.error}
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {infographicStore.isGenerating
                  ? "Generating..."
                  : "Generate Infographic"}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
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
          to close
        </div>
      </div>
    </div>
  );
}
