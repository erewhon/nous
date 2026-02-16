import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as d3 from "d3";
import { useEnergyStore } from "../../stores/energyStore";
import { useMoodHabitStore } from "../../stores/moodHabitStore";

interface MoodHabitEntry {
  date: string;
  mood: number;
  habits: Record<string, boolean>;
}

const MOOD_EMOJIS = ["", "\u{1F614}", "\u{1F615}", "\u{1F610}", "\u{1F642}", "\u{1F60A}"];
const MOOD_COLORS = ["", "#ef4444", "#f59e0b", "#a1a1aa", "#22c55e", "#10b981"];

interface MoodHabitChartProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MoodHabitChart({ isOpen, onClose }: MoodHabitChartProps) {
  const { checkIns, loadCheckInsRange } = useEnergyStore();
  const { habitList } = useMoodHabitStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dateRange, setDateRange] = useState<"7d" | "14d" | "30d">("14d");

  // Load check-ins when chart opens
  useEffect(() => {
    if (isOpen) {
      const days = dateRange === "7d" ? 7 : dateRange === "14d" ? 14 : 30;
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);
      loadCheckInsRange(
        start.toISOString().split("T")[0],
        end.toISOString().split("T")[0]
      );
    }
  }, [isOpen, dateRange, loadCheckInsRange]);

  // Build MoodHabitEntry[] from checkIns map
  const entries = useMemo((): MoodHabitEntry[] => {
    const results: MoodHabitEntry[] = [];

    for (const [date, checkIn] of checkIns) {
      const habitsMap: Record<string, boolean> = {};
      if (checkIn.habits) {
        for (const h of checkIn.habits) {
          habitsMap[h.name] = h.checked;
        }
      }

      results.push({
        date,
        mood: checkIn.mood ?? 0,
        habits: habitsMap,
      });
    }

    return results.sort((a, b) => a.date.localeCompare(b.date));
  }, [checkIns]);

  // Filter by date range
  const filteredEntries = useMemo(() => {
    const days = dateRange === "7d" ? 7 : dateRange === "14d" ? 14 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    return entries.filter((e) => e.date >= cutoffStr);
  }, [entries, dateRange]);

  // Draw mood line chart
  const drawChart = useCallback(() => {
    if (!svgRef.current || filteredEntries.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 280;
    const height = 120;
    const margin = { top: 10, right: 10, bottom: 20, left: 30 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const moodEntries = filteredEntries.filter((e) => e.mood > 0);
    if (moodEntries.length === 0) return;

    const xScale = d3
      .scaleTime()
      .domain(d3.extent(moodEntries, (d) => new Date(d.date)) as [Date, Date])
      .range([0, innerWidth]);

    const yScale = d3.scaleLinear().domain([1, 5]).range([innerHeight, 0]);

    // Axes
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat("%m/%d") as unknown as (domainValue: d3.NumberValue, index: number) => string))
      .selectAll("text")
      .style("fill", "var(--color-text-muted)")
      .style("font-size", "9px");

    g.append("g")
      .call(
        d3
          .axisLeft(yScale)
          .ticks(5)
          .tickFormat((d) => MOOD_EMOJIS[d as number] || "")
      )
      .selectAll("text")
      .style("font-size", "12px");

    // Style axis lines
    g.selectAll(".domain, .tick line").style("stroke", "var(--color-border)");

    // Line
    const line = d3
      .line<MoodHabitEntry>()
      .x((d) => xScale(new Date(d.date)))
      .y((d) => yScale(d.mood))
      .curve(d3.curveMonotoneX);

    g.append("path")
      .datum(moodEntries)
      .attr("fill", "none")
      .attr("stroke", "var(--color-accent)")
      .attr("stroke-width", 2)
      .attr("d", line);

    // Dots
    g.selectAll(".mood-dot")
      .data(moodEntries)
      .enter()
      .append("circle")
      .attr("cx", (d) => xScale(new Date(d.date)))
      .attr("cy", (d) => yScale(d.mood))
      .attr("r", 4)
      .attr("fill", (d) => MOOD_COLORS[d.mood])
      .attr("stroke", "var(--color-bg-primary)")
      .attr("stroke-width", 2);
  }, [filteredEntries]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        role="dialog"
        className="relative z-10 w-full max-w-md rounded-xl border p-6 shadow-xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Mood & Habits
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
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
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Date range selector */}
        <div className="flex gap-2 mb-4">
          {(["7d", "14d", "30d"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className="rounded-md border px-3 py-1 text-xs transition-colors"
              style={{
                borderColor:
                  dateRange === range
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  dateRange === range
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
                color: "var(--color-text-primary)",
              }}
            >
              {range === "7d" ? "7 Days" : range === "14d" ? "14 Days" : "30 Days"}
            </button>
          ))}
        </div>

        {/* Mood chart */}
        <div
          className="rounded-lg border p-3 mb-4"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
          }}
        >
          <div
            className="text-xs font-medium mb-2"
            style={{ color: "var(--color-text-muted)" }}
          >
            Mood Over Time
          </div>
          {filteredEntries.filter((e) => e.mood > 0).length > 0 ? (
            <svg ref={svgRef} />
          ) : (
            <div
              className="text-xs text-center py-4"
              style={{ color: "var(--color-text-muted)" }}
            >
              No mood data for this period
            </div>
          )}
        </div>

        {/* Habit heatmap */}
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
          }}
        >
          <div
            className="text-xs font-medium mb-2"
            style={{ color: "var(--color-text-muted)" }}
          >
            Habit Completion
          </div>
          {filteredEntries.length > 0 ? (
            <div className="space-y-2">
              {habitList.map((habit) => {
                const total = filteredEntries.length;
                const completed = filteredEntries.filter(
                  (e) => e.habits[habit]
                ).length;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

                return (
                  <div key={habit} className="flex items-center gap-2">
                    <span
                      className="w-20 text-xs truncate"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {habit}
                    </span>
                    <div
                      className="flex-1 h-2 rounded-full overflow-hidden"
                      style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            pct >= 80
                              ? "var(--color-success)"
                              : pct >= 50
                                ? "var(--color-accent)"
                                : "var(--color-warning)",
                        }}
                      />
                    </div>
                    <span
                      className="w-8 text-xs text-right"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className="text-xs text-center py-4"
              style={{ color: "var(--color-text-muted)" }}
            >
              No habit data for this period
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
