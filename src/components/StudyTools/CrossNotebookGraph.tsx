import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { listNotebooks, listPages } from "../../utils/api";
import { WikiLinkTool } from "../Editor/WikiLinkTool";
import { useToastStore } from "../../stores/toastStore";
import type { Notebook } from "../../types/notebook";
import type { Page } from "../../types/page";

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  notebookId: string;
  notebookName: string;
  connectionCount: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  relationship: string;
}

interface CrossNotebookGraphProps {
  onNavigateToPage?: (pageId: string) => void;
  onClose?: () => void;
}

export function CrossNotebookGraph({
  onNavigateToPage,
  onClose,
}: CrossNotebookGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);
  const [enabledNotebooks, setEnabledNotebooks] = useState<Set<string>>(
    new Set()
  );

  // Resize handler
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

  // Load data from all notebooks
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const allNotebooks = await listNotebooks();
        if (cancelled) return;
        setNotebooks(allNotebooks);
        setEnabledNotebooks(new Set(allNotebooks.map((n) => n.id)));

        // Load pages from all notebooks
        const allPages: (Page & { notebookName: string })[] = [];
        for (const notebook of allNotebooks) {
          try {
            const pages = await listPages(notebook.id, false);
            if (cancelled) return;
            for (const page of pages) {
              allPages.push({ ...page, notebookName: notebook.name });
            }
          } catch {
            // Skip notebooks that fail to load
          }
        }

        // Build title-to-id lookup (cross-notebook)
        const titleToPageId = new Map<string, string>();
        for (const page of allPages) {
          titleToPageId.set(page.title.toLowerCase(), page.id);
        }

        // Extract wiki-links and build graph
        const graphNodes: GraphNode[] = [];
        const graphLinks: GraphLink[] = [];
        const connectionCounts = new Map<string, number>();

        for (const page of allPages) {
          graphNodes.push({
            id: page.id,
            label: page.title,
            notebookId: page.notebookId,
            notebookName: page.notebookName,
            connectionCount: 0,
          });

          // Extract links from page content
          if (page.content?.blocks) {
            const linkTitles = WikiLinkTool.extractLinks(
              page.content.blocks as Array<{
                type: string;
                data: Record<string, unknown>;
              }>
            );

            for (const linkTitle of linkTitles) {
              const targetId = titleToPageId.get(linkTitle.toLowerCase());
              if (targetId && targetId !== page.id) {
                graphLinks.push({
                  source: page.id,
                  target: targetId,
                  relationship: "links to",
                });
                connectionCounts.set(
                  page.id,
                  (connectionCounts.get(page.id) || 0) + 1
                );
                connectionCounts.set(
                  targetId,
                  (connectionCounts.get(targetId) || 0) + 1
                );
              }
            }
          }
        }

        // Update connection counts
        for (const node of graphNodes) {
          node.connectionCount = connectionCounts.get(node.id) || 0;
        }

        if (!cancelled) {
          setNodes(graphNodes);
          setLinks(graphLinks);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load notebooks"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  // Color scale for notebooks
  const notebookColorScale = useMemo(() => {
    const colors = [
      "#8b5cf6",
      "#10b981",
      "#f59e0b",
      "#ec4899",
      "#06b6d4",
      "#3b82f6",
      "#ef4444",
      "#f97316",
      "#14b8a6",
      "#a855f7",
    ];
    return d3
      .scaleOrdinal<string>()
      .domain(notebooks.map((n) => n.id))
      .range(colors);
  }, [notebooks]);

  // Filtered nodes and links
  const filteredData = useMemo(() => {
    const filteredNodes = nodes.filter((n) => {
      if (!enabledNotebooks.has(n.notebookId)) return false;
      if (!showOrphans && n.connectionCount === 0) return false;
      return true;
    });

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = links.filter((l) => {
      const sourceId = typeof l.source === "string" ? l.source : l.source.id;
      const targetId = typeof l.target === "string" ? l.target : l.target.id;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    return { nodes: filteredNodes, links: filteredLinks };
  }, [nodes, links, enabledNotebooks, showOrphans]);

  // Get connected nodes for hover highlight
  const getConnectedNodes = useCallback(
    (nodeId: string) => {
      const connected = new Set<string>();
      for (const link of filteredData.links) {
        const sourceId =
          typeof link.source === "string" ? link.source : link.source.id;
        const targetId =
          typeof link.target === "string" ? link.target : link.target.id;
        if (sourceId === nodeId) connected.add(targetId);
        if (targetId === nodeId) connected.add(sourceId);
      }
      return connected;
    },
    [filteredData.links]
  );

  // Render D3 graph
  useEffect(() => {
    if (!svgRef.current || filteredData.nodes.length === 0) return;

    const { width, height } = dimensions;

    // Clone data for D3 mutation
    const simNodes: GraphNode[] = filteredData.nodes.map((n) => ({ ...n }));
    const simLinks: GraphLink[] = filteredData.links.map((l) => ({
      ...l,
      source: typeof l.source === "string" ? l.source : l.source.id,
      target: typeof l.target === "string" ? l.target : l.target.id,
    }));

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height]);

    // Arrow marker
    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "kg-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "var(--color-border)");

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    // Force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(40));

    // Draw links
    const linkGroup = g.append("g").attr("class", "links");
    const linkLines = linkGroup
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1)
      .attr("marker-end", "url(#kg-arrow)");

    // Drag behavior
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
    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup
      .selectAll<SVGGElement, GraphNode>("g")
      .data(simNodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(dragBehavior);

    // Node circles with radius based on connections
    node
      .append("circle")
      .attr("r", (d) => Math.max(6, Math.min(20, 6 + d.connectionCount * 2)))
      .attr("fill", (d) => notebookColorScale(d.notebookId))
      .attr("stroke", "var(--color-bg-primary)")
      .attr("stroke-width", 2);

    // Node labels
    node
      .append("text")
      .text((d) =>
        d.label.length > 18 ? d.label.slice(0, 16) + "..." : d.label
      )
      .attr("x", 0)
      .attr("y", (d) =>
        Math.max(6, Math.min(20, 6 + d.connectionCount * 2)) + 14
      )
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-secondary)")
      .attr("font-size", "10px")
      .attr("font-weight", "500");

    // Interactions
    node
      .on("mouseenter", function (_event, d) {
        d3.select(this)
          .select("circle")
          .transition()
          .duration(150)
          .attr("stroke-width", 4)
          .attr("stroke", "var(--color-accent)");

        // Highlight connected links
        linkLines
          .transition()
          .duration(150)
          .attr("stroke-opacity", (l) => {
            const sid =
              typeof l.source === "object"
                ? (l.source as GraphNode).id
                : l.source;
            const tid =
              typeof l.target === "object"
                ? (l.target as GraphNode).id
                : l.target;
            return sid === d.id || tid === d.id ? 0.9 : 0.1;
          })
          .attr("stroke-width", (l) => {
            const sid =
              typeof l.source === "object"
                ? (l.source as GraphNode).id
                : l.source;
            const tid =
              typeof l.target === "object"
                ? (l.target as GraphNode).id
                : l.target;
            return sid === d.id || tid === d.id ? 2 : 1;
          });

        // Dim unconnected nodes
        const connected = getConnectedNodes(d.id);
        node
          .filter((n) => n.id !== d.id && !connected.has(n.id))
          .select("circle")
          .transition()
          .duration(150)
          .attr("opacity", 0.2);

        setHoveredNode(d);
      })
      .on("mouseleave", function () {
        d3.select(this)
          .select("circle")
          .transition()
          .duration(150)
          .attr("stroke-width", 2)
          .attr("stroke", "var(--color-bg-primary)");

        linkLines
          .transition()
          .duration(150)
          .attr("stroke-opacity", 0.4)
          .attr("stroke-width", 1);

        node
          .select("circle")
          .transition()
          .duration(150)
          .attr("opacity", 1);

        setHoveredNode(null);
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
      });

    // Tick update
    simulation.on("tick", () => {
      linkLines
        .attr("x1", (d) => (d.source as GraphNode).x!)
        .attr("y1", (d) => (d.source as GraphNode).y!)
        .attr("x2", (d) => (d.target as GraphNode).x!)
        .attr("y2", (d) => (d.target as GraphNode).y!);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [filteredData, dimensions, notebookColorScale, getConnectedNodes]);

  const handleExportSvg = useCallback(async () => {
    if (!svgRef.current) return;
    const { success, error: showError } = useToastStore.getState();
    try {
      const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(dimensions.width));
      clone.setAttribute("height", String(dimensions.height));
      const svgContent =
        '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;

      const path = await save({
        defaultPath: "knowledge-graph.svg",
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (!path) return;

      await writeTextFile(path, svgContent);
      success("Knowledge graph exported as SVG");
    } catch (e) {
      showError(`Export failed: ${e}`);
    }
  }, [dimensions]);

  const toggleNotebook = (notebookId: string) => {
    setEnabledNotebooks((prev) => {
      const next = new Set(prev);
      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div
        className="flex h-64 items-center justify-center"
        style={{ color: "var(--color-text-muted)" }}
      >
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <p>Loading notebooks...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-64 items-center justify-center"
        style={{ color: "var(--color-text-muted)" }}
      >
        <div className="text-center">
          <p className="text-red-400">{error}</p>
          <p className="text-sm mt-1">Try again later</p>
        </div>
      </div>
    );
  }

  if (filteredData.nodes.length === 0) {
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
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <p>No linked pages found</p>
          <p className="text-sm mt-1">
            {showOrphans
              ? "No pages in selected notebooks"
              : "Toggle 'Show orphans' or add wiki-links between pages"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Notebook legend / filters */}
        <div className="flex flex-wrap gap-2 flex-1">
          {notebooks.map((nb) => {
            const enabled = enabledNotebooks.has(nb.id);
            return (
              <button
                key={nb.id}
                onClick={() => toggleNotebook(nb.id)}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-opacity"
                style={{
                  opacity: enabled ? 1 : 0.4,
                  backgroundColor: enabled
                    ? `${notebookColorScale(nb.id)}20`
                    : "transparent",
                  border: `1px solid ${enabled ? notebookColorScale(nb.id) : "var(--color-border)"}`,
                  color: enabled
                    ? notebookColorScale(nb.id)
                    : "var(--color-text-muted)",
                }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: notebookColorScale(nb.id) }}
                />
                {nb.name}
              </button>
            );
          })}
        </div>

        {/* Toggle orphans */}
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setShowOrphans(e.target.checked)}
            className="rounded"
          />
          Show orphans
        </label>

        {/* Stats */}
        <span
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          {filteredData.nodes.length} pages, {filteredData.links.length} links
        </span>

        {/* Export */}
        <button
          onClick={handleExportSvg}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
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
        {hoveredNode && (
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
              className="text-xs mt-1 flex items-center gap-1.5"
              style={{ color: "var(--color-text-muted)" }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: notebookColorScale(hoveredNode.notebookId),
                }}
              />
              {hoveredNode.notebookName}
            </div>
            <div
              className="text-xs mt-0.5"
              style={{ color: "var(--color-text-muted)" }}
            >
              {hoveredNode.connectionCount} connection
              {hoveredNode.connectionCount !== 1 ? "s" : ""}
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
            borderLeft: `3px solid ${notebookColorScale(selectedNode.notebookId)}`,
          }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div
                className="font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {selectedNode.label}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: notebookColorScale(
                      selectedNode.notebookId
                    ),
                  }}
                />
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {selectedNode.notebookName}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  &middot; {selectedNode.connectionCount} connection
                  {selectedNode.connectionCount !== 1 ? "s" : ""}
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

          {/* Connected pages */}
          <div className="mt-3">
            <div
              className="text-xs font-medium mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Connected pages:
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from(getConnectedNodes(selectedNode.id)).map((nodeId) => {
                const connNode = filteredData.nodes.find(
                  (n) => n.id === nodeId
                );
                if (!connNode) return null;
                return (
                  <span
                    key={nodeId}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: `${notebookColorScale(connNode.notebookId)}15`,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {connNode.label}
                  </span>
                );
              })}
              {getConnectedNodes(selectedNode.id).size === 0 && (
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  No connections
                </span>
              )}
            </div>
          </div>

          {onNavigateToPage && (
            <button
              onClick={() => {
                onNavigateToPage(selectedNode.id);
                onClose?.();
              }}
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
              View page
            </button>
          )}
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
