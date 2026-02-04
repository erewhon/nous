interface VideoProgressProps {
  progress: number;
  currentSlide: number;
  totalSlides: number;
  status?: string;
}

export function VideoProgress({
  progress,
  currentSlide,
  totalSlides,
  status,
}: VideoProgressProps) {
  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: "var(--color-text-secondary)" }}>
            {status || "Generating video..."}
          </span>
          <span style={{ color: "var(--color-text-muted)" }}>{progress}%</span>
        </div>
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        >
          <div
            className="h-full transition-all duration-300 rounded-full"
            style={{
              width: `${progress}%`,
              backgroundColor: "var(--color-accent)",
            }}
          />
        </div>
      </div>

      {/* Slide progress */}
      {totalSlides > 0 && (
        <div
          className="text-sm text-center"
          style={{ color: "var(--color-text-muted)" }}
        >
          Processing slide {currentSlide} of {totalSlides}
        </div>
      )}

      {/* Animated indicator */}
      <div className="flex justify-center">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full animate-pulse"
              style={{
                backgroundColor: "var(--color-accent)",
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
