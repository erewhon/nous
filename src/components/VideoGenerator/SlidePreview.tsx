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
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SlideContent } from "../../types/videoGenerate";

interface SlidePreviewProps {
  slide: SlideContent;
  slideNumber: number;
  totalSlides: number;
  theme: "light" | "dark";
  isSelected?: boolean;
  onClick?: () => void;
}

export function SlidePreview({
  slide,
  slideNumber,
  totalSlides,
  theme,
  isSelected,
  onClick,
}: SlidePreviewProps) {
  const colors =
    theme === "dark"
      ? {
          background: "#1a1a2e",
          text: "#eaeaea",
          textSecondary: "#b0b0b0",
          primary: "#0f4c75",
          border: "#3a3a5a",
        }
      : {
          background: "#ffffff",
          text: "#2c3e50",
          textSecondary: "#7f8c8d",
          primary: "#3498db",
          border: "#bdc3c7",
        };

  return (
    <div
      className={`cursor-pointer transition-all rounded-lg overflow-hidden ${
        isSelected ? "ring-2 ring-[--color-accent]" : ""
      }`}
      onClick={onClick}
      style={{
        border: `1px solid ${colors.border}`,
      }}
    >
      {/* Slide preview */}
      <div
        className="p-3 aspect-video relative"
        style={{ backgroundColor: colors.background }}
      >
        {/* Title */}
        <div
          className="text-xs font-semibold truncate mb-1"
          style={{ color: colors.text }}
        >
          {slide.title}
        </div>

        {/* Divider */}
        <div
          className="h-0.5 w-8 mb-2"
          style={{ backgroundColor: colors.primary }}
        />

        {/* Body preview */}
        {slide.body && (
          <div
            className="text-[8px] line-clamp-2 mb-1"
            style={{ color: colors.textSecondary }}
          >
            {slide.body}
          </div>
        )}

        {/* Bullet points preview */}
        {slide.bulletPoints.slice(0, 3).map((point, i) => (
          <div
            key={i}
            className="flex items-start gap-1 text-[8px]"
            style={{ color: colors.textSecondary }}
          >
            <span
              className="w-1 h-1 rounded-full mt-0.5 flex-shrink-0"
              style={{ backgroundColor: colors.primary }}
            />
            <span className="line-clamp-1">{point}</span>
          </div>
        ))}

        {/* Slide number */}
        <div
          className="absolute bottom-1 right-2 text-[8px]"
          style={{ color: colors.textSecondary }}
        >
          {slideNumber} / {totalSlides}
        </div>
      </div>
    </div>
  );
}

interface SortableSlideProps {
  id: string;
  slide: SlideContent;
  slideNumber: number;
  totalSlides: number;
  theme: "light" | "dark";
  isSelected: boolean;
  onClick: () => void;
}

function SortableSlide({
  id,
  slide,
  slideNumber,
  totalSlides,
  theme,
  isSelected,
  onClick,
}: SortableSlideProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <SlidePreview
        slide={slide}
        slideNumber={slideNumber}
        totalSlides={totalSlides}
        theme={theme}
        isSelected={isSelected}
        onClick={onClick}
      />
    </div>
  );
}

interface SlideListProps {
  slides: SlideContent[];
  selectedIndex: number;
  onSelectSlide: (index: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  theme: "light" | "dark";
}

export function SlideList({
  slides,
  selectedIndex,
  onSelectSlide,
  onReorder,
  theme,
}: SlideListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // Stable IDs for sortable
  const slideIds = slides.map((_, i) => `slide-${i}`);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;

    const oldIndex = slideIds.indexOf(active.id as string);
    const newIndex = slideIds.indexOf(over.id as string);
    if (oldIndex !== -1 && newIndex !== -1) {
      onReorder(oldIndex, newIndex);
      // Update selected index to follow the dragged item
      if (selectedIndex === oldIndex) {
        onSelectSlide(newIndex);
      } else if (selectedIndex > oldIndex && selectedIndex <= newIndex) {
        onSelectSlide(selectedIndex - 1);
      } else if (selectedIndex < oldIndex && selectedIndex >= newIndex) {
        onSelectSlide(selectedIndex + 1);
      }
    }
  };

  if (slides.length === 0) {
    return (
      <div
        className="text-center py-8 text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        No slides yet. Generate slides from study content.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={slideIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-3 gap-3">
          {slides.map((slide, index) => (
            <SortableSlide
              key={slideIds[index]}
              id={slideIds[index]}
              slide={slide}
              slideNumber={index + 1}
              totalSlides={slides.length}
              theme={theme}
              isSelected={index === selectedIndex}
              onClick={() => onSelectSlide(index)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
