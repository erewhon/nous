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

export interface PluginPanelType {
  pluginId: string;
  panelId: string;
  label: string;
  iconSvg?: string;
  defaultWidth?: number;
}

export interface PluginDecorationType {
  pluginId: string;
  decorationId: string;
  label: string;
  description?: string;
}

export interface PluginPageType {
  pluginId: string;
  pageTypeId: string;
  label: string;
  description?: string;
  iconSvg?: string;
}

interface PluginStore {
  plugins: PluginManifest[];
  commands: PluginCommand[];
  viewTypes: PluginViewType[];
  blockTypes: PluginBlockType[];
  exportFormats: PluginExportFormat[];
  importFormats: PluginImportFormat[];
  panelTypes: PluginPanelType[];
  openPanels: Set<string>; // Set of "pluginId:panelId"
  decorationTypes: PluginDecorationType[];
  pageTypes: PluginPageType[];
  loading: boolean;

  syncAiConfig: () => Promise<void>;
  fetchPlugins: () => Promise<void>;
  reloadPlugin: (pluginId: string) => Promise<void>;
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  fetchCommands: () => Promise<void>;
  executeCommand: (pluginId: string, commandId: string, context?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  fetchViewTypes: () => Promise<void>;
  renderView: (pluginId: string, viewType: string, content: unknown, view: unknown) => Promise<unknown>;
  handleViewAction: (pluginId: string, action: unknown) => Promise<unknown>;
  fetchBlockTypes: () => Promise<void>;
  renderBlock: (pluginId: string, blockType: string, data: unknown) => Promise<unknown>;
  handleBlockAction: (pluginId: string, action: unknown) => Promise<unknown>;
  fetchExportFormats: () => Promise<void>;
  executeExport: (pluginId: string, formatId: string, page: unknown, notebookId: string, options?: unknown) => Promise<unknown>;
  renderExportOptions: (pluginId: string, formatId: string) => Promise<unknown>;
  fetchImportFormats: () => Promise<void>;
  executeImport: (pluginId: string, formatId: string, fileContent: string, fileName: string, notebookId: string) => Promise<unknown>;
  fetchPanelTypes: () => Promise<void>;
  renderPanel: (pluginId: string, panelId: string, context: unknown) => Promise<unknown>;
  handlePanelAction: (pluginId: string, action: unknown) => Promise<unknown>;
  togglePanel: (pluginId: string, panelId: string) => void;
  isPanelOpen: (pluginId: string, panelId: string) => boolean;
  fetchDecorationTypes: () => Promise<void>;
  computeDecorations: (pluginId: string, decorationId: string, blocks: unknown) => Promise<unknown>;
  fetchPageTypes: () => Promise<void>;
  renderPage: (pluginId: string, pageTypeId: string, pageData: unknown) => Promise<unknown>;
  handlePageAction: (pluginId: string, action: unknown) => Promise<unknown>;
}

export const usePluginStore = create<PluginStore>((set) => ({
  plugins: [],
  commands: [],
  viewTypes: [],
  blockTypes: [],
  exportFormats: [],
  importFormats: [],
  panelTypes: [],
  openPanels: new Set<string>(),
  decorationTypes: [],
  pageTypes: [],
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

  fetchPanelTypes: async () => {
    try {
      const panelTypes = await invoke<PluginPanelType[]>("get_plugin_panel_types");
      set({ panelTypes });
    } catch (e) {
      console.error("Failed to fetch plugin panel types:", e);
    }
  },

  renderPanel: async (pluginId: string, panelId: string, context: unknown) => {
    return invoke("render_plugin_panel", { pluginId, panelId, context });
  },

  handlePanelAction: async (pluginId: string, action: unknown) => {
    return invoke("handle_plugin_panel_action", { pluginId, action });
  },

  togglePanel: (pluginId: string, panelId: string) => {
    set((state) => {
      const key = `${pluginId}:${panelId}`;
      const next = new Set(state.openPanels);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { openPanels: next };
    });
  },

  fetchDecorationTypes: async () => {
    try {
      const decorationTypes = await invoke<PluginDecorationType[]>("get_plugin_decoration_types");
      set({ decorationTypes });
    } catch (e) {
      console.error("Failed to fetch plugin decoration types:", e);
    }
  },

  computeDecorations: async (pluginId: string, decorationId: string, blocks: unknown) => {
    return invoke("compute_plugin_decorations", { pluginId, decorationId, blocks });
  },

  fetchPageTypes: async () => {
    try {
      const pageTypes = await invoke<PluginPageType[]>("get_plugin_page_types");
      set({ pageTypes });
    } catch (e) {
      console.error("Failed to fetch plugin page types:", e);
    }
  },

  renderPage: async (pluginId: string, pageTypeId: string, pageData: unknown) => {
    return invoke("render_plugin_page", { pluginId, pageTypeId, pageData });
  },

  handlePageAction: async (pluginId: string, action: unknown) => {
    return invoke("handle_plugin_page_action", { pluginId, action });
  },

  isPanelOpen: (pluginId: string, panelId: string): boolean => {
    return usePluginStore.getState().openPanels.has(`${pluginId}:${panelId}`);
  },
}));
