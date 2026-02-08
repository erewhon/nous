import { useState, useEffect, useRef } from "react";
import type { PropertyDef, DatabaseContentV2 } from "../../types/database";
import { migrateDatabaseContent } from "../../types/database";
import type { RelationTarget } from "./CellEditors";
import * as api from "../../utils/api";

/**
 * Resolves relation targets for all relation properties in a database.
 * Loads target database contents and extracts row titles (first text property).
 *
 * Returns a map: propertyId -> RelationTarget[]
 */
export function useRelationData(
  notebookId: string | undefined,
  properties: PropertyDef[]
): Map<string, RelationTarget[]> {
  const [data, setData] = useState<Map<string, RelationTarget[]>>(new Map());
  // Cache loaded database content by pageId to avoid redundant fetches
  const cacheRef = useRef<Map<string, RelationTarget[]>>(new Map());

  useEffect(() => {
    if (!notebookId) return;

    const relationProps = properties.filter(
      (p) => p.type === "relation" && p.relationConfig?.databasePageId
    );

    if (relationProps.length === 0) {
      setData(new Map());
      return;
    }

    // Deduplicate target page IDs
    const targetPageIds = [
      ...new Set(relationProps.map((p) => p.relationConfig!.databasePageId)),
    ];

    let cancelled = false;

    const loadTargets = async () => {
      const pageTargets = new Map<string, RelationTarget[]>();

      for (const pageId of targetPageIds) {
        // Check cache
        if (cacheRef.current.has(pageId)) {
          pageTargets.set(pageId, cacheRef.current.get(pageId)!);
          continue;
        }

        try {
          const result = await api.getFileContent(notebookId, pageId);
          if (result.content) {
            const parsed = migrateDatabaseContent(JSON.parse(result.content));
            const targets = extractTargets(parsed);
            pageTargets.set(pageId, targets);
            cacheRef.current.set(pageId, targets);
          }
        } catch {
          // Target database might not exist or be empty
          pageTargets.set(pageId, []);
        }
      }

      if (cancelled) return;

      // Build property-level map
      const result = new Map<string, RelationTarget[]>();
      for (const prop of relationProps) {
        const targets = pageTargets.get(prop.relationConfig!.databasePageId) ?? [];
        result.set(prop.id, targets);
      }
      setData(result);
    };

    loadTargets();

    return () => {
      cancelled = true;
    };
  }, [notebookId, properties]);

  return data;
}

/** Extract row id + title (first text property value) from database content */
function extractTargets(content: DatabaseContentV2): RelationTarget[] {
  const titleProp = content.properties.find((p) => p.type === "text");
  return content.rows.map((row) => ({
    id: row.id,
    title: titleProp ? String(row.cells[titleProp.id] ?? "") : "",
  }));
}
