import { useState, useEffect } from "react";
import { useActionStore } from "../../stores/actionStore";
import type {
  ActionCategory,
  ActionTrigger,
  ActionStep,
  Schedule,
} from "../../types/action";
import { ACTION_CATEGORIES, STEP_TYPES } from "../../types/action";

interface ActionEditorProps {
  isOpen: boolean;
  onClose: () => void;
  editingActionId?: string | null;
}

type EditorStep = "basics" | "triggers" | "steps" | "review";

export function ActionEditor({
  isOpen,
  onClose,
  editingActionId,
}: ActionEditorProps) {
  const { actions, createAction, updateAction } = useActionStore();

  const [currentStep, setCurrentStep] = useState<EditorStep>("basics");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ActionCategory>("custom");
  const [triggers, setTriggers] = useState<ActionTrigger[]>([{ type: "manual" }]);
  const [steps, setSteps] = useState<ActionStep[]>([]);

  // Load existing action when editing
  useEffect(() => {
    if (isOpen && editingActionId) {
      const existingAction = actions.find((a) => a.id === editingActionId);
      if (existingAction) {
        setName(existingAction.name);
        setDescription(existingAction.description);
        setCategory(existingAction.category);
        setTriggers(existingAction.triggers);
        setSteps(existingAction.steps);
      }
    } else if (isOpen && !editingActionId) {
      // Reset form for new action
      setName("");
      setDescription("");
      setCategory("custom");
      setTriggers([{ type: "manual" }]);
      setSteps([]);
      setCurrentStep("basics");
    }
  }, [isOpen, editingActionId, actions]);

  if (!isOpen) return null;

  const handleNext = () => {
    const stepOrder: EditorStep[] = ["basics", "triggers", "steps", "review"];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex < stepOrder.length - 1) {
      setCurrentStep(stepOrder[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const stepOrder: EditorStep[] = ["basics", "triggers", "steps", "review"];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(stepOrder[currentIndex - 1]);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      if (editingActionId) {
        await updateAction(editingActionId, {
          name: name.trim(),
          description: description.trim(),
          category,
          triggers,
          steps,
        });
      } else {
        await createAction(name.trim(), description.trim(), {
          category,
          triggers,
          steps,
        });
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBasicsValid = name.trim().length > 0;
  const canProceed =
    (currentStep === "basics" && isBasicsValid) ||
    currentStep === "triggers" ||
    currentStep === "steps";

  // Add trigger
  const addTrigger = (type: ActionTrigger["type"]) => {
    if (type === "manual" && !triggers.some((t) => t.type === "manual")) {
      setTriggers([...triggers, { type: "manual" }]);
    } else if (type === "aiChat" && !triggers.some((t) => t.type === "aiChat")) {
      setTriggers([...triggers, { type: "aiChat", keywords: [] }]);
    } else if (type === "scheduled" && !triggers.some((t) => t.type === "scheduled")) {
      setTriggers([
        ...triggers,
        {
          type: "scheduled",
          schedule: { type: "daily", time: "09:00", skipWeekends: false },
        },
      ]);
    }
  };

  // Remove trigger
  const removeTrigger = (index: number) => {
    setTriggers(triggers.filter((_, i) => i !== index));
  };

  // Update AI chat keywords
  const updateAiKeywords = (index: number, keywords: string[]) => {
    setTriggers(
      triggers.map((t, i) =>
        i === index && t.type === "aiChat" ? { ...t, keywords } : t
      )
    );
  };

  // Update schedule
  const updateSchedule = (index: number, schedule: Schedule) => {
    setTriggers(
      triggers.map((t, i) =>
        i === index && t.type === "scheduled" ? { ...t, schedule } : t
      )
    );
  };

  // Add step
  const addStep = (type: ActionStep["type"]) => {
    let newStep: ActionStep;
    switch (type) {
      case "createPageFromTemplate":
        newStep = {
          type: "createPageFromTemplate",
          templateId: "",
          notebookTarget: { type: "current" },
          titleTemplate: "{{date}} - New Page",
          tags: [],
        };
        break;
      case "createNotebook":
        newStep = {
          type: "createNotebook",
          name: "New Notebook",
        };
        break;
      case "createFolder":
        newStep = {
          type: "createFolder",
          notebookTarget: { type: "current" },
          name: "New Folder",
        };
        break;
      case "archivePages":
        newStep = {
          type: "archivePages",
          selector: { withTags: [], withoutTags: [], archivedOnly: false },
        };
        break;
      case "manageTags":
        newStep = {
          type: "manageTags",
          selector: { withTags: [], withoutTags: [], archivedOnly: false },
          addTags: [],
          removeTags: [],
        };
        break;
      case "delay":
        newStep = { type: "delay", seconds: 5 };
        break;
      default:
        return;
    }
    setSteps([...steps, newStep]);
  };

  // Remove step
  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-xl border shadow-2xl"
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
              {editingActionId ? "Edit Action" : "Create Action"}
            </h2>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {currentStep === "basics" && "Set up basic information"}
              {currentStep === "triggers" && "Configure when to run"}
              {currentStep === "steps" && "Define what the action does"}
              {currentStep === "review" && "Review and save"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:opacity-80"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <IconClose />
          </button>
        </div>

        {/* Progress indicator */}
        <div
          className="flex items-center gap-2 border-b px-6 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          {(["basics", "triggers", "steps", "review"] as EditorStep[]).map(
            (step, index) => (
              <div key={step} className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentStep(step)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                    currentStep === step ? "text-white" : ""
                  }`}
                  style={{
                    backgroundColor:
                      currentStep === step
                        ? "var(--color-accent)"
                        : "var(--color-bg-tertiary)",
                    color:
                      currentStep === step
                        ? "white"
                        : "var(--color-text-muted)",
                  }}
                >
                  {index + 1}
                </button>
                <span
                  className="hidden text-sm sm:block"
                  style={{
                    color:
                      currentStep === step
                        ? "var(--color-text-primary)"
                        : "var(--color-text-muted)",
                  }}
                >
                  {step.charAt(0).toUpperCase() + step.slice(1)}
                </span>
                {index < 3 && (
                  <div
                    className="h-px w-8"
                    style={{ backgroundColor: "var(--color-border)" }}
                  />
                )}
              </div>
            )
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Basics step */}
          {currentStep === "basics" && (
            <div className="space-y-4">
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Daily Goals Setup"
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
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this action do?"
                  rows={3}
                  className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
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
                  Category
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ACTION_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCategory(cat.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        category === cat.id
                          ? "border-[--color-accent]"
                          : "hover:border-[--color-accent]/50"
                      }`}
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor:
                          category === cat.id
                            ? "var(--color-accent)"
                            : "var(--color-border)",
                      }}
                    >
                      <div
                        className="text-sm font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {cat.name}
                      </div>
                      <div
                        className="mt-0.5 text-xs"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {cat.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Triggers step */}
          {currentStep === "triggers" && (
            <div className="space-y-4">
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Choose when this action should be triggered. You can add
                multiple triggers.
              </p>

              {/* Current triggers */}
              <div className="space-y-3">
                {triggers.map((trigger, index) => (
                  <TriggerItem
                    key={index}
                    trigger={trigger}
                    onRemove={() => removeTrigger(index)}
                    onUpdateKeywords={(kw) => updateAiKeywords(index, kw)}
                    onUpdateSchedule={(s) => updateSchedule(index, s)}
                  />
                ))}
              </div>

              {/* Add trigger buttons */}
              <div className="flex flex-wrap gap-2">
                {!triggers.some((t) => t.type === "manual") && (
                  <button
                    onClick={() => addTrigger("manual")}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors hover:opacity-80"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <IconPlus /> Manual
                  </button>
                )}
                {!triggers.some((t) => t.type === "aiChat") && (
                  <button
                    onClick={() => addTrigger("aiChat")}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors hover:opacity-80"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <IconPlus /> AI Chat
                  </button>
                )}
                {!triggers.some((t) => t.type === "scheduled") && (
                  <button
                    onClick={() => addTrigger("scheduled")}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors hover:opacity-80"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <IconPlus /> Scheduled
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Steps step */}
          {currentStep === "steps" && (
            <div className="space-y-4">
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Define the steps this action will execute. Steps run in order.
              </p>

              {/* Current steps */}
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <StepItem
                    key={index}
                    step={step}
                    index={index}
                    onRemove={() => removeStep(index)}
                  />
                ))}
              </div>

              {steps.length === 0 && (
                <div
                  className="rounded-lg border border-dashed p-6 text-center"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <p style={{ color: "var(--color-text-muted)" }}>
                    No steps added yet
                  </p>
                  <p
                    className="mt-1 text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Add steps to define what this action does
                  </p>
                </div>
              )}

              {/* Add step buttons */}
              <div>
                <h4
                  className="mb-2 text-sm font-medium"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Add Step
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {STEP_TYPES.slice(0, 6).map((stepType) => (
                    <button
                      key={stepType.type}
                      onClick={() => addStep(stepType.type)}
                      className="flex items-center gap-2 rounded-lg border p-2 text-left text-sm transition-colors hover:border-[--color-accent]/50"
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded"
                        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                      >
                        <IconStep />
                      </div>
                      <div>
                        <div style={{ color: "var(--color-text-primary)" }}>
                          {stepType.name}
                        </div>
                        <div
                          className="text-xs"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {stepType.description}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Review step */}
          {currentStep === "review" && (
            <div className="space-y-4">
              <div
                className="rounded-lg border p-4"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <h4
                  className="font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {name || "Untitled Action"}
                </h4>
                <p
                  className="mt-1 text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {description || "No description"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {ACTION_CATEGORIES.find((c) => c.id === category)?.name}
                  </span>
                </div>
              </div>

              <div>
                <h4
                  className="mb-2 text-sm font-medium"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Triggers ({triggers.length})
                </h4>
                <ul className="list-inside list-disc text-sm">
                  {triggers.map((t, i) => (
                    <li key={i} style={{ color: "var(--color-text-muted)" }}>
                      {t.type === "manual" && "Manual trigger"}
                      {t.type === "aiChat" &&
                        `AI Chat: ${t.keywords.join(", ") || "no keywords"}`}
                      {t.type === "scheduled" &&
                        `Scheduled: ${t.schedule.type} at ${t.schedule.time}`}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4
                  className="mb-2 text-sm font-medium"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Steps ({steps.length})
                </h4>
                {steps.length > 0 ? (
                  <ul className="list-inside list-decimal text-sm">
                    {steps.map((s, i) => (
                      <li key={i} style={{ color: "var(--color-text-muted)" }}>
                        {STEP_TYPES.find((st) => st.type === s.type)?.name ||
                          s.type}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p
                    className="text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    No steps configured
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={handleBack}
            disabled={currentStep === "basics"}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80 disabled:invisible"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Back
          </button>

          {currentStep !== "review" ? (
            <button
              onClick={handleNext}
              disabled={!canProceed}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !isBasicsValid}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              {isSubmitting
                ? "Saving..."
                : editingActionId
                  ? "Save Changes"
                  : "Create Action"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Trigger item component
function TriggerItem({
  trigger,
  onRemove,
  onUpdateKeywords,
  onUpdateSchedule,
}: {
  trigger: ActionTrigger;
  onRemove: () => void;
  onUpdateKeywords: (keywords: string[]) => void;
  onUpdateSchedule: (schedule: Schedule) => void;
}) {
  const [keywordsInput, setKeywordsInput] = useState(
    trigger.type === "aiChat" ? trigger.keywords.join(", ") : ""
  );

  const handleKeywordsBlur = () => {
    if (trigger.type === "aiChat") {
      const keywords = keywordsInput
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      onUpdateKeywords(keywords);
    }
  };

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {trigger.type === "manual" && (
            <>
              <IconClick />
              <span style={{ color: "var(--color-text-primary)" }}>
                Manual Trigger
              </span>
            </>
          )}
          {trigger.type === "aiChat" && (
            <>
              <IconMessage />
              <span style={{ color: "var(--color-text-primary)" }}>
                AI Chat Trigger
              </span>
            </>
          )}
          {trigger.type === "scheduled" && (
            <>
              <IconClock />
              <span style={{ color: "var(--color-text-primary)" }}>
                Scheduled Trigger
              </span>
            </>
          )}
        </div>
        <button
          onClick={onRemove}
          className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
        >
          <IconClose size={14} />
        </button>
      </div>

      {trigger.type === "aiChat" && (
        <div className="mt-2">
          <input
            type="text"
            value={keywordsInput}
            onChange={(e) => setKeywordsInput(e.target.value)}
            onBlur={handleKeywordsBlur}
            placeholder="Keywords (comma separated)"
            className="w-full rounded border px-2 py-1 text-sm outline-none"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>
      )}

      {trigger.type === "scheduled" && (
        <div className="mt-2 flex gap-2">
          <select
            value={trigger.schedule.type}
            onChange={(e) =>
              onUpdateSchedule({
                ...trigger.schedule,
                type: e.target.value as Schedule["type"],
              } as Schedule)
            }
            className="rounded border px-2 py-1 text-sm outline-none"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input
            type="time"
            value={trigger.schedule.time}
            onChange={(e) =>
              onUpdateSchedule({ ...trigger.schedule, time: e.target.value })
            }
            className="rounded border px-2 py-1 text-sm outline-none"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// Step item component
function StepItem({
  step,
  index,
  onRemove,
}: {
  step: ActionStep;
  index: number;
  onRemove: () => void;
}) {
  const stepInfo = STEP_TYPES.find((s) => s.type === step.type);

  return (
    <div
      className="flex items-center gap-3 rounded-lg border p-3"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          color: "var(--color-text-muted)",
        }}
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          {stepInfo?.name || step.type}
        </div>
        <div
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          {stepInfo?.description}
        </div>
      </div>
      <button
        onClick={onRemove}
        className="flex-shrink-0 rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}

// Icons
function IconClose({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
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
  );
}

function IconPlus() {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconClick() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="M9 9h.01" />
      <path d="M15 9h.01" />
      <path d="M9 15h.01" />
      <path d="M15 15h.01" />
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z" />
    </svg>
  );
}

function IconMessage() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconClock() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconStep() {
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
      style={{ color: "var(--color-accent)" }}
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
