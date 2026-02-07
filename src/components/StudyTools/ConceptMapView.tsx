import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { ConceptGraph, ConceptNode } from "../../types/studyTools";
import { useToastStore } from "../../stores/toastStore";

interface D3ConceptNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  nodeType: "concept" | "example" | "definition";
  description?: string | null;
}

interface D3ConceptLink extends d3.SimulationLinkDatum<D3ConceptNode> {
  source: string | D3ConceptNode;
  target: string | D3ConceptNode;
  relationship: string;
}

interface ConceptMapViewProps {
  conceptGraph: ConceptGraph;
  onClose?: () => void;
}

export function ConceptMapView({ conceptGraph, onClose: _onClose }: ConceptMapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [selectedNode, setSelectedNode] = useState<ConceptNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<ConceptNode | null>(null);

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: Math.max(400, containerRef.current.clientHeight),
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Color mapping for node types
  const nodeColors = useMemo(
    () => ({
      concept: "#8b5cf6", // purple
      example: "#10b981", // green
      definition: "#f59e0b", // amber
    }),
    []
  );

  // Get connected nodes for a given node
  const getConnectedNodes = useCallback(
    (nodeId: string) => {
      const connected = new Set<string>();
      for (const link of conceptGraph.links) {
        if (link.source === nodeId) connected.add(link.target);
        if (link.target === nodeId) connected.add(link.source);
      }
      return connected;
    },
    [conceptGraph.links]
  );

  // Render force-directed graph
  useEffect(() => {
    if (!svgRef.current || conceptGraph.nodes.length === 0) return;

    const { width, height } = dimensions;

    // Clone data for D3
    const nodes: D3ConceptNode[] = conceptGraph.nodes.map((n) => ({ ...n }));
    const links: D3ConceptLink[] = conceptGraph.links.map((l) => ({ ...l }));

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height]);

    // Define arrow markers
    const defs = svg.append("defs");

    // Arrow marker for links
    defs
      .append("marker")
      .attr("id", "concept-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "var(--color-border)");

    // Add zoom behavior
    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Create force simulation
    const simulation = d3
      .forceSimulation<D3ConceptNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<D3ConceptNode, D3ConceptLink>(links)
          .id((d) => d.id)
          .distance(150)
      )
      .force("charge", d3.forceManyBody().strength(-500))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(60));

    // Draw links
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("g")
      .data(links)
      .join("g");

    // Link lines
    const linkLines = link
      .append("line")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#concept-arrow)");

    // Link labels
    const linkLabels = link
      .append("text")
      .text((d) => d.relationship)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-muted)")
      .attr("font-size", "9px")
      .attr("dy", -5);

    // Create drag behavior
    const dragBehavior = d3
      .drag<SVGGElement, D3ConceptNode>()
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
      .selectAll<SVGGElement, D3ConceptNode>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(dragBehavior);

    // Node shapes based on type
    node.each(function (d) {
      const el = d3.select(this);
      const color = nodeColors[d.nodeType];

      if (d.nodeType === "concept") {
        // Circle for concepts
        el.append("circle")
          .attr("r", 20)
          .attr("fill", color)
          .attr("stroke", "var(--color-bg-primary)")
          .attr("stroke-width", 2);
      } else if (d.nodeType === "example") {
        // Diamond for examples
        el.append("rect")
          .attr("width", 28)
          .attr("height", 28)
          .attr("x", -14)
          .attr("y", -14)
          .attr("fill", color)
          .attr("stroke", "var(--color-bg-primary)")
          .attr("stroke-width", 2)
          .attr("transform", "rotate(45)");
      } else {
        // Rounded rect for definitions
        el.append("rect")
          .attr("width", 36)
          .attr("height", 28)
          .attr("x", -18)
          .attr("y", -14)
          .attr("rx", 6)
          .attr("fill", color)
          .attr("stroke", "var(--color-bg-primary)")
          .attr("stroke-width", 2);
      }
    });

    // Node labels
    node
      .append("text")
      .text((d) => (d.label.length > 15 ? d.label.slice(0, 13) + "..." : d.label))
      .attr("x", 0)
      .attr("y", 35)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-secondary)")
      .attr("font-size", "11px")
      .attr("font-weight", "500");

    // Node interactions
    node
      .on("mouseenter", function (_event, d) {
        const shape = d3.select(this).select("circle, rect");
        shape
          .transition()
          .duration(150)
          .attr("stroke-width", 4)
          .attr("stroke", "var(--color-accent)");

        // Highlight connected links
        linkLines
          .transition()
          .duration(150)
          .attr("stroke-opacity", (l) => {
            const sourceId =
              typeof l.source === "object" ? (l.source as D3ConceptNode).id : l.source;
            const targetId =
              typeof l.target === "object" ? (l.target as D3ConceptNode).id : l.target;
            return sourceId === d.id || targetId === d.id ? 1 : 0.15;
          })
          .attr("stroke-width", (l) => {
            const sourceId =
              typeof l.source === "object" ? (l.source as D3ConceptNode).id : l.source;
            const targetId =
              typeof l.target === "object" ? (l.target as D3ConceptNode).id : l.target;
            return sourceId === d.id || targetId === d.id ? 2.5 : 1.5;
          });

        // Show link labels for connected
        linkLabels.attr("opacity", (l) => {
          const sourceId =
            typeof l.source === "object" ? (l.source as D3ConceptNode).id : l.source;
          const targetId =
            typeof l.target === "object" ? (l.target as D3ConceptNode).id : l.target;
          return sourceId === d.id || targetId === d.id ? 1 : 0;
        });

        // Dim unconnected nodes
        const connected = getConnectedNodes(d.id);
        node
          .filter((n) => n.id !== d.id && !connected.has(n.id))
          .select("circle, rect")
          .transition()
          .duration(150)
          .attr("opacity", 0.3);

        setHoveredNode(conceptGraph.nodes.find((n) => n.id === d.id) || null);
      })
      .on("mouseleave", function () {
        const shape = d3.select(this).select("circle, rect");
        shape
          .transition()
          .duration(150)
          .attr("stroke-width", 2)
          .attr("stroke", "var(--color-bg-primary)");

        linkLines
          .transition()
          .duration(150)
          .attr("stroke-opacity", 0.6)
          .attr("stroke-width", 1.5);

        linkLabels.attr("opacity", 0);

        node
          .select("circle, rect")
          .transition()
          .duration(150)
          .attr("opacity", 1);

        setHoveredNode(null);
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedNode(conceptGraph.nodes.find((n) => n.id === d.id) || null);
      });

    // Initially hide link labels
    linkLabels.attr("opacity", 0);

    // Update positions on tick
    simulation.on("tick", () => {
      linkLines
        .attr("x1", (d) => (d.source as D3ConceptNode).x!)
        .attr("y1", (d) => (d.source as D3ConceptNode).y!)
        .attr("x2", (d) => (d.target as D3ConceptNode).x!)
        .attr("y2", (d) => (d.target as D3ConceptNode).y!);

      linkLabels
        .attr(
          "x",
          (d) =>
            ((d.source as D3ConceptNode).x! + (d.target as D3ConceptNode).x!) / 2
        )
        .attr(
          "y",
          (d) =>
            ((d.source as D3ConceptNode).y! + (d.target as D3ConceptNode).y!) / 2
        );

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [conceptGraph, dimensions, nodeColors, getConnectedNodes]);

  const handleExportSvg = useCallback(async () => {
    if (!svgRef.current) return;
    const { success, error } = useToastStore.getState();
    try {
      const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(dimensions.width));
      clone.setAttribute("height", String(dimensions.height));
      const svgContent = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;

      const path = await save({
        defaultPath: "concept-map.svg",
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (!path) return;

      await writeTextFile(path, svgContent);
      success("Concept map exported as SVG");
    } catch (e) {
      error(`Export failed: ${e}`);
    }
  }, [dimensions]);

  if (conceptGraph.nodes.length === 0) {
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
            <circle cx="12" cy="12" r="3" />
            <circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="5" r="2" />
            <circle cx="5" cy="19" r="2" />
            <circle cx="19" cy="19" r="2" />
          </svg>
          <p>No concepts extracted</p>
          <p className="text-sm mt-1">Try with more detailed content</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Legend + export */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-1.5 text-xs">
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: nodeColors.concept }}
          />
          <span style={{ color: "var(--color-text-muted)" }}>Concept</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <div
            className="w-4 h-4 rotate-45"
            style={{ backgroundColor: nodeColors.example }}
          />
          <span style={{ color: "var(--color-text-muted)" }}>Example</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <div
            className="w-5 h-4 rounded"
            style={{ backgroundColor: nodeColors.definition }}
          />
          <span style={{ color: "var(--color-text-muted)" }}>Definition</span>
        </div>
        <span
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          {conceptGraph.nodes.length} concepts, {conceptGraph.links.length} connections
        </span>
        <button
          onClick={handleExportSvg}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded text-xs hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border)",
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export SVG
        </button>
      </div>

      {/* Graph visualization */}
      <div ref={containerRef} className="flex-1 min-h-[400px] relative">
        <svg ref={svgRef} className="w-full h-full" />

        {/* Hover tooltip */}
        {hoveredNode && hoveredNode.description && (
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
              {hoveredNode.label}
            </div>
            <div
              className="text-xs mt-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {hoveredNode.description}
            </div>
          </div>
        )}
      </div>

      {/* Selected node details */}
      {selectedNode && (
        <div
          className="mt-4 p-4 rounded-lg"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderLeft: `3px solid ${nodeColors[selectedNode.nodeType]}`,
          }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {selectedNode.label}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: `${nodeColors[selectedNode.nodeType]}20`,
                    color: nodeColors[selectedNode.nodeType],
                  }}
                >
                  {selectedNode.nodeType}
                </span>
              </div>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
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
          {selectedNode.description && (
            <p
              className="text-sm mt-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {selectedNode.description}
            </p>
          )}
          {/* Show connections */}
          <div className="mt-3">
            <div
              className="text-xs font-medium mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Connections:
            </div>
            <div className="flex flex-wrap gap-1">
              {conceptGraph.links
                .filter(
                  (l) => l.source === selectedNode.id || l.target === selectedNode.id
                )
                .map((link, i) => {
                  const otherNodeId =
                    link.source === selectedNode.id ? link.target : link.source;
                  const otherNode = conceptGraph.nodes.find(
                    (n) => n.id === otherNodeId
                  );
                  return (
                    <span
                      key={i}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {link.relationship} {otherNode?.label || otherNodeId}
                    </span>
                  );
                })}
              {conceptGraph.links.filter(
                (l) => l.source === selectedNode.id || l.target === selectedNode.id
              ).length === 0 && (
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  No connections
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div
        className="mt-3 text-xs text-center"
        style={{ color: "var(--color-text-muted)" }}
      >
        Scroll to zoom | Drag nodes | Hover for connections | Click for details
      </div>
    </div>
  );
}
