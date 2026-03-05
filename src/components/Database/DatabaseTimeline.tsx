import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as d3 from "d3";
import type {
  DatabaseContentV2,
  DatabaseView,
  TimelineViewConfig,
  DatabaseRow,
} from "../../types/database";
import { applyFilter, compareCellValues } from "./DatabaseTable";
import type { RelationContext } from "./useRelationContext";

interface DatabaseTimelineProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
  relationContext?: RelationContext;
}

interface TimelineRow {
  id: string;
  label: string;
  startDate: Date;
  endDate: Date | null;
  color: string;
  row: DatabaseRow;
}

const DEFAULT_COLORS = [
  "#8b5cf6", "#3b82f6", "#22c55e", "#f97316", "#ef4444",
  "#06b6d4", "#eab308", "#ec4899", "#a855f7", "#6b7280",
];

const BAR_HEIGHT = 28;
const ROW_HEIGHT = 38;
const MIN_BAR_WIDTH = 6;

export function DatabaseTimeline({
  content,
  view,
  onUpdateView,
}: DatabaseTimelineProps) {
  const config = view.config as TimelineViewConfig;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: Math.max(200, entry.contentRect.height),
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Resolve properties
  const startDateProp = content.properties.find(
    (p) => p.id === config.startDatePropertyId
  );
  const endDateProp = config.endDatePropertyId
    ? content.properties.find((p) => p.id === config.endDatePropertyId)
    : undefined;
  const labelProp = config.labelPropertyId
    ? content.properties.find((p) => p.id === config.labelPropertyId)
    : content.properties.find((p) => p.type === "text");
  const colorProp = config.colorPropertyId
    ? content.properties.find((p) => p.id === config.colorPropertyId)
    : undefined;

  // Build color map from select options
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (colorProp?.options) {
      for (const opt of colorProp.options) {
        map.set(opt.id, opt.color);
        map.set(opt.label, opt.color);
      }
    }
    return map;
  }, [colorProp]);

  // Filter and sort rows, then build timeline data
  const timelineData = useMemo((): TimelineRow[] => {
    if (!startDateProp) return [];

    let rows = [...content.rows];

    // Apply filters
    for (const filter of view.filters) {
      const prop = content.properties.find((p) => p.id === filter.propertyId);
      if (!prop) continue;
      rows = rows.filter((row) => {
        const cellVal = row.cells[filter.propertyId] ?? null;
        return applyFilter(cellVal, filter.operator, filter.value, prop);
      });
    }

    // Apply sorts
    if (view.sorts.length > 0) {
      rows.sort((a, b) => {
        for (const sort of view.sorts) {
          const aVal = a.cells[sort.propertyId] ?? null;
          const bVal = b.cells[sort.propertyId] ?? null;
          const cmp = compareCellValues(aVal, bVal);
          if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }

    // Build timeline rows
    const result: TimelineRow[] = [];
    for (const row of rows) {
      const startVal = row.cells[config.startDatePropertyId];
      if (!startVal || typeof startVal !== "string") continue;

      const startDate = new Date(startVal);
      if (isNaN(startDate.getTime())) continue;

      let endDate: Date | null = null;
      if (endDateProp && config.endDatePropertyId) {
        const endVal = row.cells[config.endDatePropertyId];
        if (endVal && typeof endVal === "string") {
          const d = new Date(endVal);
          if (!isNaN(d.getTime())) endDate = d;
        }
      }

      // Resolve label
      let label = row.id.slice(0, 8);
      if (labelProp) {
        const labelVal = row.cells[labelProp.id];
        if (labelVal != null) {
          if (labelProp.type === "select") {
            const opt = labelProp.options?.find((o) => o.id === labelVal);
            label = opt?.label ?? String(labelVal);
          } else {
            label = String(labelVal);
          }
        }
      }

      // Resolve color
      let color = DEFAULT_COLORS[result.length % DEFAULT_COLORS.length];
      if (colorProp && config.colorPropertyId) {
        const colorVal = row.cells[config.colorPropertyId];
        if (colorVal && typeof colorVal === "string") {
          const mapped = colorMap.get(colorVal);
          if (mapped) color = mapped;
        }
      }

      result.push({ id: row.id, label, startDate, endDate, color, row });
    }

    return result;
  }, [
    content.rows,
    content.properties,
    view.filters,
    view.sorts,
    config,
    startDateProp,
    endDateProp,
    labelProp,
    colorProp,
    colorMap,
  ]);

  // Tooltip helpers
  const showTooltip = useCallback(
    (e: MouseEvent, text: string) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      tip.textContent = text;
      tip.style.display = "block";
      tip.style.left = `${e.offsetX + 12}px`;
      tip.style.top = `${e.offsetY - 8}px`;
    },
    []
  );

  const hideTooltip = useCallback(() => {
    const tip = tooltipRef.current;
    if (tip) tip.style.display = "none";
  }, []);

  // D3 render
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || timelineData.length === 0) {
      if (svg) d3.select(svg).selectAll("*").remove();
      return;
    }

    d3.select(svg).selectAll("*").remove();

    const { width } = dimensions;
    const margin = { top: 30, right: 20, bottom: 20, left: 160 };
    const innerW = width - margin.left - margin.right;
    const innerH = timelineData.length * ROW_HEIGHT;
    const totalHeight = innerH + margin.top + margin.bottom;

    // Set SVG height dynamically
    d3.select(svg).attr("height", totalHeight);

    // Date extent with padding
    let minDate = d3.min(timelineData, (d) => d.startDate)!;
    let maxDate = d3.max(timelineData, (d) => d.endDate ?? d.startDate)!;
    const today = new Date();

    // Include today in extent if showToday is on
    if (config.showToday !== false) {
      if (today < minDate) minDate = today;
      if (today > maxDate) maxDate = today;
    }

    // Add padding (5% on each side, minimum 1 day)
    const range = maxDate.getTime() - minDate.getTime();
    const padding = Math.max(range * 0.05, 86400000);
    const dateStart = new Date(minDate.getTime() - padding);
    const dateEnd = new Date(maxDate.getTime() + padding);

    // Scales
    const x = d3.scaleTime().domain([dateStart, dateEnd]).range([0, innerW]);
    const y = d3
      .scaleBand()
      .domain(timelineData.map((d) => d.id))
      .range([0, innerH])
      .padding(0.15);

    const root = d3.select(svg);
    const g = root
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Grid lines (vertical)
    const tickValues = x.ticks(d3.timeWeek.every(1) as d3.TimeInterval);
    g.append("g")
      .attr("class", "grid")
      .selectAll("line")
      .data(tickValues)
      .enter()
      .append("line")
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "var(--color-border)")
      .attr("stroke-opacity", 0.3);

    // Horizontal row separators
    g.selectAll(".row-sep")
      .data(timelineData)
      .enter()
      .append("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", (d) => (y(d.id) ?? 0) + y.bandwidth())
      .attr("y2", (d) => (y(d.id) ?? 0) + y.bandwidth())
      .attr("stroke", "var(--color-border)")
      .attr("stroke-opacity", 0.15);

    // X axis (top)
    g.append("g")
      .call(
        d3
          .axisTop(x)
          .ticks(d3.timeWeek.every(1) as d3.TimeInterval)
          .tickFormat((d) => d3.timeFormat("%b %d")(d as Date))
      )
      .selectAll("text")
      .attr("fill", "var(--color-text-secondary)")
      .style("font-size", "10px");
    g.selectAll(".domain").attr("stroke", "var(--color-border)");
    g.selectAll(".tick line").attr("stroke", "var(--color-border)");

    // Row labels (left side)
    const labelGroup = root
      .append("g")
      .attr("transform", `translate(0,${margin.top})`);

    labelGroup
      .selectAll(".row-label")
      .data(timelineData)
      .enter()
      .append("text")
      .attr("x", margin.left - 8)
      .attr("y", (d) => (y(d.id) ?? 0) + y.bandwidth() / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("fill", "var(--color-text-primary)")
      .style("font-size", "12px")
      .text((d) => {
        const maxLen = 20;
        return d.label.length > maxLen
          ? d.label.slice(0, maxLen - 1) + "\u2026"
          : d.label;
      });

    // Duration bars
    g.selectAll(".timeline-bar")
      .data(timelineData.filter((d) => d.endDate != null))
      .enter()
      .append("rect")
      .attr("class", "timeline-bar")
      .attr("x", (d) => x(d.startDate))
      .attr("y", (d) => {
        const bandY = y(d.id) ?? 0;
        return bandY + (y.bandwidth() - BAR_HEIGHT) / 2;
      })
      .attr("width", (d) => Math.max(MIN_BAR_WIDTH, x(d.endDate!) - x(d.startDate)))
      .attr("height", BAR_HEIGHT)
      .attr("fill", (d) => d.color)
      .attr("rx", 4)
      .attr("opacity", 0.85)
      .style("cursor", "pointer")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("opacity", 1);
        const start = d3.timeFormat("%b %d, %Y")(d.startDate);
        const end = d.endDate ? d3.timeFormat("%b %d, %Y")(d.endDate) : "";
        showTooltip(event, `${d.label}\n${start} \u2192 ${end}`);
      })
      .on("mousemove", function (event, d) {
        const start = d3.timeFormat("%b %d, %Y")(d.startDate);
        const end = d.endDate ? d3.timeFormat("%b %d, %Y")(d.endDate) : "";
        showTooltip(event, `${d.label}\n${start} \u2192 ${end}`);
      })
      .on("mouseout", function () {
        d3.select(this).attr("opacity", 0.85);
        hideTooltip();
      });

    // Bar labels (inside bars if wide enough)
    g.selectAll(".bar-label")
      .data(timelineData.filter((d) => d.endDate != null))
      .enter()
      .append("text")
      .attr("class", "bar-label")
      .attr("x", (d) => {
        const barW = Math.max(MIN_BAR_WIDTH, x(d.endDate!) - x(d.startDate));
        return x(d.startDate) + barW / 2;
      })
      .attr("y", (d) => {
        const bandY = y(d.id) ?? 0;
        return bandY + y.bandwidth() / 2;
      })
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "#fff")
      .style("font-size", "11px")
      .style("pointer-events", "none")
      .text((d) => {
        const barW = Math.max(MIN_BAR_WIDTH, x(d.endDate!) - x(d.startDate));
        if (barW < 40) return "";
        const maxLen = Math.floor(barW / 7);
        return d.label.length > maxLen
          ? d.label.slice(0, maxLen - 1) + "\u2026"
          : d.label;
      });

    // Point events (diamond markers for rows without end date)
    const pointData = timelineData.filter((d) => d.endDate == null);
    g.selectAll(".timeline-point")
      .data(pointData)
      .enter()
      .append("path")
      .attr("class", "timeline-point")
      .attr("d", d3.symbol().type(d3.symbolDiamond).size(180)())
      .attr("transform", (d) => {
        const cx = x(d.startDate);
        const cy = (y(d.id) ?? 0) + y.bandwidth() / 2;
        return `translate(${cx},${cy})`;
      })
      .attr("fill", (d) => d.color)
      .attr("stroke", "var(--color-bg-primary)")
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("transform", () => {
          const cx = x(d.startDate);
          const cy = (y(d.id) ?? 0) + y.bandwidth() / 2;
          return `translate(${cx},${cy}) scale(1.3)`;
        });
        const date = d3.timeFormat("%b %d, %Y")(d.startDate);
        showTooltip(event, `${d.label}\n${date}`);
      })
      .on("mousemove", function (event, d) {
        const date = d3.timeFormat("%b %d, %Y")(d.startDate);
        showTooltip(event, `${d.label}\n${date}`);
      })
      .on("mouseout", function (_event, d) {
        d3.select(this).attr("transform", () => {
          const cx = x(d.startDate);
          const cy = (y(d.id) ?? 0) + y.bandwidth() / 2;
          return `translate(${cx},${cy})`;
        });
        hideTooltip();
      });

    // Today marker
    if (config.showToday !== false) {
      const todayX = x(today);
      if (todayX >= 0 && todayX <= innerW) {
        g.append("line")
          .attr("x1", todayX)
          .attr("x2", todayX)
          .attr("y1", -margin.top + 5)
          .attr("y2", innerH)
          .attr("stroke", "#ef4444")
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "4,3");

        g.append("text")
          .attr("x", todayX)
          .attr("y", -margin.top + 12)
          .attr("text-anchor", "middle")
          .attr("fill", "#ef4444")
          .style("font-size", "9px")
          .style("font-weight", "600")
          .text("Today");
      }
    }
  }, [timelineData, dimensions, config, showTooltip, hideTooltip]);

  // Config update helper
  const updateConfig = useCallback(
    (patch: Partial<TimelineViewConfig>) => {
      onUpdateView((prev) => ({
        ...prev,
        config: { ...prev.config, ...patch },
      }));
    },
    [onUpdateView]
  );

  const dateProperties = content.properties.filter((p) => p.type === "date");
  const textProperties = content.properties.filter((p) => p.type === "text");
  const selectProperties = content.properties.filter(
    (p) => p.type === "select"
  );

  const chartHeight = Math.max(
    200,
    timelineData.length * ROW_HEIGHT + 50
  );

  return (
    <div className="db-chart-wrapper">
      {/* Config bar */}
      <div className="db-chart-config">
        <div className="db-chart-config-group">
          <label className="db-chart-config-label">Start Date</label>
          <select
            className="db-chart-config-select"
            value={config.startDatePropertyId}
            onChange={(e) =>
              updateConfig({ startDatePropertyId: e.target.value })
            }
          >
            {dateProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="db-chart-config-group">
          <label className="db-chart-config-label">End Date</label>
          <select
            className="db-chart-config-select"
            value={config.endDatePropertyId ?? ""}
            onChange={(e) =>
              updateConfig({
                endDatePropertyId: e.target.value || undefined,
              })
            }
          >
            <option value="">None (point events)</option>
            {dateProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {textProperties.length > 0 && (
          <div className="db-chart-config-group">
            <label className="db-chart-config-label">Label</label>
            <select
              className="db-chart-config-select"
              value={config.labelPropertyId ?? ""}
              onChange={(e) =>
                updateConfig({
                  labelPropertyId: e.target.value || undefined,
                })
              }
            >
              <option value="">Auto</option>
              {textProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectProperties.length > 0 && (
          <div className="db-chart-config-group">
            <label className="db-chart-config-label">Color by</label>
            <select
              className="db-chart-config-select"
              value={config.colorPropertyId ?? ""}
              onChange={(e) =>
                updateConfig({
                  colorPropertyId: e.target.value || undefined,
                })
              }
            >
              <option value="">Default</option>
              {selectProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="db-chart-config-group">
          <label className="db-chart-config-label">
            <input
              type="checkbox"
              checked={config.showToday !== false}
              onChange={(e) => updateConfig({ showToday: e.target.checked })}
              style={{ marginRight: 4 }}
            />
            Today marker
          </label>
        </div>
      </div>

      {/* Timeline area */}
      <div
        className="db-chart-container"
        ref={containerRef}
        style={{ minHeight: chartHeight }}
      >
        {timelineData.length === 0 ? (
          <div className="db-chart-empty">
            {!startDateProp
              ? "Select a start date property to display the timeline."
              : "No rows with valid dates. Add rows with date values to see the timeline."}
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              width={dimensions.width}
              height={chartHeight}
            />
            <div ref={tooltipRef} className="db-chart-tooltip" />
          </>
        )}
      </div>
    </div>
  );
}
