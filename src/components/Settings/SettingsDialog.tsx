import { useState } from "react";
import { useAIStore, DEFAULT_SYSTEM_PROMPT } from "../../stores/aiStore";
import { useWebResearchStore } from "../../stores/webResearchStore";
import { ThemeSettings } from "./ThemeSettings";
import type { ProviderType } from "../../types/ai";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "ai" | "web-research" | "theme" | "system-prompt";
}

type TabId = "ai" | "web-research" | "theme" | "system-prompt";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "theme", label: "Appearance", icon: <IconPalette /> },
  { id: "ai", label: "AI Provider", icon: <IconSparkles /> },
  { id: "system-prompt", label: "System Prompt", icon: <IconPrompt /> },
  { id: "web-research", label: "Web Research", icon: <IconGlobe /> },
];

const PROVIDERS: { value: ProviderType; label: string; description: string }[] = [
  {
    value: "openai",
    label: "OpenAI",
    description: "GPT-4o, GPT-4, GPT-3.5 Turbo",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    description: "Claude Sonnet 4, Claude Opus 4.5, Claude Haiku",
  },
  {
    value: "ollama",
    label: "Ollama",
    description: "Local models (Llama, Mistral, etc.)",
  },
  {
    value: "lmstudio",
    label: "LM Studio",
    description: "Local models via LM Studio",
  },
];

const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-5-20251101",
    "claude-opus-4-20250514",
    "claude-3-5-haiku-20241022",
  ],
  ollama: ["llama3.2", "llama3.1", "mistral", "codellama", "phi3"],
  lmstudio: ["local-model"],
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
                    ? "bg-[--color-accent]/10 text-[--color-accent]"
                    : "text-[--color-text-secondary] hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
                }`}
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
            {activeTab === "ai" && <AISettingsContent />}
            {activeTab === "system-prompt" && <SystemPromptSettingsContent />}
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
    setProvider,
    setApiKey,
    setModel,
    setTemperature,
    setMaxTokens,
  } = useAIStore();

  const [showApiKey, setShowApiKey] = useState(false);
  const currentModels = DEFAULT_MODELS[settings.providerType] || [];

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          AI Provider
        </label>
        <div className="space-y-2">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.value}
              onClick={() => setProvider(provider.value)}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
              style={{
                borderColor:
                  settings.providerType === provider.value
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  settings.providerType === provider.value
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
              }}
            >
              <div
                className="flex h-4 w-4 items-center justify-center rounded-full border-2"
                style={{
                  borderColor:
                    settings.providerType === provider.value
                      ? "var(--color-accent)"
                      : "var(--color-text-muted)",
                }}
              >
                {settings.providerType === provider.value && (
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
                  {provider.label}
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {provider.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      {settings.providerType !== "ollama" && settings.providerType !== "lmstudio" && (
        <div>
          <label
            className="mb-2 block text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            API Key
          </label>
          <div className="relative">
            <input
              type={showApiKey ? "text" : "password"}
              value={settings.apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`Enter your ${settings.providerType === "openai" ? "OpenAI" : "Anthropic"} API key`}
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
            {settings.providerType === "openai"
              ? "Get your API key from platform.openai.com"
              : "Get your API key from console.anthropic.com"}
          </p>
        </div>
      )}

      {/* Ollama URL */}
      {settings.providerType === "ollama" && (
        <div>
          <label
            className="mb-2 block text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Ollama Server
          </label>
          <input
            type="text"
            value="http://localhost:11434"
            disabled
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          />
          <p
            className="mt-1.5 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Make sure Ollama is running locally
          </p>
        </div>
      )}

      {/* LM Studio URL */}
      {settings.providerType === "lmstudio" && (
        <div>
          <label
            className="mb-2 block text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            LM Studio Server
          </label>
          <input
            type="text"
            value="http://localhost:1234/v1"
            disabled
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          />
          <p
            className="mt-1.5 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Make sure LM Studio is running with local server enabled
          </p>
        </div>
      )}

      {/* Model Selection */}
      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Model
        </label>
        <select
          value={settings.model || currentModels[0] || ""}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          {currentModels.map((model) => (
            <option
              key={model}
              value={model}
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
              }}
            >
              {model}
            </option>
          ))}
        </select>
        {settings.providerType === "lmstudio" && (
          <p
            className="mt-1.5 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            The model loaded in LM Studio will be used automatically
          </p>
        )}
      </div>

      {/* Temperature */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Temperature
          </label>
          <span
            className="text-sm"
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
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
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
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
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
          Maximum length of the AI response
        </p>
      </div>
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
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{
                transform: settings.includeAnswer
                  ? "translateX(20px)"
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
