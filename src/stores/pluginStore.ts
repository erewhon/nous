import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  capabilities: number;
  hooks: Array<{ type: string; step_type?: string }>;
  isBuiltin: boolean;
  enabled: boolean;
  source:
    | { Builtin: null }
    | { LuaFile: { path: string } }
    | { WasmFile: { wasm_path: string; toml_path: string } };
}

export interface PluginCommand {
  pluginId: string;
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
}

export interface PluginViewType {
  pluginId: string;
  viewType: string;
  label: string;
  iconSvg?: string;
}

export interface PluginBlockType {
  pluginId: string;
  blockType: string;
  label: string;
  iconSvg?: string;
}

interface PluginStore {
  plugins: PluginManifest[];
  commands: PluginCommand[];
  viewTypes: PluginViewType[];
  blockTypes: PluginBlockType[];
  loading: boolean;

  fetchPlugins: () => Promise<void>;
  reloadPlugin: (pluginId: string) => Promise<void>;
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  fetchCommands: () => Promise<void>;
  executeCommand: (pluginId: string, commandId: string) => Promise<void>;
  fetchViewTypes: () => Promise<void>;
  renderView: (pluginId: string, viewType: string, content: unknown, view: unknown) => Promise<unknown>;
  handleViewAction: (pluginId: string, action: unknown) => Promise<unknown>;
  fetchBlockTypes: () => Promise<void>;
  renderBlock: (pluginId: string, blockType: string, data: unknown) => Promise<unknown>;
  handleBlockAction: (pluginId: string, action: unknown) => Promise<unknown>;
}

export const usePluginStore = create<PluginStore>((set) => ({
  plugins: [],
  commands: [],
  viewTypes: [],
  blockTypes: [],
  loading: false,

  fetchPlugins: async () => {
    set({ loading: true });
    try {
      const plugins = await invoke<PluginManifest[]>("list_plugins");
      set({ plugins, loading: false });
    } catch (e) {
      console.error("Failed to fetch plugins:", e);
      set({ loading: false });
    }
  },

  reloadPlugin: async (pluginId: string) => {
    try {
      await invoke("reload_plugin", { pluginId });
      // Refresh the list after reload
      const plugins = await invoke<PluginManifest[]>("list_plugins");
      set({ plugins });
    } catch (e) {
      console.error("Failed to reload plugin:", e);
      throw e;
    }
  },

  setPluginEnabled: async (pluginId: string, enabled: boolean) => {
    try {
      await invoke("set_plugin_enabled", { pluginId, enabled });
      const plugins = await invoke<PluginManifest[]>("list_plugins");
      set({ plugins });
    } catch (e) {
      console.error("Failed to set plugin enabled:", e);
      throw e;
    }
  },

  fetchCommands: async () => {
    try {
      const commands = await invoke<PluginCommand[]>("get_plugin_commands");
      set({ commands });
    } catch (e) {
      console.error("Failed to fetch plugin commands:", e);
    }
  },

  executeCommand: async (pluginId: string, commandId: string) => {
    try {
      await invoke("execute_plugin_command", { pluginId, commandId });
    } catch (e) {
      console.error("Failed to execute plugin command:", e);
      throw e;
    }
  },

  fetchViewTypes: async () => {
    try {
      const viewTypes = await invoke<PluginViewType[]>("get_plugin_view_types");
      set({ viewTypes });
    } catch (e) {
      console.error("Failed to fetch plugin view types:", e);
    }
  },

  renderView: async (pluginId: string, viewType: string, content: unknown, view: unknown) => {
    return invoke("render_plugin_view", { pluginId, viewType, content, view });
  },

  handleViewAction: async (pluginId: string, action: unknown) => {
    return invoke("handle_plugin_view_action", { pluginId, action });
  },

  fetchBlockTypes: async () => {
    try {
      const blockTypes = await invoke<PluginBlockType[]>("get_plugin_block_types");
      set({ blockTypes });
    } catch (e) {
      console.error("Failed to fetch plugin block types:", e);
    }
  },

  renderBlock: async (pluginId: string, blockType: string, data: unknown) => {
    return invoke("render_plugin_block", { pluginId, blockType, data });
  },

  handleBlockAction: async (pluginId: string, action: unknown) => {
    return invoke("handle_plugin_block_action", { pluginId, action });
  },
}));
