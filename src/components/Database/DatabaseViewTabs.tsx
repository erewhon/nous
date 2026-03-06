import { useState, useRef, useEffect } from "react";
import type {
  DatabaseContentV2,
  DatabaseView,
  DatabaseViewType,
  PropertyDef,
  PluginViewConfig,
} from "../../types/database";
import { usePluginStore } from "../../stores/pluginStore";
import type { PluginViewType } from "../../stores/pluginStore";

interface DatabaseViewTabsProps {
  views: DatabaseView[];
  activeViewId: string;
  properties: PropertyDef[];
  onSelectView: (viewId: string) => void;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
}

const VIEW_TYPE_LABELS: Record<DatabaseViewType, string> = {
  table: "Table",
  board: "Board",
  gallery: "Gallery",
  list: "List",
  calendar: "Calendar",
  chart: "Chart",
  timeline: "Timeline",
  plugin: "Plugin",
};

function PluginViewIcon({ iconSvg }: { iconSvg?: string }) {
  if (iconSvg) {
    return (
      <span
        style={{ display: "inline-flex", width: 14, height: 14 }}
        dangerouslySetInnerHTML={{ __html: iconSvg }}
      />
    );
  }
  // Default plugin icon (puzzle piece)
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function ViewTypeIcon({ type }: { type: DatabaseViewType }) {
  switch (type) {
    case "table":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M3 15h18" />
          <path d="M9 3v18" />
        </svg>
      );
    case "board":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="5" height="18" rx="1" />
          <rect x="10" y="3" width="5" height="12" rx="1" />
          <rect x="17" y="3" width="5" height="15" rx="1" />
        </svg>
      );
    case "gallery":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "list":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
    case "calendar":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </svg>
      );
    case "chart":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="12" width="4" height="9" rx="1" />
          <rect x="10" y="5" width="4" height="16" rx="1" />
          <rect x="17" y="8" width="4" height="13" rx="1" />
        </svg>
      );
    case "timeline":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="14" height="3" rx="1.5" />
          <rect x="6" y="10" width="11" height="3" rx="1.5" />
          <rect x="4" y="16" width="16" height="3" rx="1.5" />
        </svg>
      );
    case "plugin":
      return <PluginViewIcon />;
  }
}

export function DatabaseViewTabs({
  views,
  activeViewId,
  properties,
  onSelectView,
  onUpdateContent,
}: DatabaseViewTabsProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const pluginViewTypes = usePluginStore((s) => s.viewTypes);

  useEffect(() => {
    usePluginStore.getState().fetchViewTypes();
  }, []);

  const [contextMenuViewId, setContextMenuViewId] = useState<string | null>(
    null
  );
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const addMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showAddMenu) return;
    const handle = (e: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as Node)
      ) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showAddMenu]);

  useEffect(() => {
    if (!contextMenuViewId) return;
    const handle = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenuViewId(null);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [contextMenuViewId]);

  useEffect(() => {
    if (renamingViewId) renameInputRef.current?.focus();
  }, [renamingViewId]);

  const hasSelectProperty = properties.some(
    (p) => p.type === "select" || p.type === "multiSelect"
  );
  const hasDateProperty = properties.some((p) => p.type === "date");

  const addView = (type: DatabaseViewType) => {
    const id = crypto.randomUUID();
    let config: DatabaseView["config"] = {};
    if (type === "board") {
      const selectProp = properties.find(
        (p) => p.type === "select" || p.type === "multiSelect"
      );
      if (!selectProp) return;
      config = { groupByPropertyId: selectProp.id };
    } else if (type === "calendar") {
      const dateProp = properties.find((p) => p.type === "date");
      if (!dateProp) return;
      config = { datePropertyId: dateProp.id };
    } else if (type === "chart") {
      const numProp = properties.find((p) => p.type === "number");
      const catProp = properties.find(
        (p) => p.type === "select" || p.type === "text"
      );
      config = {
        chartType: "bar" as const,
        xAxisPropertyId: catProp?.id ?? properties[0]?.id ?? "",
        yAxisPropertyId: numProp?.id,
        aggregation: numProp ? ("sum" as const) : ("count" as const),
      };
    } else if (type === "timeline") {
      const dateProp = properties.find((p) => p.type === "date");
      if (!dateProp) return;
      const dateProps = properties.filter((p) => p.type === "date");
      const textProp = properties.find((p) => p.type === "text");
      const selectProp = properties.find((p) => p.type === "select");
      config = {
        startDatePropertyId: dateProp.id,
        endDatePropertyId: dateProps.length > 1 ? dateProps[1].id : undefined,
        labelPropertyId: textProp?.id,
        colorPropertyId: selectProp?.id,
        showToday: true,
      };
    }

    const newView: DatabaseView = {
      id,
      name: VIEW_TYPE_LABELS[type],
      type,
      sorts: [],
      filters: [],
      config,
    };

    onUpdateContent((prev) => ({
      ...prev,
      views: [...prev.views, newView],
    }));
    onSelectView(id);
    setShowAddMenu(false);
  };

  const addPluginView = (pvt: PluginViewType) => {
    const id = crypto.randomUUID();
    const config: PluginViewConfig = {
      pluginId: pvt.pluginId,
      viewType: pvt.viewType,
    };
    const newView: DatabaseView = {
      id,
      name: pvt.label,
      type: "plugin",
      sorts: [],
      filters: [],
      config,
    };
    onUpdateContent((prev) => ({
      ...prev,
      views: [...prev.views, newView],
    }));
    onSelectView(id);
    setShowAddMenu(false);
  };

  const deleteView = (viewId: string) => {
    if (views.length <= 1) return;
    onUpdateContent((prev) => ({
      ...prev,
      views: prev.views.filter((v) => v.id !== viewId),
    }));
    if (activeViewId === viewId) {
      const remaining = views.filter((v) => v.id !== viewId);
      onSelectView(remaining[0]?.id ?? "");
    }
    setContextMenuViewId(null);
  };

  const duplicateView = (viewId: string) => {
    const source = views.find((v) => v.id === viewId);
    if (!source) return;
    const newId = crypto.randomUUID();
    const newView: DatabaseView = {
      ...source,
      id: newId,
      name: `${source.name} (copy)`,
    };
    onUpdateContent((prev) => ({
      ...prev,
      views: [...prev.views, newView],
    }));
    onSelectView(newId);
    setContextMenuViewId(null);
  };

  const startRename = (viewId: string) => {
    const view = views.find((v) => v.id === viewId);
    if (!view) return;
    setRenamingViewId(viewId);
    setRenameValue(view.name);
    setContextMenuViewId(null);
  };

  const commitRename = () => {
    if (!renamingViewId || !renameValue.trim()) {
      setRenamingViewId(null);
      return;
    }
    onUpdateContent((prev) => ({
      ...prev,
      views: prev.views.map((v) =>
        v.id === renamingViewId ? { ...v, name: renameValue.trim() } : v
      ),
    }));
    setRenamingViewId(null);
  };

  return (
    <div className="db-view-tabs-wrapper">
    <div className="db-view-tabs">
      {views.map((view) => (
        <div
          key={view.id}
          className={`db-view-tab ${view.id === activeViewId ? "db-view-tab-active" : ""}`}
          onClick={() => onSelectView(view.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenuPos({ x: e.clientX, y: e.clientY });
            setContextMenuViewId(view.id);
          }}
        >
          {view.type === "plugin" ? (
            <PluginViewIcon
              iconSvg={pluginViewTypes.find(
                (pvt) =>
                  pvt.pluginId === (view.config as PluginViewConfig)?.pluginId &&
                  pvt.viewType === (view.config as PluginViewConfig)?.viewType
              )?.iconSvg}
            />
          ) : (
            <ViewTypeIcon type={view.type} />
          )}
          {renamingViewId === view.id ? (
            <input
              ref={renameInputRef}
              className="db-view-tab-rename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenamingViewId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="db-view-tab-name">{view.name}</span>
          )}

        </div>
      ))}
    </div>

      {/* Context menu rendered outside .db-view-tabs to avoid overflow clipping */}
      {contextMenuViewId && (
        <div
          ref={contextMenuRef}
          className="db-view-tab-menu"
          style={{
            position: "fixed",
            top: contextMenuPos.y,
            left: contextMenuPos.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="db-view-tab-menu-item"
            onClick={() => startRename(contextMenuViewId)}
          >
            Rename
          </button>
          <button
            className="db-view-tab-menu-item"
            onClick={() => duplicateView(contextMenuViewId)}
          >
            Duplicate
          </button>
          {views.length > 1 && (
            <button
              className="db-view-tab-menu-item db-view-tab-menu-item-danger"
              onClick={() => deleteView(contextMenuViewId)}
            >
              Delete
            </button>
          )}
        </div>
      )}

      <div className="db-view-tabs-add" ref={addMenuRef}>
        <button
          className="db-view-tabs-add-btn"
          onClick={() => setShowAddMenu(!showAddMenu)}
          title="Add view"
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
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        {showAddMenu && (
          <div className="db-view-tabs-add-menu">
            {(
              [
                "table",
                "list",
                "board",
                "gallery",
                "calendar",
                "chart",
                "timeline",
              ] as DatabaseViewType[]
            ).map((type) => {
              const disabled =
                (type === "board" && !hasSelectProperty) ||
                (type === "calendar" && !hasDateProperty) ||
                (type === "timeline" && !hasDateProperty);
              return (
                <button
                  key={type}
                  className={`db-view-tabs-add-option ${disabled ? "db-view-tabs-add-option-disabled" : ""}`}
                  onClick={() => !disabled && addView(type)}
                  disabled={disabled}
                >
                  <ViewTypeIcon type={type} />
                  <span>{VIEW_TYPE_LABELS[type]}</span>
                  {disabled && (
                    <span className="db-view-tabs-add-hint">
                      {type === "board"
                        ? "Needs select property"
                        : type === "calendar" || type === "timeline"
                          ? "Needs date property"
                          : "Needs date property"}
                    </span>
                  )}
                </button>
              );
            })}
            {pluginViewTypes.length > 0 && (
              <>
                <div className="db-view-tabs-add-separator" />
                {pluginViewTypes.map((pvt) => (
                  <button
                    key={`${pvt.pluginId}:${pvt.viewType}`}
                    className="db-view-tabs-add-option"
                    onClick={() => addPluginView(pvt)}
                  >
                    <PluginViewIcon iconSvg={pvt.iconSvg} />
                    <span>{pvt.label}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
