import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as d3 from "d3";
import type {
  DatabaseContentV2,
  DatabaseView,
  PropertyDef,
  ChartViewConfig,
  ChartType,
  ChartAggregation,
  CellValue,
} from "../../types/database";
import { applyFilter, compareCellValues } from "./DatabaseTable";

interface DatabaseChartProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
}

interface AggregatedDatum {
  label: string;
  value: number;
  color?: string;
}

const CHART_COLORS = [
  "#8b5cf6", "#3b82f6", "#22c55e", "#f97316", "#ef4444",
  "#06b6d4", "#eab308", "#ec4899", "#a855f7", "#6b7280",
  "#14b8a6", "#f43f5e", "#84cc16", "#0ea5e9", "#d946ef",
];

const AGGREGATION_LABELS: Record<ChartAggregation, string> = {
  count: "Count",
  sum: "Sum",
  average: "Average",
  min: "Min",
  max: "Max",
};

export function DatabaseChart({ content, view, onUpdateView }: DatabaseChartProps) {
  const config = view.config as ChartViewConfig;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: Math.max(300, entry.contentRect.height),
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Apply view filters to rows
  const filteredRows = useMemo(() => {
    let rows = [...content.rows];
    for (const filter of view.filters) {
      const prop = content.properties.find((p) => p.id === filter.propertyId);
      if (!prop) continue;
      rows = rows.filter((row) => {
        const cellVal = row.cells[filter.propertyId] ?? null;
        return applyFilter(cellVal, filter.operator, filter.value, prop);
      });
    }
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
    return rows;
  }, [content.rows, content.properties, view.filters, view.sorts]);

  // Resolve property references
  const xProp = content.properties.find((p) => p.id === config.xAxisPropertyId);
  const yProp = config.yAxisPropertyId
    ? content.properties.find((p) => p.id === config.yAxisPropertyId)
    : undefined;
  const colorProp = config.colorPropertyId
    ? content.properties.find((p) => p.id === config.colorPropertyId)
    : undefined;

  // Resolve cell label (for select/multiSelect, return option label)
  const resolveLabel = useCallback(
    (val: CellValue, prop: PropertyDef): string => {
      if (val == null) return "(empty)";
      if (prop.type === "select") {
        const opt = prop.options?.find((o) => o.id === val);
        return opt?.label ?? String(val);
      }
      if (prop.type === "multiSelect" && Array.isArray(val)) {
        return val
          .map((id) => prop.options?.find((o) => o.id === id)?.label ?? id)
          .join(", ") || "(empty)";
      }
      if (prop.type === "date" && typeof val === "string") {
        return val.slice(0, 10); // YYYY-MM-DD
      }
      return String(val) || "(empty)";
    },
    []
  );

  // Build color map from select options
  const optionColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (xProp?.options) {
      for (const opt of xProp.options) {
        map.set(opt.label, opt.color);
        map.set(opt.id, opt.color);
      }
    }
    if (colorProp?.options) {
      for (const opt of colorProp.options) {
        map.set(opt.label, opt.color);
        map.set(opt.id, opt.color);
      }
    }
    return map;
  }, [xProp, colorProp]);

  // Aggregate data
  const chartData = useMemo((): AggregatedDatum[] => {
    if (!xProp) return [];

    // Group rows by x-axis value
    const groups = new Map<string, number[]>();
    for (const row of filteredRows) {
      const xVal = row.cells[config.xAxisPropertyId] ?? null;
      const label = resolveLabel(xVal, xProp);

      // For multiSelect, split into separate groups
      if (xProp.type === "multiSelect" && Array.isArray(xVal)) {
        const labels = xVal.length > 0
          ? xVal.map((id) => xProp.options?.find((o) => o.id === id)?.label ?? id)
          : ["(empty)"];
        for (const l of labels) {
          if (!groups.has(l)) groups.set(l, []);
          if (yProp) {
            const yVal = row.cells[config.yAxisPropertyId!];
            if (yVal != null && typeof yVal === "number") {
              groups.get(l)!.push(yVal);
            } else if (yVal != null) {
              const n = Number(yVal);
              if (!isNaN(n)) groups.get(l)!.push(n);
            }
          } else {
            groups.get(l)!.push(1);
          }
        }
      } else {
        if (!groups.has(label)) groups.set(label, []);
        if (yProp) {
          const yVal = row.cells[config.yAxisPropertyId!];
          if (yVal != null && typeof yVal === "number") {
            groups.get(label)!.push(yVal);
          } else if (yVal != null) {
            const n = Number(yVal);
            if (!isNaN(n)) groups.get(label)!.push(n);
          }
        } else {
          groups.get(label)!.push(1);
        }
      }
    }

    // Apply aggregation
    const agg = config.aggregation;
    const data: AggregatedDatum[] = [];
    for (const [label, values] of groups) {
      let aggValue: number;
      switch (agg) {
        case "count":
          aggValue = values.length;
          break;
        case "sum":
          aggValue = values.reduce((a, b) => a + b, 0);
          break;
        case "average":
          aggValue = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          break;
        case "min":
          aggValue = values.length > 0 ? Math.min(...values) : 0;
          break;
        case "max":
          aggValue = values.length > 0 ? Math.max(...values) : 0;
          break;
        default:
          aggValue = values.length;
      }
      data.push({
        label,
        value: aggValue,
        color: optionColorMap.get(label),
      });
    }

    return data;
  }, [filteredRows, xProp, yProp, config, resolveLabel, optionColorMap]);

  // Get color for a datum
  const getColor = useCallback(
    (d: AggregatedDatum, i: number): string => {
      if (d.color) return d.color;
      return CHART_COLORS[i % CHART_COLORS.length];
    },
    []
  );

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
    if (!svg || chartData.length === 0) {
      if (svg) d3.select(svg).selectAll("*").remove();
      return;
    }

    d3.select(svg).selectAll("*").remove();

    const { width, height } = dimensions;
    const margin = { top: 20, right: 20, bottom: 50, left: 60 };

    if (config.chartType === "pie") {
      renderPieChart(svg, chartData, width, height, getColor, showTooltip, hideTooltip);
    } else if (config.chartType === "line") {
      renderLineChart(svg, chartData, width, height, margin, xProp, yProp, config, getColor, showTooltip, hideTooltip);
    } else {
      renderBarChart(svg, chartData, width, height, margin, xProp, yProp, config, getColor, showTooltip, hideTooltip);
    }
  }, [chartData, dimensions, config.chartType, xProp, yProp, config, getColor, showTooltip, hideTooltip]);

  // Config update helpers
  const updateConfig = useCallback(
    (patch: Partial<ChartViewConfig>) => {
      onUpdateView((prev) => ({
        ...prev,
        config: { ...prev.config, ...patch },
      }));
    },
    [onUpdateView]
  );

  const numberProperties = content.properties.filter((p) => p.type === "number");
  const selectProperties = content.properties.filter(
    (p) => p.type === "select" || p.type === "multiSelect"
  );

  return (
    <div className="db-chart-wrapper">
      {/* Config bar */}
      <div className="db-chart-config">
        <div className="db-chart-config-group">
          <label className="db-chart-config-label">Chart</label>
          <div className="db-chart-type-btns">
            {(["bar", "line", "pie"] as ChartType[]).map((ct) => (
              <button
                key={ct}
                className={`db-chart-type-btn ${config.chartType === ct ? "db-chart-type-btn-active" : ""}`}
                onClick={() => updateConfig({ chartType: ct })}
                title={ct.charAt(0).toUpperCase() + ct.slice(1)}
              >
                <ChartTypeIcon type={ct} />
              </button>
            ))}
          </div>
        </div>

        <div className="db-chart-config-group">
          <label className="db-chart-config-label">X Axis</label>
          <select
            className="db-chart-config-select"
            value={config.xAxisPropertyId}
            onChange={(e) => updateConfig({ xAxisPropertyId: e.target.value })}
          >
            {content.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="db-chart-config-group">
          <label className="db-chart-config-label">Y Axis</label>
          <select
            className="db-chart-config-select"
            value={config.yAxisPropertyId ?? ""}
            onChange={(e) =>
              updateConfig({ yAxisPropertyId: e.target.value || undefined })
            }
          >
            <option value="">Count</option>
            {numberProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {config.yAxisPropertyId && (
          <div className="db-chart-config-group">
            <label className="db-chart-config-label">Aggregation</label>
            <select
              className="db-chart-config-select"
              value={config.aggregation}
              onChange={(e) =>
                updateConfig({ aggregation: e.target.value as ChartAggregation })
              }
            >
              {(Object.keys(AGGREGATION_LABELS) as ChartAggregation[]).map((a) => (
                <option key={a} value={a}>
                  {AGGREGATION_LABELS[a]}
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
                updateConfig({ colorPropertyId: e.target.value || undefined })
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
      </div>

      {/* Chart area */}
      <div className="db-chart-container" ref={containerRef}>
        {chartData.length === 0 ? (
          <div className="db-chart-empty">
            No data to display. Add rows or adjust chart configuration.
          </div>
        ) : (
          <>
            <svg ref={svgRef} width={dimensions.width} height={dimensions.height} />
            <div ref={tooltipRef} className="db-chart-tooltip" />
          </>
        )}
      </div>
    </div>
  );
}

// --- D3 Rendering Functions ---

function renderBarChart(
  svg: SVGSVGElement,
  data: AggregatedDatum[],
  width: number,
  height: number,
  margin: { top: number; right: number; bottom: number; left: number },
  xProp: PropertyDef | undefined,
  yProp: PropertyDef | undefined,
  config: ChartViewConfig,
  getColor: (d: AggregatedDatum, i: number) => string,
  showTooltip: (e: MouseEvent, text: string) => void,
  hideTooltip: () => void
) {
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.label))
    .range([0, innerW])
    .padding(0.2);

  const maxVal = d3.max(data, (d) => d.value) ?? 0;
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([innerH, 0]);

  const root = d3.select(svg);
  const g = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // X axis
  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("fill", "var(--color-text-secondary)")
    .style("font-size", "11px")
    .attr("transform", data.length > 8 ? "rotate(-40)" : "")
    .style("text-anchor", data.length > 8 ? "end" : "middle");

  // Y axis
  g.append("g")
    .call(d3.axisLeft(y).ticks(6))
    .selectAll("text")
    .attr("fill", "var(--color-text-secondary)")
    .style("font-size", "11px");

  // Axis lines
  g.selectAll(".domain").attr("stroke", "var(--color-border)");
  g.selectAll(".tick line").attr("stroke", "var(--color-border)");

  // Grid lines
  g.append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat(() => ""))
    .selectAll("line")
    .attr("stroke", "var(--color-border)")
    .attr("stroke-opacity", 0.3);
  g.select(".grid .domain").remove();

  // Axis labels
  if (xProp) {
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + margin.bottom - 4)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-muted)")
      .style("font-size", "11px")
      .text(xProp.name);
  }

  const yLabel = yProp ? `${AGGREGATION_LABELS[config.aggregation]} of ${yProp.name}` : "Count";
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -margin.left + 14)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--color-text-muted)")
    .style("font-size", "11px")
    .text(yLabel);

  // Bars
  g.selectAll(".bar")
    .data(data)
    .enter()
    .append("rect")
    .attr("class", "bar")
    .attr("x", (d) => x(d.label) ?? 0)
    .attr("y", (d) => y(d.value))
    .attr("width", x.bandwidth())
    .attr("height", (d) => innerH - y(d.value))
    .attr("fill", (d, i) => getColor(d, i))
    .attr("rx", 3)
    .style("cursor", "pointer")
    .on("mouseover", function (event, d) {
      d3.select(this).attr("opacity", 0.8);
      showTooltip(event, `${d.label}: ${formatValue(d.value)}`);
    })
    .on("mousemove", function (event, d) {
      showTooltip(event, `${d.label}: ${formatValue(d.value)}`);
    })
    .on("mouseout", function () {
      d3.select(this).attr("opacity", 1);
      hideTooltip();
    });
}

function renderLineChart(
  svg: SVGSVGElement,
  data: AggregatedDatum[],
  width: number,
  height: number,
  margin: { top: number; right: number; bottom: number; left: number },
  xProp: PropertyDef | undefined,
  yProp: PropertyDef | undefined,
  config: ChartViewConfig,
  getColor: (d: AggregatedDatum, i: number) => string,
  showTooltip: (e: MouseEvent, text: string) => void,
  hideTooltip: () => void
) {
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const x = d3
    .scalePoint()
    .domain(data.map((d) => d.label))
    .range([0, innerW])
    .padding(0.5);

  const maxVal = d3.max(data, (d) => d.value) ?? 0;
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([innerH, 0]);

  const root = d3.select(svg);
  const g = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // X axis
  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("fill", "var(--color-text-secondary)")
    .style("font-size", "11px")
    .attr("transform", data.length > 8 ? "rotate(-40)" : "")
    .style("text-anchor", data.length > 8 ? "end" : "middle");

  // Y axis
  g.append("g")
    .call(d3.axisLeft(y).ticks(6))
    .selectAll("text")
    .attr("fill", "var(--color-text-secondary)")
    .style("font-size", "11px");

  // Axis lines
  g.selectAll(".domain").attr("stroke", "var(--color-border)");
  g.selectAll(".tick line").attr("stroke", "var(--color-border)");

  // Grid
  g.append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat(() => ""))
    .selectAll("line")
    .attr("stroke", "var(--color-border)")
    .attr("stroke-opacity", 0.3);
  g.select(".grid .domain").remove();

  // Axis labels
  if (xProp) {
    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + margin.bottom - 4)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-muted)")
      .style("font-size", "11px")
      .text(xProp.name);
  }
  const yLabel = yProp ? `${AGGREGATION_LABELS[config.aggregation]} of ${yProp.name}` : "Count";
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -margin.left + 14)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--color-text-muted)")
    .style("font-size", "11px")
    .text(yLabel);

  const lineColor = getColor(data[0], 0);

  // Line
  const line = d3
    .line<AggregatedDatum>()
    .x((d) => x(d.label) ?? 0)
    .y((d) => y(d.value))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", lineColor)
    .attr("stroke-width", 2.5)
    .attr("d", line);

  // Area fill
  const area = d3
    .area<AggregatedDatum>()
    .x((d) => x(d.label) ?? 0)
    .y0(innerH)
    .y1((d) => y(d.value))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(data)
    .attr("fill", lineColor)
    .attr("fill-opacity", 0.08)
    .attr("d", area);

  // Data points
  g.selectAll(".dot")
    .data(data)
    .enter()
    .append("circle")
    .attr("class", "dot")
    .attr("cx", (d) => x(d.label) ?? 0)
    .attr("cy", (d) => y(d.value))
    .attr("r", 4.5)
    .attr("fill", lineColor)
    .attr("stroke", "var(--color-bg-primary)")
    .attr("stroke-width", 2)
    .style("cursor", "pointer")
    .on("mouseover", function (event, d) {
      d3.select(this).attr("r", 6);
      showTooltip(event, `${d.label}: ${formatValue(d.value)}`);
    })
    .on("mousemove", function (event, d) {
      showTooltip(event, `${d.label}: ${formatValue(d.value)}`);
    })
    .on("mouseout", function () {
      d3.select(this).attr("r", 4.5);
      hideTooltip();
    });
}

function renderPieChart(
  svg: SVGSVGElement,
  data: AggregatedDatum[],
  width: number,
  height: number,
  getColor: (d: AggregatedDatum, i: number) => string,
  showTooltip: (e: MouseEvent, text: string) => void,
  hideTooltip: () => void
) {
  const total = d3.sum(data, (d) => d.value);
  if (total === 0) return;

  // Leave space for legend on the right
  const legendWidth = Math.min(180, width * 0.3);
  const chartWidth = width - legendWidth;
  const radius = Math.min(chartWidth, height) / 2 - 20;
  const innerRadius = radius * 0.5; // donut

  const root = d3.select(svg);
  const g = root
    .append("g")
    .attr("transform", `translate(${chartWidth / 2},${height / 2})`);

  const pie = d3
    .pie<AggregatedDatum>()
    .value((d) => d.value)
    .sort(null);

  const arc = d3.arc<d3.PieArcDatum<AggregatedDatum>>()
    .innerRadius(innerRadius)
    .outerRadius(radius);

  const arcHover = d3.arc<d3.PieArcDatum<AggregatedDatum>>()
    .innerRadius(innerRadius)
    .outerRadius(radius + 6);

  const arcs = g
    .selectAll(".arc")
    .data(pie(data))
    .enter()
    .append("g")
    .attr("class", "arc");

  arcs
    .append("path")
    .attr("d", arc)
    .attr("fill", (d, i) => getColor(d.data, i))
    .attr("stroke", "var(--color-bg-primary)")
    .attr("stroke-width", 2)
    .style("cursor", "pointer")
    .on("mouseover", function (event, d) {
      d3.select(this).transition().duration(100).attr("d", arcHover(d)!);
      const pct = ((d.data.value / total) * 100).toFixed(1);
      showTooltip(event, `${d.data.label}: ${formatValue(d.data.value)} (${pct}%)`);
    })
    .on("mousemove", function (event, d) {
      const pct = ((d.data.value / total) * 100).toFixed(1);
      showTooltip(event, `${d.data.label}: ${formatValue(d.data.value)} (${pct}%)`);
    })
    .on("mouseout", function (_event, d) {
      d3.select(this).transition().duration(100).attr("d", arc(d)!);
      hideTooltip();
    });

  // Legend
  const legend = root
    .append("g")
    .attr("transform", `translate(${chartWidth + 8}, 20)`);

  data.forEach((d, i) => {
    const row = legend.append("g").attr("transform", `translate(0, ${i * 22})`);
    row
      .append("rect")
      .attr("width", 12)
      .attr("height", 12)
      .attr("rx", 2)
      .attr("fill", getColor(d, i));
    row
      .append("text")
      .attr("x", 18)
      .attr("y", 10)
      .attr("fill", "var(--color-text-secondary)")
      .style("font-size", "11px")
      .text(`${d.label} (${formatValue(d.value)})`);
  });
}

function formatValue(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Chart type icons
function ChartTypeIcon({ type }: { type: ChartType }) {
  switch (type) {
    case "bar":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="12" width="4" height="9" rx="1" />
          <rect x="10" y="5" width="4" height="16" rx="1" />
          <rect x="17" y="8" width="4" height="13" rx="1" />
        </svg>
      );
    case "line":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18 8 11 14 15 21 6" />
          <circle cx="8" cy="11" r="1.5" fill="currentColor" />
          <circle cx="14" cy="15" r="1.5" fill="currentColor" />
          <circle cx="21" cy="6" r="1.5" fill="currentColor" />
        </svg>
      );
    case "pie":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
          <path d="M22 12A10 10 0 0 0 12 2v10z" />
        </svg>
      );
  }
}
