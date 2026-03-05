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

interface PluginStore {
  plugins: PluginManifest[];
  loading: boolean;

  fetchPlugins: () => Promise<void>;
  reloadPlugin: (pluginId: string) => Promise<void>;
}

export const usePluginStore = create<PluginStore>((set) => ({
  plugins: [],
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
}));
