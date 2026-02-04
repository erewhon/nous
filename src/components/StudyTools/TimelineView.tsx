import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import type { Timeline, TimelineEvent } from "../../types/studyTools";

interface TimelineViewProps {
  timeline: Timeline;
  onNavigateToPage?: (pageId: string) => void;
  onClose?: () => void;
}

export function TimelineView({
  timeline,
  onNavigateToPage,
  onClose,
}: TimelineViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: Math.max(300, containerRef.current.clientHeight),
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Parse dates and sort events
  const processedEvents = useMemo(() => {
    return timeline.events
      .map((event) => ({
        ...event,
        parsedDate: new Date(event.date),
      }))
      .filter((event) => !isNaN(event.parsedDate.getTime()))
      .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
  }, [timeline.events]);

  // Get unique categories for color coding
  const categories = useMemo(() => {
    const cats = new Set(processedEvents.map((e) => e.category || "default"));
    return Array.from(cats);
  }, [processedEvents]);

  // Color scale for categories
  const colorScale = useMemo(() => {
    const colors = [
      "#8b5cf6", // purple
      "#10b981", // green
      "#f59e0b", // amber
      "#ec4899", // pink
      "#06b6d4", // cyan
      "#3b82f6", // blue
      "#ef4444", // red
    ];
    return d3.scaleOrdinal<string>().domain(categories).range(colors);
  }, [categories]);

  // Render timeline
  useEffect(() => {
    if (!svgRef.current || processedEvents.length === 0) return;

    const { width, height } = dimensions;
    const margin = { top: 40, right: 40, bottom: 60, left: 40 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    // Create scales
    const dateExtent = d3.extent(processedEvents, (d) => d.parsedDate) as [Date, Date];
    const xScale = d3
      .scaleTime()
      .domain(dateExtent)
      .range([0, innerWidth])
      .nice();

    // Main group with margin
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Add zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 10])
      .translateExtent([
        [-100, 0],
        [width + 100, height],
      ])
      .on("zoom", (event) => {
        const newXScale = event.transform.rescaleX(xScale);
        updateTimeline(newXScale);
      });

    svg.call(zoom);

    // Draw axis
    const xAxis = d3.axisBottom(xScale).ticks(Math.max(3, innerWidth / 100));

    const axisGroup = g
      .append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${innerHeight / 2})`)
      .call(xAxis);

    axisGroup
      .selectAll("text")
      .attr("fill", "var(--color-text-muted)")
      .attr("font-size", "11px");

    axisGroup.selectAll("line, path").attr("stroke", "var(--color-border)");

    // Timeline line
    g.append("line")
      .attr("x1", 0)
      .attr("y1", innerHeight / 2)
      .attr("x2", innerWidth)
      .attr("y2", innerHeight / 2)
      .attr("stroke", "var(--color-border)")
      .attr("stroke-width", 2);

    // Draw events
    const eventGroups = g
      .selectAll(".event")
      .data(processedEvents)
      .enter()
      .append("g")
      .attr("class", "event")
      .attr("transform", (d, i) => {
        const x = xScale(d.parsedDate);
        const y = innerHeight / 2 + (i % 2 === 0 ? -60 : 60);
        return `translate(${x},${y})`;
      })
      .style("cursor", "pointer");

    // Event circles
    eventGroups
      .append("circle")
      .attr("r", 8)
      .attr("fill", (d) => colorScale(d.category || "default"))
      .attr("stroke", "var(--color-bg-primary)")
      .attr("stroke-width", 2);

    // Connector lines
    eventGroups
      .append("line")
      .attr("x1", 0)
      .attr("y1", (_, i) => (i % 2 === 0 ? 8 : -8))
      .attr("x2", 0)
      .attr("y2", (_, i) => (i % 2 === 0 ? 52 : -52))
      .attr("stroke", "var(--color-border)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2,2");

    // Event labels
    eventGroups
      .append("text")
      .text((d) => (d.title.length > 25 ? d.title.slice(0, 23) + "..." : d.title))
      .attr("x", 0)
      .attr("y", (_, i) => (i % 2 === 0 ? -15 : 20))
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-secondary)")
      .attr("font-size", "11px");

    // Date labels
    eventGroups
      .append("text")
      .text((d) => d3.timeFormat("%b %d, %Y")(d.parsedDate))
      .attr("x", 0)
      .attr("y", (_, i) => (i % 2 === 0 ? -28 : 35))
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-muted)")
      .attr("font-size", "9px");

    // Event interactions
    eventGroups
      .on("mouseenter", function (_event, d) {
        d3.select(this)
          .select("circle")
          .transition()
          .duration(150)
          .attr("r", 12)
          .attr("stroke-width", 3);
        setHoveredEvent(d);
      })
      .on("mouseleave", function () {
        d3.select(this)
          .select("circle")
          .transition()
          .duration(150)
          .attr("r", 8)
          .attr("stroke-width", 2);
        setHoveredEvent(null);
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedEvent(d);
      });

    // Update function for zoom
    function updateTimeline(newXScale: d3.ScaleTime<number, number>) {
      eventGroups.attr("transform", (d, i) => {
        const x = newXScale(d.parsedDate);
        const y = innerHeight / 2 + (i % 2 === 0 ? -60 : 60);
        return `translate(${x},${y})`;
      });

      axisGroup.call(d3.axisBottom(newXScale).ticks(Math.max(3, innerWidth / 100)));
      axisGroup.selectAll("text").attr("fill", "var(--color-text-muted)");
      axisGroup.selectAll("line, path").attr("stroke", "var(--color-border)");
    }
  }, [processedEvents, dimensions, colorScale]);

  const handleNavigateToPage = useCallback(
    (pageId: string) => {
      if (onNavigateToPage) {
        onNavigateToPage(pageId);
        onClose?.();
      }
    },
    [onNavigateToPage, onClose]
  );

  if (processedEvents.length === 0) {
    return (
      <div
        className="flex h-64 items-center justify-center"
        style={{ color: "var(--color-text-muted)" }}
      >
        <div className="text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-3 opacity-50"
          >
            <line x1="12" y1="20" x2="12" y2="4" />
            <polyline points="6 10 12 4 18 10" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="20" r="2" />
          </svg>
          <p>No dated events found</p>
          <p className="text-sm mt-1">The timeline requires events with valid dates</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Category legend */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {categories.map((category) => (
            <div key={category} className="flex items-center gap-1.5 text-xs">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: colorScale(category) }}
              />
              <span style={{ color: "var(--color-text-muted)" }}>
                {category === "default" ? "Other" : category}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Timeline visualization */}
      <div ref={containerRef} className="flex-1 min-h-[300px] relative">
        <svg ref={svgRef} className="w-full h-full" />

        {/* Hover tooltip */}
        {hoveredEvent && (
          <div
            className="absolute z-10 p-3 rounded-lg shadow-lg max-w-xs pointer-events-none"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border)",
              top: "10px",
              right: "10px",
            }}
          >
            <div
              className="font-medium text-sm"
              style={{ color: "var(--color-text-primary)" }}
            >
              {hoveredEvent.title}
            </div>
            <div
              className="text-xs mt-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              {d3.timeFormat("%B %d, %Y")(new Date(hoveredEvent.date))}
            </div>
          </div>
        )}
      </div>

      {/* Selected event details */}
      {selectedEvent && (
        <div
          className="mt-4 p-4 rounded-lg"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderLeft: `3px solid ${colorScale(selectedEvent.category || "default")}`,
          }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div
                className="font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {selectedEvent.title}
              </div>
              <div
                className="text-xs mt-1"
                style={{ color: "var(--color-accent)" }}
              >
                {d3.timeFormat("%B %d, %Y")(new Date(selectedEvent.date))}
              </div>
            </div>
            <button
              onClick={() => setSelectedEvent(null)}
              className="p-1 rounded hover:bg-[--color-bg-secondary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <p
            className="text-sm mt-2"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {selectedEvent.description}
          </p>
          {selectedEvent.category && (
            <span
              className="inline-block mt-2 text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: `${colorScale(selectedEvent.category)}20`,
                color: colorScale(selectedEvent.category),
              }}
            >
              {selectedEvent.category}
            </span>
          )}
          {onNavigateToPage && (
            <button
              onClick={() => handleNavigateToPage(selectedEvent.sourcePageId)}
              className="mt-3 text-xs flex items-center gap-1 hover:underline"
              style={{ color: "var(--color-accent)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              View source page
            </button>
          )}
        </div>
      )}

      {/* Instructions */}
      <div
        className="mt-3 text-xs text-center"
        style={{ color: "var(--color-text-muted)" }}
      >
        Scroll to zoom | Click event for details
      </div>
    </div>
  );
}
