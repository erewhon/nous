import { create } from "zustand";
import { invoke } from "../platform/core";

// Plugin lifecycle + non-UI contributions (palette commands, import/export
// formats). The Lua/iframe UI-rendering surfaces (blocks, database views,
// page types, sidebar panels, decorations) were retired in favor of the
// typed plugin-SDK contribution points; daemon decorations now run through
// the document-processor host (see daemonDecorationsProcessor).

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

export interface PluginExportFormat {
  pluginId: string;
  formatId: string;
  label: string;
  fileExtension: string;
  mimeType: string;
  iconSvg?: string;
  acceptsOptions: boolean;
}

export interface PluginImportFormat {
  pluginId: string;
  formatId: string;
  label: string;
  fileExtensions: string[];
  description?: string;
  iconSvg?: string;
}

interface PluginStore {
  plugins: PluginManifest[];
  commands: PluginCommand[];
  exportFormats: PluginExportFormat[];
  importFormats: PluginImportFormat[];
  loading: boolean;

  syncAiConfig: () => Promise<void>;
  fetchPlugins: () => Promise<void>;
  reloadPlugin: (pluginId: string) => Promise<void>;
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  fetchCommands: () => Promise<void>;
  executeCommand: (pluginId: string, commandId: string, context?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  fetchExportFormats: () => Promise<void>;
  executeExport: (pluginId: string, formatId: string, page: unknown, notebookId: string, options?: unknown) => Promise<unknown>;
  renderExportOptions: (pluginId: string, formatId: string) => Promise<unknown>;
  fetchImportFormats: () => Promise<void>;
  executeImport: (pluginId: string, formatId: string, fileContent: string, fileName: string, notebookId: string) => Promise<unknown>;
}

export const usePluginStore = create<PluginStore>((set) => ({
  plugins: [],
  commands: [],
  exportFormats: [],
  importFormats: [],
  loading: false,

  syncAiConfig: async () => {
    try {
      // Dynamically import to avoid circular dependency
      const { useAIStore } = await import("./aiStore");
      const store = useAIStore.getState();
      const providerType = store.getActiveProviderType();
      const apiKey = store.getActiveApiKey();
      const model = store.getActiveModel();
      const baseUrl = store.getActiveBaseUrl();
      await invoke("set_plugin_ai_config", {
        providerType,
        apiKey: apiKey || null,
        baseUrl: baseUrl || null,
        model: model || null,
      });
    } catch (e) {
      console.error("Failed to sync AI config to plugins:", e);
    }
  },

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

  executeCommand: async (pluginId: string, commandId: string, context?: Record<string, unknown>) => {
    try {
      const result = await invoke<Record<string, unknown>>("execute_plugin_command", {
        pluginId,
        commandId,
        context: context ?? null,
      });
      return result;
    } catch (e) {
      console.error("Failed to execute plugin command:", e);
      throw e;
    }
  },

  fetchExportFormats: async () => {
    try {
      const exportFormats = await invoke<PluginExportFormat[]>("get_plugin_export_formats");
      set({ exportFormats });
    } catch (e) {
      console.error("Failed to fetch plugin export formats:", e);
    }
  },

  executeExport: async (pluginId: string, formatId: string, page: unknown, notebookId: string, options?: unknown) => {
    return invoke("execute_plugin_export", { pluginId, formatId, page, notebookId, options: options ?? {} });
  },

  renderExportOptions: async (pluginId: string, formatId: string) => {
    return invoke("render_export_options", { pluginId, formatId });
  },

  fetchImportFormats: async () => {
    try {
      const importFormats = await invoke<PluginImportFormat[]>("get_plugin_import_formats");
      set({ importFormats });
    } catch (e) {
      console.error("Failed to fetch plugin import formats:", e);
    }
  },

  executeImport: async (pluginId: string, formatId: string, fileContent: string, fileName: string, notebookId: string) => {
    return invoke("execute_plugin_import", { pluginId, formatId, fileContent, fileName, notebookId });
  },
}));
