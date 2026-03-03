/**
 * Hook for showing edit attribution tooltips when hovering over blocks
 * during an active collaboration session.
 *
 * Uses event delegation on a container element — single mouseenter listener
 * on the closest `.bn-block-group` ancestor. Reads attribution from the
 * CollabProvider's Y.Map("attribution").
 */

import { useEffect, useRef, useCallback } from "react";
import type { CollabProvider } from "../collab/CollabProvider";

function relativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

interface UseBlockAttributionOptions {
  /** The container element to attach the hover listener to */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The active CollabProvider (null when collab is inactive) */
  provider: CollabProvider | null;
  /** Whether attribution tooltips are enabled */
  enabled: boolean;
}

export function useBlockAttribution({
  containerRef,
  provider,
  enabled,
}: UseBlockAttributionOptions) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create or get the shared tooltip element
  const getTooltip = useCallback(() => {
    if (tooltipRef.current) return tooltipRef.current;

    const el = document.createElement("div");
    el.style.cssText = `
      position: fixed;
      z-index: 9999;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      line-height: 1.3;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      white-space: nowrap;
      background: var(--color-bg-elevated, #333);
      color: var(--color-text-secondary, #ccc);
      border: 1px solid var(--color-border, #444);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(el);
    tooltipRef.current = el;
    return el;
  }, []);

  // Show tooltip near a block element
  const showTooltip = useCallback((blockEl: HTMLElement, name: string, color: string, timestamp: number) => {
    const tooltip = getTooltip();
    const time = relativeTime(timestamp);

    tooltip.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px;vertical-align:middle"></span>
      <span style="vertical-align:middle">Last edited by <strong>${name}</strong>, ${time}</span>
    `;

    const rect = blockEl.getBoundingClientRect();
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.top - 28}px`;
    tooltip.style.opacity = "1";
  }, [getTooltip]);

  const hideTooltip = useCallback(() => {
    if (tooltipRef.current) {
      tooltipRef.current.style.opacity = "0";
    }
  }, []);

  useEffect(() => {
    if (!enabled || !provider || !containerRef.current) return;

    const container = containerRef.current;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Find the closest block group element
      const blockGroup = target.closest("[data-node-type='blockGroup']") as HTMLElement | null;
      if (!blockGroup) {
        hideTooltip();
        return;
      }

      // Try to get block ID from the block element
      const blockEl = blockGroup.querySelector("[data-id]") as HTMLElement | null;
      const blockId = blockEl?.getAttribute("data-id");
      if (!blockId) {
        hideTooltip();
        return;
      }

      const attribution = provider.getBlockAttribution(blockId);
      if (!attribution) {
        hideTooltip();
        return;
      }

      // Clear any pending hide
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      showTooltip(blockGroup, attribution.name, attribution.color, attribution.timestamp);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (!relatedTarget || !container.contains(relatedTarget)) {
        hideTimerRef.current = setTimeout(hideTooltip, 200);
      }
    };

    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);

    return () => {
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
      hideTooltip();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      // Clean up tooltip element
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
    };
  }, [enabled, provider, containerRef, showTooltip, hideTooltip]);
}
