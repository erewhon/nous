import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { usePageStore } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import type { Page } from "../../types/page";

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  linkCount: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface GraphViewProps {
  onClose: () => void;
  onNodeClick?: (pageId: string) => void;
}

export function GraphView({ onClose, onNodeClick }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { pages, selectedPageId } = usePageStore();
  const { outgoingLinks } = useLinkStore();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Build graph data
  const buildGraphData = useCallback(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const pageMap = new Map<string, Page>();
    const titleToId = new Map<string, string>();

    // Build page maps
    for (const page of pages) {
      pageMap.set(page.id, page);
      titleToId.set(page.title.toLowerCase(), page.id);
    }

    // Create nodes
    for (const page of pages) {
      const pageLinks = outgoingLinks.get(page.id) || [];
      nodes.push({
        id: page.id,
        title: page.title,
        linkCount: pageLinks.length,
      });
    }

    // Create links
    for (const page of pages) {
      const pageLinks = outgoingLinks.get(page.id) || [];
      for (const targetTitle of pageLinks) {
        const targetId = titleToId.get(targetTitle.toLowerCase());
        if (targetId && targetId !== page.id) {
          // Avoid duplicate links
          const existingLink = links.find(
            (l) =>
              (l.source === page.id && l.target === targetId) ||
              (l.source === targetId && l.target === page.id)
          );
          if (!existingLink) {
            links.push({
              source: page.id,
              target: targetId,
            });
          }
        }
      }
    }

    return { nodes, links };
  }, [pages, outgoingLinks]);

  // Render graph
  useEffect(() => {
    if (!svgRef.current || pages.length === 0) return;

    const { nodes, links } = buildGraphData();
    const { width, height } = dimensions;

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height]);

    // Add zoom behavior
    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Create force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(100)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(40));

    // Draw links
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1.5);

    // Create drag behavior
    const dragBehavior = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // Draw nodes
    const node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(dragBehavior);

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => Math.max(8, Math.min(20, 8 + d.linkCount * 2)))
      .attr("fill", (d) =>
        d.id === selectedPageId
          ? "var(--color-accent)"
          : "var(--color-bg-tertiary)"
      )
      .attr("stroke", (d) =>
        d.id === selectedPageId
          ? "var(--color-accent-hover)"
          : "var(--color-text-muted)"
      )
      .attr("stroke-width", 2);

    // Node labels
    node
      .append("text")
      .text((d) => d.title)
      .attr("x", 0)
      .attr("y", (d) => Math.max(8, Math.min(20, 8 + d.linkCount * 2)) + 14)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-secondary)")
      .attr("font-size", "11px")
      .attr("pointer-events", "none");

    // Click handler
    node.on("click", (event, d) => {
      event.stopPropagation();
      onNodeClick?.(d.id);
    });

    // Hover effects
    node
      .on("mouseenter", function (_event, d) {
        d3.select(this)
          .select("circle")
          .transition()
          .duration(150)
          .attr("fill", "var(--color-accent)")
          .attr("stroke", "var(--color-accent-hover)");

        // Highlight connected links
        link
          .transition()
          .duration(150)
          .attr("stroke-opacity", (l) => {
            const sourceId =
              typeof l.source === "object" ? l.source.id : l.source;
            const targetId =
              typeof l.target === "object" ? l.target.id : l.target;
            return sourceId === d.id || targetId === d.id ? 1 : 0.2;
          })
          .attr("stroke-width", (l) => {
            const sourceId =
              typeof l.source === "object" ? l.source.id : l.source;
            const targetId =
              typeof l.target === "object" ? l.target.id : l.target;
            return sourceId === d.id || targetId === d.id ? 2.5 : 1.5;
          });
      })
      .on("mouseleave", function (_event, d) {
        d3.select(this)
          .select("circle")
          .transition()
          .duration(150)
          .attr("fill", () =>
            d.id === selectedPageId
              ? "var(--color-accent)"
              : "var(--color-bg-tertiary)"
          )
          .attr("stroke", () =>
            d.id === selectedPageId
              ? "var(--color-accent-hover)"
              : "var(--color-text-muted)"
          );

        link
          .transition()
          .duration(150)
          .attr("stroke-opacity", 0.6)
          .attr("stroke-width", 1.5);
      });

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x!)
        .attr("y1", (d) => (d.source as GraphNode).y!)
        .attr("x2", (d) => (d.target as GraphNode).x!)
        .attr("y2", (d) => (d.target as GraphNode).y!);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [pages, dimensions, buildGraphData, selectedPageId, onNodeClick]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[--color-bg-primary]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[--color-border] px-4 py-3">
        <div className="flex items-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[--color-accent]"
          >
            <circle cx="12" cy="12" r="3" />
            <circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="19" r="2" />
            <line x1="14.5" y1="9.5" x2="17.5" y2="6.5" />
            <line x1="9.5" y1="14.5" x2="6.5" y2="17.5" />
          </svg>
          <h2 className="text-lg font-semibold text-[--color-text-primary]">
            Graph View
          </h2>
          <span className="text-sm text-[--color-text-muted]">
            {pages.length} pages
          </span>
        </div>

        <button
          onClick={onClose}
          className="rounded p-2 text-[--color-text-muted] transition-colors hover:bg-[--color-bg-secondary] hover:text-[--color-text-primary]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
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

      {/* Graph canvas */}
      <div ref={containerRef} className="flex-1 overflow-hidden">
        {pages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-4xl opacity-20">🕸️</div>
              <p className="text-[--color-text-muted]">
                No pages to display. Create some pages first.
              </p>
            </div>
          </div>
        ) : (
          <svg ref={svgRef} className="h-full w-full" />
        )}
      </div>

      {/* Legend */}
      <div className="border-t border-[--color-border] px-4 py-2">
        <div className="flex items-center gap-6 text-xs text-[--color-text-muted]">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-[--color-accent]" />
            <span>Selected page</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-[--color-bg-tertiary] ring-1 ring-[--color-text-muted]" />
            <span>Other pages</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-px w-6 bg-[--color-border]" />
            <span>Link</span>
          </div>
          <span className="ml-auto">
            Scroll to zoom • Drag nodes to move • Click to navigate
          </span>
        </div>
      </div>
    </div>
  );
}
