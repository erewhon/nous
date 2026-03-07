import { useState, useEffect, useCallback, useRef } from "react";
import { tourSteps, type TourStep } from "./tourSteps";
import { useThemeStore } from "../../stores/themeStore";

/**
 * Full-screen tour overlay with spotlight cutout highlighting the target element,
 * a tooltip with step info, and prev/next/skip controls.
 */
export function TourOverlay() {
  const tourCompleted = useThemeStore((s) => s.tourCompleted);
  const expertMode = useThemeStore((s) => s.expertMode);
  const setTourCompleted = useThemeStore((s) => s.setTourCompleted);

  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Auto-start tour for new users (beginner mode, tour not completed)
  useEffect(() => {
    if (!tourCompleted && !expertMode) {
      // Small delay so the UI renders first
      const timer = setTimeout(() => setActive(true), 800);
      return () => clearTimeout(timer);
    }
  }, [tourCompleted, expertMode]);

  // Listen for manual tour trigger
  useEffect(() => {
    const handler = () => {
      setStep(0);
      setActive(true);
    };
    window.addEventListener("start-tour", handler);
    return () => window.removeEventListener("start-tour", handler);
  }, []);

  // Measure target element whenever step changes
  useEffect(() => {
    if (!active) return;

    const currentStep = tourSteps[step];
    if (!currentStep) return;

    const measure = () => {
      const el = document.querySelector(currentStep.target);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    };

    measure();

    // Re-measure on resize/scroll
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, step]);

  const finish = useCallback(() => {
    setActive(false);
    setTourCompleted(true);
  }, [setTourCompleted]);

  const next = useCallback(() => {
    if (step < tourSteps.length - 1) {
      setStep((s) => s + 1);
    } else {
      finish();
    }
  }, [step, finish]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  if (!active) return null;

  const currentStep = tourSteps[step];
  const padding = 8;

  // Spotlight rect with padding
  const spot = targetRect
    ? {
        x: targetRect.x - padding,
        y: targetRect.y - padding,
        w: targetRect.width + padding * 2,
        h: targetRect.height + padding * 2,
      }
    : null;

  // Tooltip positioning
  const tooltipStyle = getTooltipStyle(currentStep, spot);

  return (
    <div
      className="fixed inset-0 z-[9999]"
      onClick={(e) => {
        // Click on backdrop skips to next
        if (e.target === e.currentTarget) next();
      }}
    >
      {/* SVG overlay with cutout */}
      <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spot && (
              <rect
                x={spot.x}
                y={spot.y}
                width={spot.w}
                height={spot.h}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#tour-mask)"
          style={{ pointerEvents: "all" }}
        />
      </svg>

      {/* Spotlight ring */}
      {spot && (
        <div
          className="pointer-events-none absolute rounded-lg"
          style={{
            left: spot.x,
            top: spot.y,
            width: spot.w,
            height: spot.h,
            boxShadow: "0 0 0 2px var(--color-accent), 0 0 16px 2px rgba(139, 92, 246, 0.3)",
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute z-[10000] w-80 rounded-xl border p-5 shadow-2xl"
        style={{
          ...tooltipStyle,
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Step counter */}
        <div
          className="mb-2 text-xs font-medium"
          style={{ color: "var(--color-accent)" }}
        >
          Step {step + 1} of {tourSteps.length}
        </div>

        <h3
          className="mb-1.5 text-base font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          {currentStep.title}
        </h3>
        <p
          className="mb-4 text-sm leading-relaxed"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {currentStep.description}
        </p>

        {/* Progress dots */}
        <div className="mb-4 flex gap-1.5">
          {tourSteps.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === step ? 20 : 6,
                backgroundColor:
                  i === step
                    ? "var(--color-accent)"
                    : i < step
                      ? "var(--color-accent)"
                      : "var(--color-border)",
                opacity: i < step ? 0.5 : 1,
              }}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <button
            onClick={finish}
            className="rounded px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-[--color-bg-secondary]"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              {step < tourSteps.length - 1 ? "Next" : "Get Started"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Calculate absolute positioning for the tooltip based on step placement and spotlight rect */
function getTooltipStyle(
  step: TourStep,
  spot: { x: number; y: number; w: number; h: number } | null,
): React.CSSProperties {
  if (!spot) {
    // Centered fallback
    return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  }

  const gap = 16;
  const tooltipW = 320; // matches w-80

  switch (step.placement) {
    case "right":
      return {
        left: Math.min(spot.x + spot.w + gap, window.innerWidth - tooltipW - 16),
        top: spot.y,
      };
    case "left":
      return {
        left: Math.max(16, spot.x - tooltipW - gap),
        top: spot.y,
      };
    case "bottom":
      return {
        left: Math.max(16, Math.min(spot.x, window.innerWidth - tooltipW - 16)),
        top: spot.y + spot.h + gap,
      };
    case "top":
      return {
        left: Math.max(16, Math.min(spot.x, window.innerWidth - tooltipW - 16)),
        top: Math.max(16, spot.y - gap - 200), // approximate tooltip height
      };
  }
}
