import { useState } from "react";
import { useAIStore, DEFAULT_SYSTEM_PROMPT } from "../../stores/aiStore";
import { useWebResearchStore } from "../../stores/webResearchStore";
import { ThemeSettings } from "./ThemeSettings";
import { KeybindingsSettings } from "./KeybindingsSettings";
import { MCPServersSettings } from "./MCPServersSettings";
import { RAGSettings } from "./RAGSettings";
import { BackupScheduleSettings } from "./BackupScheduleSettings";
import { LibrarySettingsPanel } from "../Library";
import type { ProviderType, ProviderConfig } from "../../types/ai";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "ai" | "web-research" | "theme" | "system-prompt" | "libraries" | "keybindings" | "mcp" | "rag" | "backup";
}

type TabId = "ai" | "web-research" | "theme" | "system-prompt" | "libraries" | "keybindings" | "mcp" | "rag" | "backup";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "theme", label: "Appearance", icon: <IconPalette /> },
  { id: "keybindings", label: "Shortcuts", icon: <IconKeyboard /> },
  { id: "libraries", label: "Libraries", icon: <IconLibrary /> },
  { id: "backup", label: "Backup", icon: <IconBackup /> },
  { id: "ai", label: "AI Providers", icon: <IconSparkles /> },
  { id: "rag", label: "Semantic Search", icon: <IconBrain /> },
  { id: "system-prompt", label: "System Prompt", icon: <IconPrompt /> },
  { id: "mcp", label: "MCP Servers", icon: <IconPlug /> },
  { id: "web-research", label: "Web Research", icon: <IconGlobe /> },
];

const PROVIDER_INFO: Record<ProviderType, { label: string; description: string; needsApiKey: boolean; needsRegion?: boolean; apiKeyPlaceholder?: string }> = {
  openai: {
    label: "OpenAI",
    description: "GPT-4o, GPT-4, o1 models",
    needsApiKey: true,
  },
  anthropic: {
    label: "Anthropic",
    description: "Claude Sonnet, Opus, Haiku",
    needsApiKey: true,
  },
  ollama: {
    label: "Ollama",
    description: "Local models (Llama, Mistral, etc.)",
    needsApiKey: false,
  },
  lmstudio: {
    label: "LM Studio",
    description: "Local models via LM Studio",
    needsApiKey: false,
  },
  bedrock: {
    label: "AWS Bedrock",
    description: "Claude, Titan, Llama via AWS",
    needsApiKey: true,
    needsRegion: true,
    apiKeyPlaceholder: "access_key:secret_key (or leave empty for IAM)",
  },
};

export function SettingsDialog({ isOpen, onClose, initialTab = "theme" }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative flex h-[600px] w-full max-w-2xl overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-panel)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div
          className="w-48 flex-shrink-0 border-r p-4"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <div className="mb-6">
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Settings
            </h2>
          </div>

          <nav className="space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? ""
                    : "hover:bg-[--color-bg-tertiary]"
                }`}
                style={{
                  backgroundColor: activeTab === tab.id ? "rgba(139, 92, 246, 0.15)" : undefined,
                  color: activeTab === tab.id ? "var(--color-accent)" : "var(--color-text-secondary)",
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col">
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-6 py-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h3
              className="text-base font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {TABS.find((t) => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              <IconX />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "theme" && <ThemeSettings />}
            {activeTab === "keybindings" && <KeybindingsSettings />}
            {activeTab === "libraries" && <LibrarySettingsPanel />}
            {activeTab === "backup" && <BackupScheduleSettings />}
            {activeTab === "ai" && <AISettingsContent />}
            {activeTab === "rag" && <RAGSettings />}
            {activeTab === "system-prompt" && <SystemPromptSettingsContent />}
            {activeTab === "mcp" && <MCPServersSettings />}
            {activeTab === "web-research" && <WebResearchSettingsContent />}
          </div>
        </div>
      </div>
    </div>
  );
}

// AI Settings Content
function AISettingsContent() {
  const {
    settings,
    setProviderEnabled,
    setProviderApiKey,
    setProviderBaseUrl,
    toggleModel,
    addModel,
    removeModel,
    setDefaultProvider,
    setDefaultModel,
    setTemperature,
    setMaxTokens,
    isDiscoveringModels,
    discoverModels,
  } = useAIStore();

  const [expandedProvider, setExpandedProvider] = useState<ProviderType | null>(
    settings.defaultProvider
  );
  const [discoveryResult, setDiscoveryResult] = useState<Record<string, string>>({});
  const [showApiKeys, setShowApiKeys] = useState<Record<ProviderType, boolean>>({
    openai: false,
    anthropic: false,
    ollama: false,
    lmstudio: false,
    bedrock: false,
  });
  const [newModelInputs, setNewModelInputs] = useState<Record<ProviderType, string>>({
    openai: "",
    anthropic: "",
    ollama: "",
    lmstudio: "",
    bedrock: "",
  });

  const toggleApiKeyVisibility = (type: ProviderType) => {
    setShowApiKeys((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const handleAddModel = (type: ProviderType) => {
    const modelName = newModelInputs[type].trim();
    if (modelName) {
      addModel(type, { id: modelName, name: modelName });
      setNewModelInputs((prev) => ({ ...prev, [type]: "" }));
    }
  };

  const handleDiscoverModels = async (type: ProviderType) => {
    setDiscoveryResult((prev) => ({ ...prev, [type]: "" }));
    try {
      const result = await discoverModels(type);
      if (result.found === 0) {
        setDiscoveryResult((prev) => ({ ...prev, [type]: "No models found. Is the server running?" }));
      } else {
        setDiscoveryResult((prev) => ({
          ...prev,
          [type]: `Found ${result.found} model${result.found !== 1 ? "s" : ""}, added ${result.added} new`,
        }));
      }
    } catch {
      setDiscoveryResult((prev) => ({
        ...prev,
        [type]: "Failed to connect. Is the server running?",
      }));
    }
  };

  // Get enabled models for the default model dropdown
  const enabledModels = settings.providers
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models.filter((m) => m.enabled).map((m) => ({
        provider: p.type,
        model: m,
        displayName: `${PROVIDER_INFO[p.type].label}: ${m.name}`,
      }))
    );

  return (
    <div className="space-y-6">
      {/* Provider Accordions */}
      <div className="space-y-2">
        {settings.providers.map((provider) => (
          <ProviderAccordion
            key={provider.type}
            provider={provider}
            info={PROVIDER_INFO[provider.type]}
            isExpanded={expandedProvider === provider.type}
            onToggleExpand={() =>
              setExpandedProvider(
                expandedProvider === provider.type ? null : provider.type
              )
            }
            onToggleEnabled={(enabled) => setProviderEnabled(provider.type, enabled)}
            showApiKey={showApiKeys[provider.type]}
            onToggleApiKeyVisibility={() => toggleApiKeyVisibility(provider.type)}
            onApiKeyChange={(key) => setProviderApiKey(provider.type, key)}
            onBaseUrlChange={(url) => setProviderBaseUrl(provider.type, url)}
            onToggleModel={(modelId, enabled) =>
              toggleModel(provider.type, modelId, enabled)
            }
            onRemoveModel={(modelId) => removeModel(provider.type, modelId)}
            newModelInput={newModelInputs[provider.type]}
            onNewModelInputChange={(value) =>
              setNewModelInputs((prev) => ({ ...prev, [provider.type]: value }))
            }
            onAddModel={() => handleAddModel(provider.type)}
            isDiscovering={isDiscoveringModels}
            discoveryResult={discoveryResult[provider.type]}
            onDiscoverModels={() => handleDiscoverModels(provider.type)}
          />
        ))}
      </div>

      {/* Default Settings Section */}
      <div
        className="rounded-lg border p-4"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <h4
          className="mb-4 text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Default Settings
        </h4>

        <div className="space-y-4">
          {/* Default Provider */}
          <div>
            <label
              className="mb-2 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Default Provider
            </label>
            <select
              value={settings.defaultProvider}
              onChange={(e) => setDefaultProvider(e.target.value as ProviderType)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent] dark-select"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              {settings.providers
                .filter((p) => p.enabled)
                .map((p) => (
                  <option key={p.type} value={p.type}>
                    {PROVIDER_INFO[p.type].label}
                  </option>
                ))}
              {settings.providers.filter((p) => p.enabled).length === 0 && (
                <option value="" disabled>
                  Enable a provider first
                </option>
              )}
            </select>
          </div>

          {/* Default Model */}
          <div>
            <label
              className="mb-2 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Default Model
            </label>
            <select
              value={settings.defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent] dark-select"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              {enabledModels.map(({ provider, model, displayName }) => (
                <option key={`${provider}:${model.id}`} value={model.id}>
                  {displayName}
                </option>
              ))}
              {enabledModels.length === 0 && (
                <option value="" disabled>
                  No models enabled
                </option>
              )}
            </select>
          </div>

          {/* Temperature */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Temperature
              </label>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {settings.temperature.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-[--color-accent]"
            />
            <div
              className="mt-1 flex justify-between text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <label
              className="mb-2 block text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Max Tokens
            </label>
            <input
              type="number"
              min="100"
              max="32000"
              step="100"
              value={settings.maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Provider Accordion Component
function ProviderAccordion({
  provider,
  info,
  isExpanded,
  onToggleExpand,
  onToggleEnabled,
  showApiKey,
  onToggleApiKeyVisibility,
  onApiKeyChange,
  onBaseUrlChange,
  onToggleModel,
  onRemoveModel,
  newModelInput,
  onNewModelInputChange,
  onAddModel,
  isDiscovering,
  discoveryResult,
  onDiscoverModels,
}: {
  provider: ProviderConfig;
  info: { label: string; description: string; needsApiKey: boolean; needsRegion?: boolean; apiKeyPlaceholder?: string };
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  showApiKey: boolean;
  onToggleApiKeyVisibility: () => void;
  onApiKeyChange: (key: string) => void;
  onBaseUrlChange: (url: string) => void;
  onToggleModel: (modelId: string, enabled: boolean) => void;
  onRemoveModel: (modelId: string) => void;
  newModelInput: string;
  onNewModelInputChange: (value: string) => void;
  onAddModel: () => void;
  isDiscovering?: boolean;
  discoveryResult?: string;
  onDiscoverModels?: () => void;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        borderColor: provider.enabled
          ? "var(--color-accent)"
          : "var(--color-border)",
        backgroundColor: provider.enabled
          ? "rgba(139, 92, 246, 0.05)"
          : "transparent",
      }}
    >
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span style={{ color: "var(--color-text-muted)" }}>
            {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
          </span>
          <div>
            <div
              className="font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              {info.label}
            </div>
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {info.description}
            </div>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleEnabled(!provider.enabled);
          }}
          className="relative h-5 w-9 rounded-full transition-colors"
          style={{
            backgroundColor: provider.enabled
              ? "var(--color-accent)"
              : "var(--color-bg-tertiary)",
          }}
        >
          <span
            className="absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
            style={{
              transform: provider.enabled ? "translateX(18px)" : "translateX(2px)",
            }}
          />
        </button>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div
          className="border-t px-3 pb-3 pt-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          {/* API Key (for cloud providers) */}
          {info.needsApiKey && (
            <div className="mb-4">
              <label
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                {provider.type === "bedrock" ? "AWS Credentials" : "API Key"}
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={provider.apiKey || ""}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder={info.apiKeyPlaceholder || `Enter your ${info.label} API key`}
                  className="w-full rounded-lg border px-3 py-2 pr-10 text-sm outline-none transition-colors focus:border-[--color-accent]"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
                <button
                  type="button"
                  onClick={onToggleApiKeyVisibility}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 transition-colors hover:bg-[--color-bg-secondary]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {showApiKey ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                {provider.type === "openai" && "Get your API key from platform.openai.com"}
                {provider.type === "anthropic" && "Get your API key from console.anthropic.com"}
                {provider.type === "bedrock" && "Format: ACCESS_KEY:SECRET_KEY or leave empty for IAM/env credentials"}
              </p>
            </div>
          )}

          {/* AWS Region (for Bedrock) */}
          {info.needsRegion && (
            <div className="mb-4">
              <label
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                AWS Region
              </label>
              <select
                value={provider.baseUrl || "us-east-1"}
                onChange={(e) => onBaseUrlChange(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent] dark-select"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                <option value="us-east-1">US East (N. Virginia)</option>
                <option value="us-west-2">US West (Oregon)</option>
                <option value="eu-west-1">Europe (Ireland)</option>
                <option value="eu-central-1">Europe (Frankfurt)</option>
                <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
                <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                <option value="ap-south-1">Asia Pacific (Mumbai)</option>
              </select>
              <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                Select the AWS region where Bedrock is enabled
              </p>
            </div>
          )}

          {/* Base URL (for local providers) */}
          {!info.needsApiKey && !info.needsRegion && (
            <div className="mb-4">
              <label
                className="mb-1.5 block text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Server URL
              </label>
              <input
                type="text"
                value={provider.baseUrl || ""}
                onChange={(e) => onBaseUrlChange(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
              <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                {provider.type === "ollama"
                  ? "Make sure Ollama is running locally"
                  : "Make sure LM Studio is running with local server enabled"}
              </p>
            </div>
          )}

          {/* Models */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="text-xs font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Available Models
              </label>
              {(provider.type === "ollama" || provider.type === "lmstudio") && onDiscoverModels && (
                <button
                  onClick={onDiscoverModels}
                  disabled={isDiscovering}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors hover:bg-[--color-bg-tertiary] disabled:opacity-50"
                  style={{ color: "var(--color-accent)" }}
                >
                  {isDiscovering ? (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <IconRefresh />
                  )}
                  {isDiscovering ? "Discovering..." : "Discover Models"}
                </button>
              )}
            </div>
            {discoveryResult && (
              <p className="mb-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                {discoveryResult}
              </p>
            )}
            <div className="space-y-1.5">
              {provider.models.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between rounded-md px-2 py-1.5"
                  style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                >
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      onChange={(e) => onToggleModel(model.id, e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-gray-300 accent-[--color-accent]"
                    />
                    <span
                      className="text-sm"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {model.name}
                    </span>
                    {model.isCustom && (
                      <span
                        className="rounded px-1.5 py-0.5 text-xs"
                        style={{
                          backgroundColor: "var(--color-bg-secondary)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        Custom
                      </span>
                    )}
                  </label>
                  {model.isCustom && (
                    <button
                      onClick={() => onRemoveModel(model.id)}
                      className="rounded p-1 transition-colors hover:bg-[--color-bg-secondary]"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <IconX />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add Custom Model */}
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={newModelInput}
                onChange={(e) => onNewModelInputChange(e.target.value)}
                placeholder="Add custom model..."
                className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddModel();
                  }
                }}
              />
              <button
                onClick={onAddModel}
                disabled={!newModelInput.trim()}
                className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Web Research Settings Content
function WebResearchSettingsContent() {
  const {
    settings,
    setTavilyApiKey,
    setMaxResults,
    setSearchDepth,
    setIncludeAnswer,
  } = useWebResearchStore();

  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <div className="space-y-6">
      {/* Tavily API Key */}
      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Tavily API Key
        </label>
        <div className="relative">
          <input
            type={showApiKey ? "text" : "password"}
            value={settings.tavilyApiKey}
            onChange={(e) => setTavilyApiKey(e.target.value)}
            placeholder="Enter your Tavily API key"
            className="w-full rounded-lg border px-3 py-2.5 pr-10 text-sm outline-none transition-colors focus:border-[--color-accent]"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {showApiKey ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>
        <p
          className="mt-1.5 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Get your API key from{" "}
          <a
            href="https://tavily.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[--color-accent] hover:underline"
          >
            tavily.com
          </a>
        </p>
      </div>

      {/* Max Results */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Max Results
          </label>
          <span
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {settings.maxResults}
          </span>
        </div>
        <input
          type="range"
          min="5"
          max="20"
          step="1"
          value={settings.maxResults}
          onChange={(e) => setMaxResults(parseInt(e.target.value))}
          className="w-full accent-[--color-accent]"
        />
        <div
          className="mt-1 flex justify-between text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span>5</span>
          <span>20</span>
        </div>
      </div>

      {/* Search Depth */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Search Depth
        </label>
        <div className="space-y-2">
          {(
            [
              {
                value: "basic",
                label: "Basic",
                description: "Faster, fewer results",
              },
              {
                value: "advanced",
                label: "Advanced",
                description: "More thorough, slower",
              },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              onClick={() => setSearchDepth(option.value)}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
              style={{
                borderColor:
                  settings.searchDepth === option.value
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  settings.searchDepth === option.value
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
              }}
            >
              <div
                className="flex h-4 w-4 items-center justify-center rounded-full border-2"
                style={{
                  borderColor:
                    settings.searchDepth === option.value
                      ? "var(--color-accent)"
                      : "var(--color-text-muted)",
                }}
              >
                {settings.searchDepth === option.value && (
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "var(--color-accent)" }}
                  />
                )}
              </div>
              <div>
                <div
                  className="font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {option.label}
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {option.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Include AI Answer */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <label
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Include AI Answer
            </label>
            <p
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Get a direct AI-generated answer with search results
            </p>
          </div>
          <button
            onClick={() => setIncludeAnswer(!settings.includeAnswer)}
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{
              backgroundColor: settings.includeAnswer
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{
                transform: settings.includeAnswer
                  ? "translateX(22px)"
                  : "translateX(2px)",
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// System Prompt Settings Content
function SystemPromptSettingsContent() {
  const { settings, setSystemPrompt } = useAIStore();
  const [localPrompt, setLocalPrompt] = useState(settings.systemPrompt);
  const [hasChanges, setHasChanges] = useState(false);

  const handleSave = () => {
    setSystemPrompt(localPrompt);
    setHasChanges(false);
  };

  const handleReset = () => {
    setLocalPrompt(DEFAULT_SYSTEM_PROMPT);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    setHasChanges(false);
  };

  const handleChange = (value: string) => {
    setLocalPrompt(value);
    setHasChanges(value !== settings.systemPrompt);
  };

  return (
    <div className="space-y-6">
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
            System Prompt Configuration
          </p>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            The system prompt defines the AI assistant's personality and behavior.
            You can also set custom prompts at the notebook or page level for more
            specific contexts. Prompts inherit: Page → Notebook → App default.
          </p>
        </div>
      </div>

      {/* App-level System Prompt */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Default System Prompt
          </label>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <span
                className="text-xs"
                style={{ color: "var(--color-warning)" }}
              >
                Unsaved changes
              </span>
            )}
            <button
              onClick={handleReset}
              className="rounded-lg px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
              title="Reset to default"
            >
              Reset
            </button>
          </div>
        </div>
        <textarea
          value={localPrompt}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Enter your system prompt..."
          rows={8}
          className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
        <p
          className="mt-1.5 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          This prompt is sent to the AI with every conversation to set context and behavior.
        </p>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
            }}
          >
            Save Changes
          </button>
        </div>
      )}

      {/* Notebook & Page Prompts Info */}
      <div
        className="rounded-lg border p-4"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <h4
          className="mb-3 flex items-center gap-2 text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          <IconLayers />
          Prompt Inheritance
        </h4>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
              style={{
                backgroundColor: "rgba(139, 92, 246, 0.2)",
                color: "var(--color-accent)",
              }}
            >
              1
            </div>
            <div>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Page-level prompt
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Set via the page header menu. Highest priority.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
              style={{
                backgroundColor: "rgba(139, 92, 246, 0.15)",
                color: "var(--color-accent)",
              }}
            >
              2
            </div>
            <div>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Notebook-level prompt
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Set via notebook settings. Used if no page prompt is set.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
              style={{
                backgroundColor: "rgba(139, 92, 246, 0.1)",
                color: "var(--color-accent)",
              }}
            >
              3
            </div>
            <div>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                App default (above)
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Fallback when no notebook or page prompt is set.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Icons
function IconPalette() {
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
    >
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function IconSparkles() {
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
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
    </svg>
  );
}

function IconGlobe() {
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
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconX() {
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
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconEye() {
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
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff() {
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
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function IconPrompt() {
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
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="10" x2="15" y2="10" />
    </svg>
  );
}

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

function IconLayers() {
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
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconLibrary() {
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
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="M8 7h6M8 11h8" />
    </svg>
  );
}

function IconChevronDown() {
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconChevronRight() {
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
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconKeyboard() {
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
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M18 8h.01" />
      <path d="M6 12h.01" />
      <path d="M10 12h.01" />
      <path d="M14 12h.01" />
      <path d="M18 12h.01" />
      <path d="M8 16h8" />
    </svg>
  );
}

function IconPlug() {
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
    >
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function IconBackup() {
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
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function IconBrain() {
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
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}
