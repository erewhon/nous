import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { usePageStore } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import type { Page } from "../../types/page";

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  outgoingCount: number;
  incomingCount: number;
  nodeType: "orphan" | "leaf" | "hub" | "normal";
  isSelected: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  bidirectional: boolean;
  isBlockRef?: boolean;
}

interface GraphStats {
  totalNodes: number;
  totalLinks: number;
  orphanCount: number;
  hubCount: number;
  avgConnections: number;
  mostConnected: { title: string; count: number } | null;
}

interface GraphViewProps {
  onClose: () => void;
  onNodeClick?: (pageId: string) => void;
}

// Node type thresholds
const HUB_THRESHOLD = 5; // Nodes with 5+ connections are hubs

export function GraphView({ onClose, onNodeClick }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { pages, selectedPageId } = usePageStore();
  const { outgoingLinks, backlinks, blockRefBacklinks } = useLinkStore();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [showOrphansOnly, setShowOrphansOnly] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());

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

  // Build graph data with enhanced node info
  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const pageMap = new Map<string, Page>();
    const titleToId = new Map<string, string>();
    const linkPairs = new Map<string, boolean>(); // Track bidirectional links

    // Build page maps
    for (const page of pages) {
      pageMap.set(page.id, page);
      titleToId.set(page.title.toLowerCase(), page.id);
    }

    // First pass: collect all links to detect bidirectional
    for (const page of pages) {
      const pageLinks = outgoingLinks.get(page.id) || [];
      for (const targetTitle of pageLinks) {
        const targetId = titleToId.get(targetTitle.toLowerCase());
        if (targetId && targetId !== page.id) {
          const key = [page.id, targetId].sort().join("-");
          const reverseExists = linkPairs.has(key);
          linkPairs.set(key, reverseExists || false);

          // Check if reverse link exists
          const targetLinks = outgoingLinks.get(targetId) || [];
          if (targetLinks.some(t => t.toLowerCase() === page.title.toLowerCase())) {
            linkPairs.set(key, true);
          }
        }
      }
    }

    // Count block-ref connections per page (as source or target page)
    const blockRefConnectionCount = new Map<string, number>();
    for (const [, refs] of blockRefBacklinks) {
      for (const ref of refs) {
        if (ref.sourcePageId !== ref.targetPageId) {
          blockRefConnectionCount.set(
            ref.sourcePageId,
            (blockRefConnectionCount.get(ref.sourcePageId) || 0) + 1
          );
          blockRefConnectionCount.set(
            ref.targetPageId,
            (blockRefConnectionCount.get(ref.targetPageId) || 0) + 1
          );
        }
      }
    }

    // Create nodes with type classification
    for (const page of pages) {
      const outgoing = outgoingLinks.get(page.id) || [];
      const incoming = backlinks.get(page.title) || [];
      const blockRefCount = blockRefConnectionCount.get(page.id) || 0;
      const totalConnections = outgoing.length + incoming.length + blockRefCount;

      let nodeType: GraphNode["nodeType"] = "normal";
      if (totalConnections === 0) {
        nodeType = "orphan";
      } else if (totalConnections >= HUB_THRESHOLD) {
        nodeType = "hub";
      } else if (outgoing.length === 0 && incoming.length > 0) {
        nodeType = "leaf";
      }

      nodes.push({
        id: page.id,
        title: page.title,
        outgoingCount: outgoing.length,
        incomingCount: incoming.length,
        nodeType,
        isSelected: page.id === selectedPageId,
      });
    }

    // Create links
    const addedLinks = new Set<string>();
    for (const page of pages) {
      const pageLinks = outgoingLinks.get(page.id) || [];
      for (const targetTitle of pageLinks) {
        const targetId = titleToId.get(targetTitle.toLowerCase());
        if (targetId && targetId !== page.id) {
          const key = [page.id, targetId].sort().join("-");
          if (!addedLinks.has(key)) {
            addedLinks.add(key);
            links.push({
              source: page.id,
              target: targetId,
              bidirectional: linkPairs.get(key) || false,
            });
          }
        }
      }
    }

    // Add block-ref edges (source page -> target page, deduplicated against existing links)
    for (const [, refs] of blockRefBacklinks) {
      for (const ref of refs) {
        if (ref.sourcePageId === ref.targetPageId) continue;
        const key = [ref.sourcePageId, ref.targetPageId].sort().join("-");
        if (!addedLinks.has(key)) {
          addedLinks.add(key);
          links.push({
            source: ref.sourcePageId,
            target: ref.targetPageId,
            bidirectional: false,
            isBlockRef: true,
          });
        }
      }
    }

    return { nodes, links, titleToId };
  }, [pages, outgoingLinks, backlinks, blockRefBacklinks, selectedPageId]);

  // Compute graph statistics
  const stats = useMemo<GraphStats>(() => {
    const { nodes, links } = graphData;
    const orphanCount = nodes.filter(n => n.nodeType === "orphan").length;
    const hubCount = nodes.filter(n => n.nodeType === "hub").length;
    const totalConnections = nodes.reduce((sum, n) => sum + n.outgoingCount + n.incomingCount, 0);
    const avgConnections = nodes.length > 0 ? totalConnections / nodes.length : 0;

    let mostConnected: { title: string; count: number } | null = null;
    for (const node of nodes) {
      const count = node.outgoingCount + node.incomingCount;
      if (!mostConnected || count > mostConnected.count) {
        mostConnected = { title: node.title, count };
      }
    }

    return {
      totalNodes: nodes.length,
      totalLinks: links.length,
      orphanCount,
      hubCount,
      avgConnections,
      mostConnected,
    };
  }, [graphData]);

  // Filter nodes based on search and filters
  const filteredData = useMemo(() => {
    let { nodes, links } = graphData;
    const query = searchQuery.toLowerCase().trim();

    // Apply orphans-only filter
    if (showOrphansOnly) {
      const orphanIds = new Set(nodes.filter(n => n.nodeType === "orphan").map(n => n.id));
      nodes = nodes.filter(n => orphanIds.has(n.id));
      links = []; // Orphans have no links
    }

    // Apply focus mode
    if (focusMode && focusedNodeId) {
      const connectedIds = new Set<string>([focusedNodeId]);
      for (const link of graphData.links) {
        const sourceId = typeof link.source === "object" ? link.source.id : link.source;
        const targetId = typeof link.target === "object" ? link.target.id : link.target;
        if (sourceId === focusedNodeId) connectedIds.add(targetId);
        if (targetId === focusedNodeId) connectedIds.add(sourceId);
      }
      nodes = nodes.filter(n => connectedIds.has(n.id));
      links = links.filter(l => {
        const sourceId = typeof l.source === "object" ? l.source.id : l.source;
        const targetId = typeof l.target === "object" ? l.target.id : l.target;
        return connectedIds.has(sourceId) && connectedIds.has(targetId);
      });
    }

    // Update highlighted nodes based on search
    if (query) {
      const matching = new Set(
        nodes.filter(n => n.title.toLowerCase().includes(query)).map(n => n.id)
      );
      setHighlightedNodes(matching);
    } else {
      setHighlightedNodes(new Set());
    }

    return { nodes, links };
  }, [graphData, searchQuery, showOrphansOnly, focusMode, focusedNodeId]);

  // Handle focus on a node
  const handleFocusNode = useCallback((nodeId: string) => {
    setFocusedNodeId(nodeId);
    setFocusMode(true);
  }, []);

  // Clear focus
  const clearFocus = useCallback(() => {
    setFocusMode(false);
    setFocusedNodeId(null);
  }, []);

  // Get node color based on type and state
  const getNodeColor = useCallback((node: GraphNode, isHighlighted: boolean) => {
    if (node.isSelected) return "var(--color-accent)";
    if (isHighlighted) return "#fbbf24"; // Amber for search matches
    switch (node.nodeType) {
      case "orphan":
        return "#ef4444"; // Red for orphans
      case "hub":
        return "#22c55e"; // Green for hubs
      case "leaf":
        return "#8b5cf6"; // Purple for leaves
      default:
        return "var(--color-bg-tertiary)";
    }
  }, []);

  // Render graph
  useEffect(() => {
    if (!svgRef.current || filteredData.nodes.length === 0) return;

    const { nodes, links } = filteredData;
    const { width, height } = dimensions;

    // Clone nodes and links for D3 (it mutates them)
    const nodesCopy = nodes.map(n => ({ ...n }));
    const linksCopy = links.map(l => ({
      ...l,
      source: typeof l.source === "object" ? l.source.id : l.source,
      target: typeof l.target === "object" ? l.target.id : l.target,
    }));

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height]);

    // Define arrow markers for bidirectional links
    const defs = svg.append("defs");

    defs
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .append("path")
      .attr("d", "M 0,-5 L 10,0 L 0,5")
      .attr("fill", "#6c7086");

    defs
      .append("marker")
      .attr("id", "arrowhead-bidirectional")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .append("path")
      .attr("d", "M 0,-5 L 10,0 L 0,5")
      .attr("fill", "#22c55e");

    defs
      .append("marker")
      .attr("id", "arrowhead-blockref")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .append("path")
      .attr("d", "M 0,-5 L 10,0 L 0,5")
      .attr("fill", "#8b5cf6");

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
      .forceSimulation<GraphNode>(nodesCopy)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(linksCopy)
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(50));

    // Draw links
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(linksCopy)
      .join("line")
      .attr("stroke", (d) => d.isBlockRef ? "#8b5cf6" : d.bidirectional ? "#22c55e" : "#313244")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => d.bidirectional ? 2 : 1.5)
      .attr("stroke-dasharray", (d) => d.isBlockRef ? "4 3" : null)
      .attr("marker-end", (d) => d.isBlockRef ? "url(#arrowhead-blockref)" : d.bidirectional ? "url(#arrowhead-bidirectional)" : "url(#arrowhead)");

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
      .data(nodesCopy)
      .join("g")
      .attr("cursor", "pointer")
      .call(dragBehavior);

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => {
        const baseSize = 10;
        const connectionBonus = Math.min((d.outgoingCount + d.incomingCount) * 1.5, 12);
        return baseSize + connectionBonus;
      })
      .attr("fill", (d) => getNodeColor(d, highlightedNodes.has(d.id)))
      .attr("stroke", (d) => {
        if (d.isSelected) return "#a78bfa";
        if (highlightedNodes.has(d.id)) return "#fbbf24";
        return "#6c7086";
      })
      .attr("stroke-width", (d) => highlightedNodes.has(d.id) ? 3 : 2);

    // Node type indicator (small icon/badge)
    node
      .filter((d) => d.nodeType === "orphan")
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "white")
      .attr("font-size", "10px")
      .attr("pointer-events", "none")
      .text("!");

    node
      .filter((d) => d.nodeType === "hub")
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "white")
      .attr("font-size", "10px")
      .attr("font-weight", "bold")
      .attr("pointer-events", "none")
      .text("H");

    // Node labels
    node
      .append("text")
      .text((d) => d.title.length > 20 ? d.title.slice(0, 18) + "..." : d.title)
      .attr("x", 0)
      .attr("y", (d) => {
        const baseSize = 10;
        const connectionBonus = Math.min((d.outgoingCount + d.incomingCount) * 1.5, 12);
        return baseSize + connectionBonus + 14;
      })
      .attr("text-anchor", "middle")
      .attr("fill", "#a6adc8")
      .attr("font-size", "11px")
      .attr("pointer-events", "none");

    // Click handler
    node.on("click", (event, d) => {
      event.stopPropagation();
      onNodeClick?.(d.id);
    });

    // Double-click to focus
    node.on("dblclick", (event, d) => {
      event.stopPropagation();
      handleFocusNode(d.id);
    });

    // Right-click context menu (focus)
    node.on("contextmenu", (event, d) => {
      event.preventDefault();
      handleFocusNode(d.id);
    });

    // Hover effects
    node
      .on("mouseenter", function (_event, d) {
        d3.select(this)
          .select("circle")
          .transition()
          .duration(150)
          .attr("stroke-width", 4);

        // Highlight connected links
        link
          .transition()
          .duration(150)
          .attr("stroke-opacity", (l) => {
            const sourceId = typeof l.source === "object" ? (l.source as GraphNode).id : l.source;
            const targetId = typeof l.target === "object" ? (l.target as GraphNode).id : l.target;
            return sourceId === d.id || targetId === d.id ? 1 : 0.15;
          })
          .attr("stroke-width", (l) => {
            const sourceId = typeof l.source === "object" ? (l.source as GraphNode).id : l.source;
            const targetId = typeof l.target === "object" ? (l.target as GraphNode).id : l.target;
            const isBidirectional = (l as GraphLink).bidirectional;
            if (sourceId === d.id || targetId === d.id) {
              return isBidirectional ? 3 : 2.5;
            }
            return isBidirectional ? 2 : 1.5;
          });

        // Dim other nodes
        node
          .filter((n) => n.id !== d.id)
          .select("circle")
          .transition()
          .duration(150)
          .attr("opacity", (n) => {
            // Check if connected
            const isConnected = linksCopy.some((l) => {
              const sourceId = typeof l.source === "object" ? (l.source as GraphNode).id : l.source;
              const targetId = typeof l.target === "object" ? (l.target as GraphNode).id : l.target;
              return (sourceId === d.id && targetId === n.id) || (targetId === d.id && sourceId === n.id);
            });
            return isConnected ? 1 : 0.3;
          });
      })
      .on("mouseleave", function () {
        d3.select(this)
          .select("circle")
          .transition()
          .duration(150)
          .attr("stroke-width", 2);

        link
          .transition()
          .duration(150)
          .attr("stroke-opacity", 0.6)
          .attr("stroke-width", (l) => (l as GraphLink).bidirectional ? 2 : 1.5);

        node
          .select("circle")
          .transition()
          .duration(150)
          .attr("opacity", 1);
      });

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as unknown as GraphNode).x!)
        .attr("y1", (d) => (d.source as unknown as GraphNode).y!)
        .attr("x2", (d) => (d.target as unknown as GraphNode).x!)
        .attr("y2", (d) => (d.target as unknown as GraphNode).y!);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [filteredData, dimensions, highlightedNodes, getNodeColor, onNodeClick, handleFocusNode]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      {/* Header with toolbar */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
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
            style={{ color: "var(--color-accent)" }}
          >
            <circle cx="12" cy="12" r="3" />
            <circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="19" r="2" />
            <line x1="14.5" y1="9.5" x2="17.5" y2="6.5" />
            <line x1="9.5" y1="14.5" x2="6.5" y2="17.5" />
          </svg>
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Graph View
          </h2>

          {/* Search box */}
          <div className="relative ml-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pages..."
              className="w-48 rounded-md border px-3 py-1.5 text-sm focus:outline-none"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                style={{ color: "var(--color-text-muted)" }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="ml-4 flex items-center gap-2">
            <button
              onClick={() => setShowOrphansOnly(!showOrphansOnly)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: showOrphansOnly ? "rgba(239, 68, 68, 0.2)" : "var(--color-bg-secondary)",
                color: showOrphansOnly ? "#f87171" : "var(--color-text-muted)",
              }}
              title="Show only orphaned pages (no links)"
            >
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Orphans
            </button>

            {focusMode && (
              <button
                onClick={clearFocus}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: "rgba(139, 92, 246, 0.2)",
                  color: "var(--color-accent)",
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                Exit Focus
              </button>
            )}

            <button
              onClick={() => setShowStats(!showStats)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: showStats ? "rgba(139, 92, 246, 0.2)" : "var(--color-bg-secondary)",
                color: showStats ? "var(--color-accent)" : "var(--color-text-muted)",
              }}
              title="Show graph statistics"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18" />
                <path d="M18 17V9" />
                <path d="M13 17V5" />
                <path d="M8 17v-3" />
              </svg>
              Stats
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {filteredData.nodes.length} pages
            {filteredData.nodes.length !== graphData.nodes.length && (
              <span className="ml-1">
                (of {graphData.nodes.length})
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            className="rounded p-2 transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
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
      </div>

      {/* Main content area */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Stats panel */}
        {showStats && (
          <div
            className="absolute left-4 top-4 z-10 w-64 rounded-lg border p-4 shadow-lg"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
            }}
          >
            <h3
              className="mb-3 flex items-center gap-2 text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18" />
                <path d="M18 17V9" />
                <path d="M13 17V5" />
                <path d="M8 17v-3" />
              </svg>
              Graph Statistics
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span style={{ color: "var(--color-text-muted)" }}>Total Pages</span>
                <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>{stats.totalNodes}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--color-text-muted)" }}>Total Links</span>
                <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>{stats.totalLinks}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--color-text-muted)" }}>Avg. Connections</span>
                <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>{stats.avgConnections.toFixed(1)}</span>
              </div>
              <div
                className="my-2 border-t"
                style={{ borderColor: "var(--color-border)" }}
              />
              <div className="flex justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  <span style={{ color: "var(--color-text-muted)" }}>Orphans</span>
                </span>
                <span className="font-medium text-red-400">{stats.orphanCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span style={{ color: "var(--color-text-muted)" }}>Hubs (5+ links)</span>
                </span>
                <span className="font-medium text-green-400">{stats.hubCount}</span>
              </div>
              {stats.mostConnected && stats.mostConnected.count > 0 && (
                <>
                  <div
                    className="my-2 border-t"
                    style={{ borderColor: "var(--color-border)" }}
                  />
                  <div>
                    <span style={{ color: "var(--color-text-muted)" }}>Most Connected</span>
                    <div className="mt-1 flex items-center justify-between">
                      <span
                        className="max-w-[140px] truncate font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {stats.mostConnected.title}
                      </span>
                      <span className="text-green-400">{stats.mostConnected.count}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Search results indicator */}
        {searchQuery && highlightedNodes.size > 0 && (
          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-400">
            Found {highlightedNodes.size} matching page{highlightedNodes.size !== 1 ? "s" : ""}
          </div>
        )}

        {/* Graph canvas */}
        <div ref={containerRef} className="flex-1 overflow-hidden">
          {filteredData.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mb-4 text-4xl opacity-20">
                  {showOrphansOnly ? "🏝️" : "🕸️"}
                </div>
                <p style={{ color: "var(--color-text-muted)" }}>
                  {showOrphansOnly
                    ? "No orphaned pages found. All pages are connected!"
                    : pages.length === 0
                    ? "No pages to display. Create some pages first."
                    : "No pages match your search."}
                </p>
              </div>
            </div>
          ) : (
            <svg ref={svgRef} className="h-full w-full" />
          )}
        </div>
      </div>

      {/* Enhanced legend */}
      <div
        className="border-t px-4 py-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: "var(--color-accent)" }}
            />
            <span>Selected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-green-500" />
            <span>Hub (5+ links)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-purple-500" />
            <span>Leaf (only incoming)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <span>Orphan (no links)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-amber-400" />
            <span>Search match</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-px w-6 bg-green-500" style={{ height: "2px" }} />
            <span>Bidirectional</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6" style={{ height: "2px", backgroundImage: "repeating-linear-gradient(to right, #8b5cf6 0, #8b5cf6 4px, transparent 4px, transparent 7px)" }} />
            <span>Block ref</span>
          </div>
          <span className="ml-auto">
            Scroll: zoom | Drag: move nodes | Click: navigate | Double-click: focus
          </span>
        </div>
      </div>
    </div>
  );
}
