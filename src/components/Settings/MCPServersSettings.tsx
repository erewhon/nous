import { useState, useEffect } from "react";
import { useMCPStore } from "../../stores/mcpStore";
import type { MCPServerConfig } from "../../types/mcp";
import { createDefaultServerConfig } from "../../types/mcp";

export function MCPServersSettings() {
  const {
    config,
    runningServers,
    availableTools,
    isLoading,
    error,
    loadConfig,
    addServer,
    updateServer,
    removeServer,
    toggleServerEnabled,
    startServers,
    stopServers,
    refreshRunningServers,
    clearError,
  } = useMCPStore();

  const [isAddingServer, setIsAddingServer] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [newServer, setNewServer] = useState<MCPServerConfig>(createDefaultServerConfig());
  const [argsInput, setArgsInput] = useState("");
  const [envInput, setEnvInput] = useState("");

  // Load config on mount
  useEffect(() => {
    loadConfig();
    refreshRunningServers();
  }, [loadConfig, refreshRunningServers]);

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const handleAddServer = async () => {
    // Parse args from comma-separated string
    const args = argsInput
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    // Parse env from key=value format (one per line)
    const env: Record<string, string> = {};
    envInput.split("\n").forEach((line) => {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join("=").trim();
      }
    });

    const serverConfig = { ...newServer, args, env };
    await addServer(serverConfig);
    setIsAddingServer(false);
    setNewServer(createDefaultServerConfig());
    setArgsInput("");
    setEnvInput("");
  };

  const handleStartAll = async () => {
    await startServers();
  };

  const handleStopAll = async () => {
    await stopServers();
  };

  const isServerRunning = (name: string) => runningServers.includes(name);

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {error && (
        <div
          className="rounded-lg border p-3"
          style={{
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            borderColor: "rgba(239, 68, 68, 0.5)",
          }}
        >
          <p className="text-sm" style={{ color: "rgb(239, 68, 68)" }}>
            {error}
          </p>
        </div>
      )}

      {/* Info Banner */}
      <div
        className="flex items-start gap-3 rounded-lg border p-4"
        style={{
          backgroundColor: "rgba(139, 92, 246, 0.1)",
          borderColor: "var(--color-accent)",
        }}
      >
        <IconInfo style={{ color: "var(--color-accent)", flexShrink: 0, marginTop: 2 }} />
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            MCP Server Configuration
          </p>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Configure Model Context Protocol (MCP) servers to extend AI capabilities with external tools.
            Each server runs as a subprocess and provides tools that the AI can use during conversations.
          </p>
        </div>
      </div>

      {/* Server Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleStartAll}
            disabled={isLoading || config.servers.filter((s) => s.enabled).length === 0}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            <IconPlay />
            Start Servers
          </button>
          <button
            onClick={handleStopAll}
            disabled={isLoading || runningServers.length === 0}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <IconStop />
            Stop All
          </button>
        </div>
        <div className="flex items-center gap-2">
          {runningServers.length > 0 && (
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {runningServers.length} server{runningServers.length !== 1 ? "s" : ""} running
            </span>
          )}
        </div>
      </div>

      {/* Server List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Servers
          </h4>
          <button
            onClick={() => setIsAddingServer(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-accent)" }}
          >
            <IconPlus />
            Add Server
          </button>
        </div>

        {config.servers.length === 0 && !isAddingServer ? (
          <div
            className="rounded-lg border border-dashed p-6 text-center"
            style={{ borderColor: "var(--color-border)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              No MCP servers configured. Add a server to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {config.servers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                isRunning={isServerRunning(server.name)}
                isEditing={editingServer === server.name}
                onEdit={() => setEditingServer(server.name)}
                onCancelEdit={() => setEditingServer(null)}
                onUpdate={(updates) => updateServer(server.name, updates)}
                onRemove={() => removeServer(server.name)}
                onToggleEnabled={(enabled) => toggleServerEnabled(server.name, enabled)}
              />
            ))}
          </div>
        )}

        {/* Add Server Form */}
        {isAddingServer && (
          <div
            className="rounded-lg border p-4"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-accent)",
            }}
          >
            <h5
              className="mb-3 text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Add New Server
            </h5>
            <div className="space-y-3">
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Name *
                </label>
                <input
                  type="text"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  placeholder="e.g., filesystem"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Command *
                </label>
                <input
                  type="text"
                  value={newServer.command}
                  onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                  placeholder="e.g., npx, python, uvx"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Arguments (comma-separated)
                </label>
                <input
                  type="text"
                  value={argsInput}
                  onChange={(e) => setArgsInput(e.target.value)}
                  placeholder="e.g., -y, @modelcontextprotocol/server-filesystem, /path"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Environment Variables (KEY=value, one per line)
                </label>
                <textarea
                  value={envInput}
                  onChange={(e) => setEnvInput(e.target.value)}
                  placeholder="API_KEY=your-key"
                  rows={2}
                  className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setIsAddingServer(false);
                    setNewServer(createDefaultServerConfig());
                    setArgsInput("");
                    setEnvInput("");
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddServer}
                  disabled={!newServer.name || !newServer.command}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-accent)" }}
                >
                  Add Server
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Available Tools */}
      {availableTools.length > 0 && (
        <div>
          <h4
            className="mb-2 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Available Tools ({availableTools.length})
          </h4>
          <div
            className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
            }}
          >
            {availableTools.map((tool) => (
              <div
                key={`${tool.serverName}:${tool.name}`}
                className="flex items-start gap-2 rounded px-2 py-1.5"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(139, 92, 246, 0.2)",
                    color: "var(--color-accent)",
                  }}
                >
                  {tool.serverName}
                </span>
                <div className="flex-1">
                  <p
                    className="text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {tool.name}
                  </p>
                  {tool.description && (
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {tool.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Server Card Component
function ServerCard({
  server,
  isRunning,
  isEditing,
  onEdit,
  onCancelEdit,
  onUpdate,
  onRemove,
  onToggleEnabled,
}: {
  server: MCPServerConfig;
  isRunning: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdate: (updates: Partial<MCPServerConfig>) => void;
  onRemove: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const [editedServer, setEditedServer] = useState(server);
  const [argsInput, setArgsInput] = useState(server.args.join(", "));
  const [envInput, setEnvInput] = useState(
    Object.entries(server.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")
  );

  const handleSave = () => {
    const args = argsInput
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    const env: Record<string, string> = {};
    envInput.split("\n").forEach((line) => {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join("=").trim();
      }
    });

    onUpdate({ ...editedServer, args, env });
    onCancelEdit();
  };

  if (isEditing) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-accent)",
        }}
      >
        <div className="space-y-3">
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Name
            </label>
            <input
              type="text"
              value={editedServer.name}
              onChange={(e) => setEditedServer({ ...editedServer, name: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Command
            </label>
            <input
              type="text"
              value={editedServer.command}
              onChange={(e) => setEditedServer({ ...editedServer, command: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Arguments (comma-separated)
            </label>
            <input
              type="text"
              value={argsInput}
              onChange={(e) => setArgsInput(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Environment Variables
            </label>
            <textarea
              value={envInput}
              onChange={(e) => setEnvInput(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancelEdit}
              className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: server.enabled ? "var(--color-accent)" : "var(--color-border)",
        backgroundColor: server.enabled ? "rgba(139, 92, 246, 0.05)" : "transparent",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <div
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: isRunning
                ? "#22c55e"
                : server.enabled
                ? "var(--color-warning)"
                : "var(--color-text-muted)",
            }}
            title={isRunning ? "Running" : server.enabled ? "Enabled (not running)" : "Disabled"}
          />
          <div>
            <p
              className="font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              {server.name}
            </p>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {server.command} {server.args.join(" ")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Edit"
          >
            <IconEdit />
          </button>
          <button
            onClick={onRemove}
            className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Remove"
          >
            <IconTrash />
          </button>
          <button
            onClick={() => onToggleEnabled(!server.enabled)}
            className="relative h-5 w-9 rounded-full transition-colors"
            style={{
              backgroundColor: server.enabled
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{
                transform: server.enabled ? "translateX(16px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// Icons
function IconInfo({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function IconPlus() {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconEdit() {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash() {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
