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

interface PluginStore {
  plugins: PluginManifest[];
  commands: PluginCommand[];
  loading: boolean;

  fetchPlugins: () => Promise<void>;
  reloadPlugin: (pluginId: string) => Promise<void>;
  fetchCommands: () => Promise<void>;
  executeCommand: (pluginId: string, commandId: string) => Promise<void>;
}

export const usePluginStore = create<PluginStore>((set) => ({
  plugins: [],
  commands: [],
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
}));
