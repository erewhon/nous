import { useState } from "react";
import type { ActionStep, NotebookTarget, PageSelector } from "../../types/action";
import { STEP_TYPES } from "../../types/action";

interface StepBuilderProps {
  steps: ActionStep[];
  onChange: (steps: ActionStep[]) => void;
  viewOnly?: boolean;
}

export function StepBuilder({ steps, onChange, viewOnly = false }: StepBuilderProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const addStep = (type: ActionStep["type"]) => {
    const newStep = createDefaultStep(type);
    if (newStep) {
      onChange([...steps, newStep]);
      setExpandedStep(steps.length);
    }
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
    if (expandedStep === index) {
      setExpandedStep(null);
    }
  };

  const updateStep = (index: number, updated: ActionStep) => {
    onChange(steps.map((s, i) => (i === index ? updated : s)));
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;

    const newSteps = [...steps];
    [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
    onChange(newSteps);
    setExpandedStep(newIndex);
  };

  return (
    <div className="space-y-4">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Define the steps this action will execute. Steps run in order from top to bottom.
      </p>

      {/* Steps list */}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <StepCard
            key={index}
            step={step}
            index={index}
            isExpanded={expandedStep === index}
            onToggle={() => setExpandedStep(expandedStep === index ? null : index)}
            onRemove={() => removeStep(index)}
            onUpdate={(updated) => updateStep(index, updated)}
            onMoveUp={() => moveStep(index, "up")}
            onMoveDown={() => moveStep(index, "down")}
            canMoveUp={index > 0}
            canMoveDown={index < steps.length - 1}
            viewOnly={viewOnly}
          />
        ))}
      </div>

      {steps.length === 0 && !viewOnly && (
        <div
          className="rounded-lg border border-dashed p-6 text-center"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p style={{ color: "var(--color-text-muted)" }}>No steps added yet</p>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Add steps below to define what this action does
          </p>
        </div>
      )}

      {/* Add step section - hidden in view-only mode */}
      {!viewOnly && (
        <div>
          <h4
            className="mb-3 text-sm font-medium"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Add Step
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STEP_TYPES.map((stepType) => (
              <button
                key={stepType.type}
                onClick={() => addStep(stepType.type)}
                className="flex items-start gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors hover:border-[--color-accent]/50"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <div
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded"
                  style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                >
                  <StepIcon type={stepType.type} />
                </div>
                <div className="min-w-0">
                  <div
                    className="font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {stepType.name}
                  </div>
                  <div
                    className="text-xs leading-tight"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {stepType.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface StepCardProps {
  step: ActionStep;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onUpdate: (step: ActionStep) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  viewOnly?: boolean;
}

function StepCard({
  step,
  index,
  isExpanded,
  onToggle,
  onRemove,
  onUpdate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  viewOnly = false,
}: StepCardProps) {
  const stepInfo = STEP_TYPES.find((s) => s.type === step.type);

  return (
    <div
      className="rounded-lg border"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex cursor-pointer items-center gap-3 p-3"
        onClick={onToggle}
      >
        <span
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
          }}
        >
          {index + 1}
        </span>
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        >
          <StepIcon type={step.type} />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            {stepInfo?.name || step.type}
          </div>
          <div
            className="truncate text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {getStepSummary(step)}
          </div>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {!viewOnly && (
            <>
              <button
                onClick={onMoveUp}
                disabled={!canMoveUp}
                className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary] disabled:opacity-30"
                title="Move up"
              >
                <IconChevronUp />
              </button>
              <button
                onClick={onMoveDown}
                disabled={!canMoveDown}
                className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary] disabled:opacity-30"
                title="Move down"
              >
                <IconChevronDown />
              </button>
              <button
                onClick={onRemove}
                className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
                title="Remove step"
              >
                <IconTrash />
              </button>
            </>
          )}
          <IconChevron isExpanded={isExpanded} />
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div
          className="border-t p-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <StepEditor step={step} onUpdate={onUpdate} viewOnly={viewOnly} />
        </div>
      )}
    </div>
  );
}

interface StepEditorProps {
  step: ActionStep;
  onUpdate: (step: ActionStep) => void;
  viewOnly?: boolean;
}

function StepEditor({ step, onUpdate, viewOnly = false }: StepEditorProps) {
  // In view-only mode, show a read-only summary of the step configuration
  if (viewOnly) {
    return (
      <div
        className="text-sm space-y-2"
        style={{ color: "var(--color-text-muted)" }}
      >
        <StepConfigSummary step={step} />
      </div>
    );
  }

  switch (step.type) {
    case "createPageFromTemplate":
      return (
        <CreatePageFromTemplateEditor
          step={step}
          onUpdate={(updates) => onUpdate({ ...step, ...updates })}
        />
      );
    case "createNotebook":
      return (
        <CreateNotebookEditor
          step={step}
          onUpdate={(updates) => onUpdate({ ...step, ...updates })}
        />
      );
    case "createFolder":
      return (
        <CreateFolderEditor
          step={step}
          onUpdate={(updates) => onUpdate({ ...step, ...updates })}
        />
      );
    case "archivePages":
      return (
        <PageSelectorEditor
          selector={step.selector}
          onChange={(selector) => onUpdate({ ...step, selector })}
          label="Pages to archive"
        />
      );
    case "manageTags":
      return (
        <ManageTagsEditor
          step={step}
          onUpdate={(updates) => onUpdate({ ...step, ...updates })}
        />
      );
    case "delay":
      return (
        <DelayEditor
          seconds={step.seconds}
          onChange={(seconds) => onUpdate({ ...step, seconds })}
        />
      );
    case "carryForwardItems":
      return (
        <CarryForwardEditor
          step={step}
          onUpdate={(updates) => onUpdate({ ...step, ...updates })}
        />
      );
    case "aiSummarize":
      return (
        <AiSummarizeEditor
          step={step}
          onUpdate={(updates) => onUpdate({ ...step, ...updates })}
        />
      );
    default:
      return (
        <div
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          Configuration for this step type is not yet available.
        </div>
      );
  }
}

// Helper to format notebook target
function formatNotebookTarget(target: { type: string; name?: string; id?: string }): string {
  if (target.type === "current") return "Current notebook";
  if (target.type === "byName" && "name" in target) return `Notebook: ${target.name}`;
  if (target.type === "byId" && "id" in target) return `Notebook ID: ${target.id}`;
  return "Unknown target";
}

// Read-only summary of step configuration
function StepConfigSummary({ step }: { step: ActionStep }) {
  switch (step.type) {
    case "createPageFromTemplate":
      return (
        <div className="space-y-1">
          <div><span className="font-medium">Template:</span> {step.templateId || "Not set"}</div>
          <div><span className="font-medium">Title:</span> {step.titleTemplate}</div>
          <div><span className="font-medium">Target:</span> {formatNotebookTarget(step.notebookTarget)}</div>
          {step.tags.length > 0 && <div><span className="font-medium">Tags:</span> {step.tags.join(", ")}</div>}
        </div>
      );
    case "createNotebook":
      return <div><span className="font-medium">Name:</span> {step.name}</div>;
    case "createFolder":
      return (
        <div className="space-y-1">
          <div><span className="font-medium">Name:</span> {step.name}</div>
          <div><span className="font-medium">Target:</span> {formatNotebookTarget(step.notebookTarget)}</div>
        </div>
      );
    case "archivePages":
      return (
        <div className="space-y-1">
          {step.selector.titlePattern && <div><span className="font-medium">Title pattern:</span> {step.selector.titlePattern}</div>}
          {step.selector.withTags.length > 0 && <div><span className="font-medium">With tags:</span> {step.selector.withTags.join(", ")}</div>}
          {step.selector.createdWithinDays && <div><span className="font-medium">Created within:</span> {step.selector.createdWithinDays} days</div>}
        </div>
      );
    case "manageTags":
      return (
        <div className="space-y-1">
          {step.addTags.length > 0 && <div><span className="font-medium">Add tags:</span> {step.addTags.join(", ")}</div>}
          {step.removeTags.length > 0 && <div><span className="font-medium">Remove tags:</span> {step.removeTags.join(", ")}</div>}
        </div>
      );
    case "delay":
      return <div><span className="font-medium">Duration:</span> {step.seconds} seconds</div>;
    case "carryForwardItems":
      return (
        <div className="space-y-1">
          <div><span className="font-medium">Title:</span> {step.titleTemplate}</div>
          <div><span className="font-medium">Destination:</span> {formatNotebookTarget(step.destination)}</div>
        </div>
      );
    case "aiSummarize":
      return (
        <div className="space-y-1">
          <div><span className="font-medium">Style:</span> {step.summaryStyle}</div>
          <div><span className="font-medium">Output:</span> {step.outputTarget.type === "result" ? "Variable" : step.outputTarget.type === "newPage" ? `New page: ${step.outputTarget.titleTemplate}` : "Prepend to page"}</div>
          {step.customPrompt && <div><span className="font-medium">Custom prompt:</span> {step.customPrompt}</div>}
        </div>
      );
    default:
      return <div>Step configuration details not available</div>;
  }
}

// Step-specific editors

function CreatePageFromTemplateEditor({
  step,
  onUpdate,
}: {
  step: Extract<ActionStep, { type: "createPageFromTemplate" }>;
  onUpdate: (updates: Partial<typeof step>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Template ID
        </label>
        <input
          type="text"
          value={step.templateId}
          onChange={(e) => onUpdate({ templateId: e.target.value })}
          placeholder="e.g., agile-results-daily"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Title Template
        </label>
        <input
          type="text"
          value={step.titleTemplate}
          onChange={(e) => onUpdate({ titleTemplate: e.target.value })}
          placeholder="e.g., {{date}} - Daily Goals"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
        <p
          className="mt-1 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Variables: {"{{date}}"}, {"{{dayOfWeek}}"}, {"{{weekNumber}}"}, {"{{monthName}}"}, {"{{year}}"}
        </p>
      </div>
      <NotebookTargetEditor
        target={step.notebookTarget}
        onChange={(notebookTarget) => onUpdate({ notebookTarget })}
      />
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Tags (comma separated)
        </label>
        <input
          type="text"
          value={step.tags.join(", ")}
          onChange={(e) =>
            onUpdate({
              tags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t),
            })
          }
          placeholder="e.g., daily, goals"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
    </div>
  );
}

function CreateNotebookEditor({
  step,
  onUpdate,
}: {
  step: Extract<ActionStep, { type: "createNotebook" }>;
  onUpdate: (updates: Partial<typeof step>) => void;
}) {
  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-medium"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Notebook Name
      </label>
      <input
        type="text"
        value={step.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        placeholder="e.g., {{monthName}} {{year}} Journal"
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-primary)",
        }}
      />
    </div>
  );
}

function CreateFolderEditor({
  step,
  onUpdate,
}: {
  step: Extract<ActionStep, { type: "createFolder" }>;
  onUpdate: (updates: Partial<typeof step>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Folder Name
        </label>
        <input
          type="text"
          value={step.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="e.g., Week {{weekNumber}}"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
      <NotebookTargetEditor
        target={step.notebookTarget}
        onChange={(notebookTarget) => onUpdate({ notebookTarget })}
      />
    </div>
  );
}

function ManageTagsEditor({
  step,
  onUpdate,
}: {
  step: Extract<ActionStep, { type: "manageTags" }>;
  onUpdate: (updates: Partial<typeof step>) => void;
}) {
  return (
    <div className="space-y-3">
      <PageSelectorEditor
        selector={step.selector}
        onChange={(selector) => onUpdate({ selector })}
        label="Pages to modify"
      />
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Tags to Add
        </label>
        <input
          type="text"
          value={step.addTags.join(", ")}
          onChange={(e) =>
            onUpdate({
              addTags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t),
            })
          }
          placeholder="tag1, tag2"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Tags to Remove
        </label>
        <input
          type="text"
          value={step.removeTags.join(", ")}
          onChange={(e) =>
            onUpdate({
              removeTags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t),
            })
          }
          placeholder="tag1, tag2"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
    </div>
  );
}

function DelayEditor({
  seconds,
  onChange,
}: {
  seconds: number;
  onChange: (seconds: number) => void;
}) {
  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-medium"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Delay Duration (seconds)
      </label>
      <input
        type="number"
        min={1}
        max={3600}
        value={seconds}
        onChange={(e) => onChange(parseInt(e.target.value) || 1)}
        className="w-32 rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-primary)",
        }}
      />
    </div>
  );
}

function CarryForwardEditor({
  step,
  onUpdate,
}: {
  step: Extract<ActionStep, { type: "carryForwardItems" }>;
  onUpdate: (updates: Partial<typeof step>) => void;
}) {
  return (
    <div className="space-y-3">
      <PageSelectorEditor
        selector={step.sourceSelector}
        onChange={(sourceSelector) => onUpdate({ sourceSelector })}
        label="Source pages (incomplete items)"
      />
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Destination Page Title
        </label>
        <input
          type="text"
          value={step.titleTemplate}
          onChange={(e) => onUpdate({ titleTemplate: e.target.value })}
          placeholder="e.g., {{date}} - Carried Forward"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
      <NotebookTargetEditor
        target={step.destination}
        onChange={(destination) => onUpdate({ destination })}
        label="Destination Notebook"
      />
    </div>
  );
}

function AiSummarizeEditor({
  step,
  onUpdate,
}: {
  step: Extract<ActionStep, { type: "aiSummarize" }>;
  onUpdate: (updates: Partial<typeof step>) => void;
}) {
  const summaryStyles = [
    { value: "concise", label: "Concise", description: "Brief and focused" },
    { value: "detailed", label: "Detailed", description: "Comprehensive coverage" },
    { value: "bullets", label: "Bullets", description: "Organized bullet points" },
    { value: "narrative", label: "Narrative", description: "Flowing story form" },
  ] as const;

  return (
    <div className="space-y-3">
      <PageSelectorEditor
        selector={step.selector}
        onChange={(selector) => onUpdate({ selector })}
        label="Pages to summarize"
      />

      {/* Summary Style */}
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Summary Style
        </label>
        <div className="flex flex-wrap gap-2">
          {summaryStyles.map((style) => (
            <button
              key={style.value}
              onClick={() => onUpdate({ summaryStyle: style.value })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                step.summaryStyle === style.value ? "text-white" : ""
              }`}
              style={{
                backgroundColor:
                  step.summaryStyle === style.value
                    ? "var(--color-accent)"
                    : "var(--color-bg-tertiary)",
                color:
                  step.summaryStyle === style.value
                    ? "white"
                    : "var(--color-text-secondary)",
              }}
              title={style.description}
            >
              {style.label}
            </button>
          ))}
        </div>
      </div>

      {/* Output Target */}
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Output Target
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onUpdate({ outputTarget: { type: "result" } })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              step.outputTarget.type === "result" ? "text-white" : ""
            }`}
            style={{
              backgroundColor:
                step.outputTarget.type === "result"
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              color:
                step.outputTarget.type === "result"
                  ? "white"
                  : "var(--color-text-secondary)",
            }}
          >
            Store as Variable
          </button>
          <button
            onClick={() =>
              onUpdate({
                outputTarget: {
                  type: "newPage",
                  notebookTarget: { type: "current" },
                  titleTemplate: "{{date}} - Summary",
                },
              })
            }
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              step.outputTarget.type === "newPage" ? "text-white" : ""
            }`}
            style={{
              backgroundColor:
                step.outputTarget.type === "newPage"
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              color:
                step.outputTarget.type === "newPage"
                  ? "white"
                  : "var(--color-text-secondary)",
            }}
          >
            Create New Page
          </button>
        </div>

        {/* Title template for new page */}
        {step.outputTarget.type === "newPage" && (
          <input
            type="text"
            value={step.outputTarget.titleTemplate}
            onChange={(e) =>
              onUpdate({
                outputTarget: {
                  ...step.outputTarget,
                  titleTemplate: e.target.value,
                } as typeof step.outputTarget,
              })
            }
            placeholder="Page title template"
            className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        )}
      </div>

      {/* Custom Prompt */}
      <div>
        <label
          className="mb-1.5 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Custom Prompt (optional)
        </label>
        <textarea
          value={step.customPrompt || ""}
          onChange={(e) => onUpdate({ customPrompt: e.target.value || undefined })}
          placeholder="e.g., Summarize the key decisions and action items from these pages"
          rows={3}
          className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
    </div>
  );
}

// Shared editors

function NotebookTargetEditor({
  target,
  onChange,
  label = "Target Notebook",
}: {
  target: NotebookTarget;
  onChange: (target: NotebookTarget) => void;
  label?: string;
}) {
  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-medium"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {label}
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => onChange({ type: "current" })}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            target.type === "current" ? "text-white" : ""
          }`}
          style={{
            backgroundColor:
              target.type === "current"
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            color:
              target.type === "current" ? "white" : "var(--color-text-secondary)",
          }}
        >
          Current
        </button>
        <button
          onClick={() => onChange({ type: "byName", name: "" })}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            target.type === "byName" ? "text-white" : ""
          }`}
          style={{
            backgroundColor:
              target.type === "byName"
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            color:
              target.type === "byName" ? "white" : "var(--color-text-secondary)",
          }}
        >
          By Name
        </button>
      </div>
      {target.type === "byName" && (
        <input
          type="text"
          value={target.name}
          onChange={(e) => onChange({ type: "byName", name: e.target.value })}
          placeholder="Notebook name"
          className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      )}
    </div>
  );
}

function PageSelectorEditor({
  selector,
  onChange,
  label,
}: {
  selector: PageSelector;
  onChange: (selector: PageSelector) => void;
  label: string;
}) {
  return (
    <div className="space-y-3">
      <label
        className="block text-xs font-medium"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {label}
      </label>
      <div>
        <label
          className="mb-1 block text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Title Pattern (use * as wildcard)
        </label>
        <input
          type="text"
          value={selector.titlePattern || ""}
          onChange={(e) =>
            onChange({ ...selector, titlePattern: e.target.value || undefined })
          }
          placeholder="e.g., *Daily Outcomes*"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
      <div>
        <label
          className="mb-1 block text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          With Tags
        </label>
        <input
          type="text"
          value={selector.withTags.join(", ")}
          onChange={(e) =>
            onChange({
              ...selector,
              withTags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t),
            })
          }
          placeholder="tag1, tag2"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
      <div>
        <label
          className="mb-1 block text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Created Within (days)
        </label>
        <input
          type="number"
          min={1}
          value={selector.createdWithinDays || ""}
          onChange={(e) =>
            onChange({
              ...selector,
              createdWithinDays: e.target.value
                ? parseInt(e.target.value)
                : undefined,
            })
          }
          placeholder="e.g., 7"
          className="w-32 rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>
    </div>
  );
}

// Helper functions

function createDefaultStep(type: ActionStep["type"]): ActionStep | null {
  switch (type) {
    case "createPageFromTemplate":
      return {
        type: "createPageFromTemplate",
        templateId: "",
        notebookTarget: { type: "current" },
        titleTemplate: "{{date}} - New Page",
        tags: [],
      };
    case "createNotebook":
      return {
        type: "createNotebook",
        name: "New Notebook",
      };
    case "createFolder":
      return {
        type: "createFolder",
        notebookTarget: { type: "current" },
        name: "New Folder",
      };
    case "movePages":
      return {
        type: "movePages",
        source: { withTags: [], withoutTags: [], archivedOnly: false },
        destination: { notebook: { type: "current" } },
      };
    case "archivePages":
      return {
        type: "archivePages",
        selector: { withTags: [], withoutTags: [], archivedOnly: false },
      };
    case "manageTags":
      return {
        type: "manageTags",
        selector: { withTags: [], withoutTags: [], archivedOnly: false },
        addTags: [],
        removeTags: [],
      };
    case "aiSummarize":
      return {
        type: "aiSummarize",
        selector: { withTags: [], withoutTags: [], archivedOnly: false },
        outputTarget: { type: "result" },
        summaryStyle: "concise",
      };
    case "carryForwardItems":
      return {
        type: "carryForwardItems",
        sourceSelector: { withTags: [], withoutTags: [], archivedOnly: false },
        destination: { type: "current" },
        titleTemplate: "{{date}} - Carried Forward",
      };
    case "delay":
      return { type: "delay", seconds: 5 };
    case "setVariable":
      return { type: "setVariable", name: "", value: "" };
    case "conditional":
      return {
        type: "conditional",
        condition: { type: "variableNotEmpty", name: "" },
        thenSteps: [],
        elseSteps: [],
      };
    case "searchAndProcess":
      return {
        type: "searchAndProcess",
        query: "",
        processSteps: [],
      };
    default:
      return null;
  }
}

function getStepSummary(step: ActionStep): string {
  switch (step.type) {
    case "createPageFromTemplate":
      return `Create "${step.titleTemplate}" from ${step.templateId || "template"}`;
    case "createNotebook":
      return `Create notebook "${step.name}"`;
    case "createFolder":
      return `Create folder "${step.name}"`;
    case "archivePages":
      return `Archive matching pages`;
    case "manageTags":
      const adds = step.addTags.length > 0 ? `+${step.addTags.join(", ")}` : "";
      const removes = step.removeTags.length > 0 ? `-${step.removeTags.join(", ")}` : "";
      return `Tags: ${adds} ${removes}`.trim() || "Manage tags";
    case "aiSummarize":
      return "AI summarize selected pages";
    case "carryForwardItems":
      return `Carry forward to "${step.titleTemplate}"`;
    case "delay":
      return `Wait ${step.seconds} seconds`;
    case "conditional":
      return `If condition then ${step.thenSteps.length} steps`;
    default:
      return step.type;
  }
}

// Icons

function StepIcon({ type }: { type: ActionStep["type"] }) {
  const color = "var(--color-accent)";
  const size = 14;

  switch (type) {
    case "createPageFromTemplate":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      );
    case "createNotebook":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          <line x1="12" y1="13" x2="12" y2="7" />
          <line x1="9" y1="10" x2="15" y2="10" />
        </svg>
      );
    case "createFolder":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      );
    case "archivePages":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <polyline points="21 8 21 21 3 21 3 8" />
          <rect x="1" y="3" width="22" height="5" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      );
    case "manageTags":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      );
    case "aiSummarize":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "carryForwardItems":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      );
    case "delay":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "conditional":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
  }
}

function IconChevronUp() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ color: "var(--color-text-muted)" }}
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ color: "var(--color-text-muted)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconChevron({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{
        color: "var(--color-text-muted)",
        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.2s",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
