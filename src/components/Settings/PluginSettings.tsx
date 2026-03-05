import { useState, useEffect } from "react";
import { usePluginStore } from "../../stores/pluginStore";
import type { PluginManifest } from "../../stores/pluginStore";

// Capability flag names (matches Rust bitflags)
const CAPABILITY_NAMES: Record<number, string> = {
  0x001: "Page Read",
  0x002: "Page Write",
  0x004: "Database Read",
  0x008: "Database Write",
  0x010: "Inbox Capture",
  0x020: "Goals Read",
  0x040: "Goals Write",
  0x080: "Search",
  0x100: "Command Palette",
  0x200: "Network",
  0x400: "Energy Read",
  0x800: "Energy Write",
};

const HOOK_TYPE_LABELS: Record<string, string> = {
  goal_detector: "Goal Detector",
  action_step: "Action Step",
  command_palette: "Command Palette",
  on_page_created: "On Page Created",
  on_page_updated: "On Page Updated",
  on_page_deleted: "On Page Deleted",
  on_inbox_captured: "On Inbox Captured",
  on_goal_progress: "On Goal Progress",
};

function getCapabilityLabels(caps: number): string[] {
  const labels: string[] = [];
  for (const [bit, name] of Object.entries(CAPABILITY_NAMES)) {
    if (caps & Number(bit)) {
      labels.push(name);
    }
  }
  return labels;
}

function getSourceLabel(source: PluginManifest["source"]): string {
  if ("Builtin" in source) return "Built-in";
  if ("LuaFile" in source) return `Lua: ${source.LuaFile.path.split("/").pop()}`;
  if ("WasmFile" in source) return `WASM: ${source.WasmFile.wasm_path.split("/").pop()}`;
  return "Unknown";
}

export function PluginSettings() {
  const { plugins, loading, fetchPlugins, reloadPlugin } = usePluginStore();
  const [reloading, setReloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const handleReload = async (pluginId: string) => {
    setReloading(pluginId);
    setError(null);
    try {
      await reloadPlugin(pluginId);
    } catch (e) {
      setError(`Failed to reload ${pluginId}: ${e}`);
    } finally {
      setReloading(null);
    }
  };

  const userPlugins = plugins.filter((p) => !p.isBuiltin);
  const builtinPlugins = plugins.filter((p) => p.isBuiltin);

  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-lg font-semibold mb-1"
          style={{ color: "var(--color-text-primary)" }}
        >
          Plugins
        </h3>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Manage Lua and WASM plugins. Place <code>.lua</code> files in your
          library&apos;s <code>plugins/</code> folder.
        </p>
      </div>

      {error && (
        <div
          className="rounded-lg border px-3 py-2 text-sm"
          style={{
            backgroundColor: "var(--color-danger-bg, #fef2f2)",
            borderColor: "var(--color-danger-border, #fecaca)",
            color: "var(--color-danger-text, #dc2626)",
          }}
        >
          {error}
        </div>
      )}

      {loading && (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Loading plugins...
        </p>
      )}

      {/* User plugins */}
      <div>
        <h4
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text-secondary)" }}
        >
          User Plugins ({userPlugins.length})
        </h4>
        {userPlugins.length === 0 ? (
          <p
            className="text-sm italic"
            style={{ color: "var(--color-text-muted)" }}
          >
            No user plugins installed. Drop <code>.lua</code> files into your
            library&apos;s <code>plugins/</code> directory.
          </p>
        ) : (
          <div className="space-y-2">
            {userPlugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onReload={() => handleReload(plugin.id)}
                isReloading={reloading === plugin.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Built-in plugins */}
      <div>
        <h4
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Built-in Plugins ({builtinPlugins.length})
        </h4>
        {builtinPlugins.length === 0 ? (
          <p
            className="text-sm italic"
            style={{ color: "var(--color-text-muted)" }}
          >
            No built-in plugins loaded.
          </p>
        ) : (
          <div className="space-y-2">
            {builtinPlugins.map((plugin) => (
              <PluginCard key={plugin.id} plugin={plugin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PluginCard({
  plugin,
  onReload,
  isReloading,
}: {
  plugin: PluginManifest;
  onReload?: () => void;
  isReloading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const caps = getCapabilityLabels(plugin.capabilities);
  const hooks = plugin.hooks;

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s",
              }}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <span
            className="text-sm font-medium truncate"
            style={{ color: "var(--color-text-primary)" }}
          >
            {plugin.name}
          </span>
          <span
            className="text-xs shrink-0"
            style={{ color: "var(--color-text-muted)" }}
          >
            v{plugin.version}
          </span>
          {plugin.isBuiltin && (
            <span
              className="text-xs px-1.5 py-0.5 rounded shrink-0"
              style={{
                backgroundColor: "var(--color-accent-bg, rgba(59, 130, 246, 0.1))",
                color: "var(--color-accent)",
              }}
            >
              built-in
            </span>
          )}
        </div>
        {onReload && (
          <button
            onClick={onReload}
            disabled={isReloading}
            className="text-xs px-2 py-1 rounded transition-colors shrink-0"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
              opacity: isReloading ? 0.5 : 1,
            }}
          >
            {isReloading ? "Reloading..." : "Reload"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-2 pl-6 space-y-1.5">
          {plugin.description && (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {plugin.description}
            </p>
          )}
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            <span className="font-medium">ID:</span> {plugin.id}
          </div>
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            <span className="font-medium">Source:</span>{" "}
            {getSourceLabel(plugin.source)}
          </div>
          {caps.length > 0 && (
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              <span className="font-medium">Capabilities:</span>{" "}
              {caps.join(", ")}
            </div>
          )}
          {hooks.length > 0 && (
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              <span className="font-medium">Hooks:</span>{" "}
              {hooks.map((h) => {
                const label = HOOK_TYPE_LABELS[h.type] || h.type;
                return h.step_type ? `${label}: ${h.step_type}` : label;
              }).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
