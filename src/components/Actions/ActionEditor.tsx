import { useState, useEffect } from "react";
import { useActionStore } from "../../stores/actionStore";
import type {
  ActionCategory,
  ActionTrigger,
  ActionStep,
} from "../../types/action";
import { ACTION_CATEGORIES, STEP_TYPES } from "../../types/action";
import { TriggerEditor } from "./TriggerEditor";
import { StepBuilder } from "./StepBuilder";

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
  const { actions, createAction, updateAction, viewOnlyMode } = useActionStore();

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
              {viewOnlyMode ? "View Action" : editingActionId ? "Edit Action" : "Create Action"}
            </h2>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {viewOnlyMode
                ? "This is a built-in action and cannot be edited"
                : currentStep === "basics"
                  ? "Set up basic information"
                  : currentStep === "triggers"
                    ? "Configure when to run"
                    : currentStep === "steps"
                      ? "Define what the action does"
                      : "Review and save"}
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
                  Name {!viewOnlyMode && "*"}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Daily Goals Setup"
                  disabled={viewOnlyMode}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent] disabled:cursor-not-allowed disabled:opacity-70"
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
                  disabled={viewOnlyMode}
                  className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent] disabled:cursor-not-allowed disabled:opacity-70"
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
                      onClick={() => !viewOnlyMode && setCategory(cat.id)}
                      disabled={viewOnlyMode}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        category === cat.id
                          ? "border-[--color-accent]"
                          : viewOnlyMode
                            ? ""
                            : "hover:border-[--color-accent]/50"
                      } ${viewOnlyMode ? "cursor-not-allowed opacity-70" : ""}`}
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
            <TriggerEditor triggers={triggers} onChange={setTriggers} viewOnly={viewOnlyMode} />
          )}

          {/* Steps step */}
          {currentStep === "steps" && (
            <StepBuilder steps={steps} onChange={setSteps} viewOnly={viewOnlyMode} />
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
          {viewOnlyMode ? (
            <>
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
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: "var(--color-accent)" }}
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: "var(--color-accent)" }}
                >
                  Close
                </button>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
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
