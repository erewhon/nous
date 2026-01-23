import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { MCPServerConfig, MCPServersConfig, MCPTool } from "../types/mcp";

interface MCPState {
  // Configuration
  config: MCPServersConfig;

  // Runtime state
  runningServers: string[];
  availableTools: MCPTool[];

  // UI state
  isLoading: boolean;
  error: string | null;

  // Actions
  loadConfig: () => Promise<void>;
  saveConfig: (config: MCPServersConfig) => Promise<void>;
  addServer: (server: MCPServerConfig) => Promise<void>;
  updateServer: (name: string, updates: Partial<MCPServerConfig>) => Promise<void>;
  removeServer: (name: string) => Promise<void>;
  toggleServerEnabled: (name: string, enabled: boolean) => Promise<void>;
  startServers: () => Promise<void>;
  stopServers: () => Promise<void>;
  refreshTools: () => Promise<void>;
  refreshRunningServers: () => Promise<void>;
  clearError: () => void;
}

export const useMCPStore = create<MCPState>()((set, get) => ({
  config: { servers: [] },
  runningServers: [],
  availableTools: [],
  isLoading: false,
  error: null,

  loadConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const config = await invoke<MCPServersConfig>("mcp_load_config");
      set({ config, isLoading: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: `Failed to load MCP config: ${message}`, isLoading: false });
    }
  },

  saveConfig: async (config: MCPServersConfig) => {
    set({ isLoading: true, error: null });
    try {
      await invoke("mcp_save_config", { config });
      set({ config, isLoading: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: `Failed to save MCP config: ${message}`, isLoading: false });
    }
  },

  addServer: async (server: MCPServerConfig) => {
    const { config, saveConfig } = get();
    // Check for duplicate names
    if (config.servers.some((s) => s.name === server.name)) {
      set({ error: `Server with name "${server.name}" already exists` });
      return;
    }
    const newConfig = {
      ...config,
      servers: [...config.servers, server],
    };
    await saveConfig(newConfig);
  },

  updateServer: async (name: string, updates: Partial<MCPServerConfig>) => {
    const { config, saveConfig } = get();
    // Check for name conflict if renaming
    if (updates.name && updates.name !== name) {
      if (config.servers.some((s) => s.name === updates.name)) {
        set({ error: `Server with name "${updates.name}" already exists` });
        return;
      }
    }
    const newConfig = {
      ...config,
      servers: config.servers.map((s) =>
        s.name === name ? { ...s, ...updates } : s
      ),
    };
    await saveConfig(newConfig);
  },

  removeServer: async (name: string) => {
    const { config, saveConfig, runningServers, stopServers } = get();
    // Stop servers if the one being removed is running
    if (runningServers.includes(name)) {
      await stopServers();
    }
    const newConfig = {
      ...config,
      servers: config.servers.filter((s) => s.name !== name),
    };
    await saveConfig(newConfig);
  },

  toggleServerEnabled: async (name: string, enabled: boolean) => {
    const { updateServer } = get();
    await updateServer(name, { enabled });
  },

  startServers: async () => {
    set({ isLoading: true, error: null });
    try {
      const started = await invoke<string[]>("mcp_start_servers");
      set({ runningServers: started, isLoading: false });
      // Refresh tools after starting
      await get().refreshTools();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: `Failed to start MCP servers: ${message}`, isLoading: false });
    }
  },

  stopServers: async () => {
    set({ isLoading: true, error: null });
    try {
      await invoke("mcp_stop_servers");
      set({ runningServers: [], availableTools: [], isLoading: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: `Failed to stop MCP servers: ${message}`, isLoading: false });
    }
  },

  refreshTools: async () => {
    try {
      const tools = await invoke<MCPTool[]>("mcp_get_tools");
      set({ availableTools: tools });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: `Failed to refresh MCP tools: ${message}` });
    }
  },

  refreshRunningServers: async () => {
    try {
      const servers = await invoke<string[]>("mcp_get_running_servers");
      set({ runningServers: servers });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: `Failed to get running servers: ${message}` });
    }
  },

  clearError: () => set({ error: null }),
}));
