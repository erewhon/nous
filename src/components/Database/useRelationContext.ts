import { useState, useEffect, useRef, useCallback } from "react";
import type {
  DatabaseContentV2,
  CellValue,
  RollupAggregation,
} from "../../types/database";
import { migrateDatabaseContent } from "../../types/database";
import type { RelationTarget } from "./CellEditors";
import * as api from "../../utils/api";

export interface RelationContext {
  /** propertyId → picker targets (row id + title) */
  targets: Map<string, RelationTarget[]>;
  /** pageId → full database content */
  targetContents: Map<string, DatabaseContentV2>;
  /** back-relation propId → rowId → sourceRowIds */
  backRelationValues: Map<string, Map<string, string[]>>;
  /** rollup propId → rowId → computed value */
  rollupValues: Map<string, Map<string, CellValue>>;
  /** Edit a back-relation: mutates the source database */
  updateBackRelation: (
    backPropId: string,
    thisRowId: string,
    newSourceRowIds: string[]
  ) => Promise<void>;
}

/**
 * Replaces useRelationData. Loads target DB contents, computes back-relation
 * values, computes rollup values, and provides a mutation function for editing
 * back-relations.
 */
export function useRelationContext(
  notebookId: string | undefined,
  _thisPageId: string | undefined,
  content: DatabaseContentV2 | null
): RelationContext {
  const [targets, setTargets] = useState<Map<string, RelationTarget[]>>(
    new Map()
  );
  const [targetContents, setTargetContents] = useState<
    Map<string, DatabaseContentV2>
  >(new Map());
  const [backRelationValues, setBackRelationValues] = useState<
    Map<string, Map<string, string[]>>
  >(new Map());
  const [rollupValues, setRollupValues] = useState<
    Map<string, Map<string, CellValue>>
  >(new Map());

  const cacheRef = useRef<Map<string, DatabaseContentV2>>(new Map());

  const properties = content?.properties ?? [];
  const rows = content?.rows ?? [];

  // Load all target database contents
  useEffect(() => {
    if (!notebookId || !content) return;

    const relationProps = properties.filter(
      (p) =>
        (p.type === "relation" && p.relationConfig?.databasePageId) ||
        (p.type === "rollup" && p.rollupConfig)
    );

    if (relationProps.length === 0) {
      setTargets(new Map());
      setTargetContents(new Map());
      setBackRelationValues(new Map());
      setRollupValues(new Map());
      return;
    }

    // Collect all target page IDs from relation properties (forward + back)
    const allRelationProps = properties.filter(
      (p) => p.type === "relation" && p.relationConfig?.databasePageId
    );
    const targetPageIds = [
      ...new Set(allRelationProps.map((p) => p.relationConfig!.databasePageId)),
    ];

    let cancelled = false;

    const loadAll = async () => {
      const pageContents = new Map<string, DatabaseContentV2>();

      for (const pageId of targetPageIds) {
        if (cacheRef.current.has(pageId)) {
          pageContents.set(pageId, cacheRef.current.get(pageId)!);
          continue;
        }
        try {
          const result = await api.getFileContent(notebookId, pageId);
          if (result.content) {
            const parsed = migrateDatabaseContent(JSON.parse(result.content));
            pageContents.set(pageId, parsed);
            cacheRef.current.set(pageId, parsed);
          }
        } catch {
          // Target database might not exist
        }
      }

      if (cancelled) return;

      // Build targets map (propertyId → RelationTarget[])
      const targetsMap = new Map<string, RelationTarget[]>();
      for (const prop of allRelationProps) {
        const targetContent = pageContents.get(
          prop.relationConfig!.databasePageId
        );
        if (targetContent) {
          targetsMap.set(prop.id, extractTargets(targetContent));
        } else {
          targetsMap.set(prop.id, []);
        }
      }

      // Compute back-relation values
      const backMap = new Map<string, Map<string, string[]>>();
      const backRelationProps = allRelationProps.filter(
        (p) => p.relationConfig?.direction === "back"
      );
      for (const backProp of backRelationProps) {
        const sourcePageId = backProp.relationConfig!.databasePageId;
        const sourceContent = pageContents.get(sourcePageId);
        if (!sourceContent) continue;

        // Find the forward relation property in the source DB that points back to us
        const forwardPropId = backProp.relationConfig!.backRelationPropertyId;
        if (!forwardPropId) continue;

        const rowMap = computeBackRelationValues(
          rows,
          sourceContent,
          forwardPropId
        );
        backMap.set(backProp.id, rowMap);
      }

      // Compute rollup values
      const rollupMap = new Map<string, Map<string, CellValue>>();
      const rollupProps = properties.filter(
        (p) => p.type === "rollup" && p.rollupConfig
      );
      for (const rollupProp of rollupProps) {
        const cfg = rollupProp.rollupConfig!;
        const relationProp = properties.find(
          (p) => p.id === cfg.relationPropertyId
        );
        if (!relationProp || !relationProp.relationConfig) continue;

        const targetPageId = relationProp.relationConfig.databasePageId;
        const targetContent = pageContents.get(targetPageId);
        if (!targetContent) continue;

        const rowValues = new Map<string, CellValue>();
        const isBackRelation =
          relationProp.relationConfig.direction === "back";

        for (const row of rows) {
          let linkedRowIds: string[];
          if (isBackRelation) {
            linkedRowIds =
              backMap.get(relationProp.id)?.get(row.id) ?? [];
          } else {
            const cellVal = row.cells[relationProp.id];
            linkedRowIds = Array.isArray(cellVal) ? cellVal : [];
          }

          const computed = computeRollupValue(
            linkedRowIds,
            targetContent,
            cfg.targetPropertyId,
            cfg.aggregation
          );
          rowValues.set(row.id, computed);
        }
        rollupMap.set(rollupProp.id, rowValues);
      }

      setTargets(targetsMap);
      setTargetContents(pageContents);
      setBackRelationValues(backMap);
      setRollupValues(rollupMap);
    };

    loadAll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, properties, rows]);

  // Mutation: edit a back-relation by mutating the source database
  const updateBackRelation = useCallback(
    async (
      backPropId: string,
      thisRowId: string,
      newSourceRowIds: string[]
    ) => {
      if (!notebookId || !content) return;

      const backProp = properties.find((p) => p.id === backPropId);
      if (!backProp?.relationConfig) return;

      const sourcePageId = backProp.relationConfig.databasePageId;
      const forwardPropId = backProp.relationConfig.backRelationPropertyId;
      if (!forwardPropId) return;

      // Load the freshest version of the source DB
      let sourceContent: DatabaseContentV2;
      try {
        const result = await api.getFileContent(notebookId, sourcePageId);
        if (!result.content) return;
        sourceContent = migrateDatabaseContent(JSON.parse(result.content));
      } catch {
        return;
      }

      // Compute old linked source row IDs
      const oldSourceRowIds = new Set<string>();
      for (const srcRow of sourceContent.rows) {
        const cellVal = srcRow.cells[forwardPropId];
        const linked = Array.isArray(cellVal) ? cellVal : [];
        if (linked.includes(thisRowId)) {
          oldSourceRowIds.add(srcRow.id);
        }
      }

      const newSet = new Set(newSourceRowIds);

      // Diff: rows to add thisRowId to, rows to remove thisRowId from
      const toAdd = newSourceRowIds.filter((id) => !oldSourceRowIds.has(id));
      const toRemove = [...oldSourceRowIds].filter((id) => !newSet.has(id));

      if (toAdd.length === 0 && toRemove.length === 0) return;

      // Mutate source rows
      const updatedRows = sourceContent.rows.map((srcRow) => {
        if (toAdd.includes(srcRow.id)) {
          const current = Array.isArray(srcRow.cells[forwardPropId])
            ? (srcRow.cells[forwardPropId] as string[])
            : [];
          return {
            ...srcRow,
            cells: {
              ...srcRow.cells,
              [forwardPropId]: [...current, thisRowId],
            },
            updatedAt: new Date().toISOString(),
          };
        }
        if (toRemove.includes(srcRow.id)) {
          const current = Array.isArray(srcRow.cells[forwardPropId])
            ? (srcRow.cells[forwardPropId] as string[])
            : [];
          const filtered = current.filter((id) => id !== thisRowId);
          return {
            ...srcRow,
            cells: {
              ...srcRow.cells,
              [forwardPropId]: filtered.length > 0 ? filtered : null,
            },
            updatedAt: new Date().toISOString(),
          };
        }
        return srcRow;
      });

      const updatedSourceContent: DatabaseContentV2 = {
        ...sourceContent,
        rows: updatedRows,
      };

      // Save the source DB
      try {
        await api.updateFileContent(
          notebookId,
          sourcePageId,
          JSON.stringify(updatedSourceContent, null, 2)
        );
        // Invalidate cache so next render picks up changes
        cacheRef.current.delete(sourcePageId);
      } catch (err) {
        console.error("Failed to update back-relation source DB:", err);
      }
    },
    [notebookId, content, properties]
  );

  return {
    targets,
    targetContents,
    backRelationValues,
    rollupValues,
    updateBackRelation,
  };
}

/** Extract row id + title (first text property value) from database content */
function extractTargets(content: DatabaseContentV2): RelationTarget[] {
  const titleProp = content.properties.find((p) => p.type === "text");
  return content.rows.map((row) => ({
    id: row.id,
    title: titleProp ? String(row.cells[titleProp.id] ?? "") : "",
  }));
}

/**
 * For each row in this DB, find which source rows link to it via the
 * forward relation property.
 * Returns: thisRowId → sourceRowIds[]
 */
function computeBackRelationValues(
  thisRows: { id: string }[],
  sourceContent: DatabaseContentV2,
  sourceRelationPropId: string
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // Build reverse index: thisRowId → sourceRowIds that link to it
  for (const sourceRow of sourceContent.rows) {
    const cellVal = sourceRow.cells[sourceRelationPropId];
    const linkedIds = Array.isArray(cellVal) ? cellVal : [];
    for (const linkedId of linkedIds) {
      const existing = result.get(linkedId) ?? [];
      existing.push(sourceRow.id);
      result.set(linkedId, existing);
    }
  }

  // Ensure every row in this DB has an entry (even if empty)
  for (const row of thisRows) {
    if (!result.has(row.id)) {
      result.set(row.id, []);
    }
  }

  return result;
}

/**
 * Compute a rollup value from linked rows.
 */
function computeRollupValue(
  linkedRowIds: string[],
  targetContent: DatabaseContentV2,
  targetPropertyId: string,
  aggregation: RollupAggregation
): CellValue {
  const targetProp = targetContent.properties.find(
    (p) => p.id === targetPropertyId
  );
  if (!targetProp) return null;

  // Gather values from linked rows
  const values: CellValue[] = [];
  for (const rowId of linkedRowIds) {
    const row = targetContent.rows.find((r) => r.id === rowId);
    if (row) {
      values.push(row.cells[targetPropertyId] ?? null);
    }
  }

  const totalRows = linkedRowIds.length;

  switch (aggregation) {
    case "count":
      return totalRows;

    case "countValues": {
      return values.filter(
        (v) =>
          v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
      ).length;
    }

    case "countUnique": {
      const unique = new Set(
        values
          .filter(
            (v) =>
              v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
          )
          .map((v) => (Array.isArray(v) ? v.join(",") : String(v)))
      );
      return unique.size;
    }

    case "sum": {
      let total = 0;
      for (const v of values) {
        if (typeof v === "number") total += v;
      }
      return total;
    }

    case "average": {
      const nums = values.filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return null;
      return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
    }

    case "min": {
      const nums = values.filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return null;
      return Math.min(...nums);
    }

    case "max": {
      const nums = values.filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return null;
      return Math.max(...nums);
    }

    case "range": {
      const nums = values.filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return null;
      return Math.max(...nums) - Math.min(...nums);
    }

    case "percent_empty": {
      if (totalRows === 0) return null;
      const empty = values.filter(
        (v) =>
          v == null || v === "" || (Array.isArray(v) && v.length === 0)
      ).length;
      return Math.round((empty / totalRows) * 100);
    }

    case "percent_not_empty": {
      if (totalRows === 0) return null;
      const notEmpty = values.filter(
        (v) =>
          v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
      ).length;
      return Math.round((notEmpty / totalRows) * 100);
    }

    case "show_original": {
      // Join all non-null values as comma-separated string
      const strs = values
        .filter(
          (v) =>
            v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
        )
        .map((v) => {
          if (Array.isArray(v)) return v.join(", ");
          return String(v);
        });
      return strs.join(", ");
    }

    default:
      return null;
  }
}
