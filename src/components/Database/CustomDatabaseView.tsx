/**
 * Host for SDK-contributed database views (view type "custom").
 *
 * Resolves the contribution named by config.customViewId, validates its
 * config, applies the shared filter/sort pipeline, and hands the
 * contribution a narrow ctx: cell-level edits, add/delete row, its own
 * config patching, and the row detail sheet. A missing, disabled, or
 * config-invalid contribution renders a placeholder panel — the view row
 * and its config are never touched, so re-enabling restores it intact.
 */
import { useCallback, useMemo, useState } from "react";
import type {
  CellValue,
  CustomViewConfig,
  DatabaseContentV2,
  DatabaseRow,
  DatabaseView,
} from "../../types/database";
import { generateId } from "../../utils/generateId";
import { createDefaultRow } from "../../types/database";
import type { RelationContext } from "./useRelationContext";
import { applyViewToRows } from "./viewRows";
import { DatabaseRowDetail } from "./DatabaseRowDetail";
import { pickNextColor } from "./CellEditors";
import {
  getCustomDatabaseView,
  isCustomDatabaseViewEnabled,
  useDisabledCustomDatabaseViews,
  type DatabaseViewCtx,
} from "../../plugin-sdk/custom-database-view";

interface CustomDatabaseViewProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
  relationContext?: RelationContext;
  pageLinkPages?: Array<{ id: string; title: string }>;
  onNavigatePageLink?: (pageId: string) => void;
}

export function PlaceholderPanel({
  title,
  detail,
  canDelete,
  onDelete,
}: {
  title: string;
  detail: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="db-custom-view-placeholder" style={{ padding: "24px" }}>
      <div
        style={{
          border: "1px dashed var(--color-border, #8884)",
          borderRadius: "8px",
          padding: "16px",
          color: "var(--color-text-muted, #888)",
          fontSize: "0.9em",
        }}
      >
        <div style={{ fontWeight: 500, marginBottom: 4 }}>{title}</div>
        <div style={{ marginBottom: 12 }}>{detail}</div>
        <div>
          The view's configuration is preserved — re-enabling the
          contribution restores it.
          {canDelete && (
            <>
              {" "}
              <button
                onClick={onDelete}
                style={{
                  textDecoration: "underline",
                  color: "inherit",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  font: "inherit",
                }}
              >
                Delete this view
              </button>{" "}
              if it's no longer wanted.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CustomDatabaseView({
  content,
  view,
  onUpdateContent,
  onUpdateView,
  relationContext,
  pageLinkPages,
  onNavigatePageLink,
}: CustomDatabaseViewProps) {
  const disabled = useDisabledCustomDatabaseViews();
  const [detailRowId, setDetailRowId] = useState<string | null>(null);

  const config = view.config as CustomViewConfig;
  const customViewId = config?.customViewId ?? "";
  const contribution = getCustomDatabaseView(customViewId);

  // Resolve computed columns the same way DatabaseTable does, plus
  // back-relations (linked row ids) for parity with DatabaseList's display.
  const resolveCellValue = useCallback(
    (row: DatabaseRow, propertyId: string): CellValue => {
      const prop = content.properties.find((p) => p.id === propertyId);
      if (prop?.type === "formula") {
        return relationContext?.formulaValues.get(propertyId)?.get(row.id) ?? null;
      }
      if (prop?.type === "rollup") {
        return relationContext?.rollupValues.get(propertyId)?.get(row.id) ?? null;
      }
      if (prop?.type === "relation" && prop.relationConfig?.direction === "back") {
        return (
          relationContext?.backRelationValues.get(propertyId)?.get(row.id) ?? []
        );
      }
      return row.cells[propertyId] ?? null;
    },
    [content.properties, relationContext]
  );

  const rows = useMemo(
    () => applyViewToRows(content.rows, view, content.properties, resolveCellValue),
    [content.rows, view, content.properties, resolveCellValue]
  );

  const handleCellChange = useCallback(
    (rowId: string, propertyId: string, value: CellValue) => {
      onUpdateContent((prev) => ({
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === rowId
            ? {
                ...r,
                cells: { ...r.cells, [propertyId]: value },
                updatedAt: new Date().toISOString(),
              }
            : r
        ),
      }));
    },
    [onUpdateContent]
  );

  const ctx: DatabaseViewCtx = useMemo(
    () => ({
      getCellValue: (rowId, propertyId) => {
        const row = content.rows.find((r) => r.id === rowId);
        return row ? resolveCellValue(row, propertyId) : null;
      },
      updateCell: handleCellChange,
      addRow: (cells) => {
        onUpdateContent((prev) => {
          const row = createDefaultRow(prev.properties);
          return {
            ...prev,
            rows: [...prev.rows, { ...row, cells: { ...row.cells, ...cells } }],
          };
        });
      },
      deleteRow: (rowId) => {
        onUpdateContent((prev) => ({
          ...prev,
          rows: prev.rows.filter((r) => r.id !== rowId),
        }));
        setDetailRowId((current) => (current === rowId ? null : current));
      },
      updateConfig: (patch) => {
        onUpdateView((prev) => {
          const prevConfig = prev.config as CustomViewConfig;
          return {
            ...prev,
            config: {
              ...prev.config,
              viewConfig: { ...(prevConfig.viewConfig ?? {}), ...patch },
            },
          };
        });
      },
      openRow: (rowId) => setDetailRowId(rowId),
      readOnly: false,
    }),
    [content.rows, resolveCellValue, handleCellChange, onUpdateContent, onUpdateView]
  );

  // Select-option creation for the row detail sheet (Gallery's pattern).
  const handleAddSelectOption = useCallback(
    (propertyId: string, label: string) => {
      const existing =
        content.properties.find((p) => p.id === propertyId)?.options ?? [];
      const newOption = {
        id: generateId(),
        label,
        color: pickNextColor(existing),
      };
      onUpdateContent((prev) => ({
        ...prev,
        properties: prev.properties.map((p) =>
          p.id === propertyId
            ? { ...p, options: [...(p.options ?? []), newOption] }
            : p
        ),
      }));
      return newOption;
    },
    [content.properties, onUpdateContent]
  );

  const deleteThisView = useCallback(() => {
    onUpdateContent((prev) => ({
      ...prev,
      views: prev.views.filter((v) => v.id !== view.id),
    }));
  }, [onUpdateContent, view.id]);

  const canDelete = content.views.length > 1;

  if (!contribution) {
    return (
      <PlaceholderPanel
        title={`Unknown custom view "${customViewId || "(unset)"}"`}
        detail="No registered contribution provides this view — it may come from a newer version of Nous."
        canDelete={canDelete}
        onDelete={deleteThisView}
      />
    );
  }

  if (!isCustomDatabaseViewEnabled(contribution, disabled)) {
    return (
      <PlaceholderPanel
        title={`${contribution.label} is disabled`}
        detail="Enable it under Settings → Integrations → Custom Database Views."
        canDelete={canDelete}
        onDelete={deleteThisView}
      />
    );
  }

  let parsedConfig: unknown = config?.viewConfig ?? {};
  if (contribution.configSchema) {
    const result = contribution.configSchema.safeParse(config?.viewConfig ?? {});
    if (!result.success) {
      return (
        <PlaceholderPanel
          title={`${contribution.label}: invalid view configuration`}
          detail={result.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}
          canDelete={canDelete}
          onDelete={deleteThisView}
        />
      );
    }
    parsedConfig = result.data;
  }

  const detailRow = detailRowId
    ? content.rows.find((r) => r.id === detailRowId)
    : null;

  return (
    <>
      <contribution.Component
        rows={rows}
        properties={content.properties}
        config={parsedConfig}
        ctx={ctx}
      />
      {detailRow && (
        <DatabaseRowDetail
          row={detailRow}
          properties={content.properties}
          onCellChange={(propId, val) =>
            handleCellChange(detailRow.id, propId, val)
          }
          onAddSelectOption={handleAddSelectOption}
          onClose={() => setDetailRowId(null)}
          onDelete={() => ctx.deleteRow(detailRow.id)}
          relationContext={relationContext}
          pageLinkPages={pageLinkPages}
          onNavigatePageLink={onNavigatePageLink}
        />
      )}
    </>
  );
}
