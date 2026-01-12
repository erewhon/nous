import { useState } from "react";
import { useAIStore } from "../../stores/aiStore";
import type { ProviderType } from "../../types/ai";

interface AISettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDERS: { value: ProviderType; label: string; description: string }[] = [
  {
    value: "openai",
    label: "OpenAI",
    description: "GPT-4o, GPT-4, GPT-3.5 Turbo",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    description: "Claude Sonnet, Claude Opus, Claude Haiku",
  },
  {
    value: "ollama",
    label: "Ollama",
    description: "Local models (Llama, Mistral, etc.)",
  },
];

const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-haiku-20241022"],
  ollama: ["llama3.2", "llama3.1", "mistral", "codellama", "phi3"],
};

export function AISettingsPanel({ isOpen, onClose }: AISettingsPanelProps) {
  const { settings, setProvider, setApiKey, setModel, setTemperature, setMaxTokens } =
    useAIStore();

  const [showApiKey, setShowApiKey] = useState(false);

  if (!isOpen) return null;

  const currentModels = DEFAULT_MODELS[settings.providerType] || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-[--color-border] bg-[--color-bg-secondary] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[--color-border] px-4 py-3">
          <div className="flex items-center gap-2">
            <IconSettings />
            <span className="font-medium text-[--color-text-primary]">
              AI Settings
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[--color-text-muted] hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
          >
            <IconX />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] overflow-y-auto p-4">
          {/* Provider Selection */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-[--color-text-primary]">
              AI Provider
            </label>
            <div className="space-y-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.value}
                  onClick={() => setProvider(provider.value)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    settings.providerType === provider.value
                      ? "border-[--color-accent] bg-[--color-accent]/10"
                      : "border-[--color-border] hover:border-[--color-text-muted]"
                  }`}
                >
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                      settings.providerType === provider.value
                        ? "border-[--color-accent]"
                        : "border-[--color-text-muted]"
                    }`}
                  >
                    {settings.providerType === provider.value && (
                      <div className="h-2 w-2 rounded-full bg-[--color-accent]" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-[--color-text-primary]">
                      {provider.label}
                    </div>
                    <div className="text-xs text-[--color-text-muted]">
                      {provider.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          {settings.providerType !== "ollama" && (
            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-[--color-text-primary]">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={settings.apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`Enter your ${settings.providerType === "openai" ? "OpenAI" : "Anthropic"} API key`}
                  className="w-full rounded-lg border border-[--color-border] bg-[--color-bg-primary] px-3 py-2 pr-10 text-sm text-[--color-text-primary] placeholder-[--color-text-muted] outline-none focus:border-[--color-accent]"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[--color-text-muted] hover:text-[--color-text-primary]"
                >
                  {showApiKey ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
              <p className="mt-1 text-xs text-[--color-text-muted]">
                {settings.providerType === "openai"
                  ? "Get your API key from platform.openai.com"
                  : "Get your API key from console.anthropic.com"}
              </p>
            </div>
          )}

          {/* Ollama URL */}
          {settings.providerType === "ollama" && (
            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-[--color-text-primary]">
                Ollama Server
              </label>
              <input
                type="text"
                value="http://localhost:11434"
                disabled
                className="w-full rounded-lg border border-[--color-border] bg-[--color-bg-tertiary] px-3 py-2 text-sm text-[--color-text-muted] outline-none"
              />
              <p className="mt-1 text-xs text-[--color-text-muted]">
                Make sure Ollama is running locally
              </p>
            </div>
          )}

          {/* Model Selection */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-[--color-text-primary]">
              Model
            </label>
            <select
              value={settings.model || currentModels[0] || ""}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-[--color-border] bg-[--color-bg-primary] px-3 py-2 text-sm text-[--color-text-primary] outline-none focus:border-[--color-accent]"
            >
              {currentModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>

          {/* Temperature */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-[--color-text-primary]">
                Temperature
              </label>
              <span className="text-sm text-[--color-text-muted]">
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
            <div className="mt-1 flex justify-between text-xs text-[--color-text-muted]">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-[--color-text-primary]">
              Max Tokens
            </label>
            <input
              type="number"
              min="100"
              max="32000"
              step="100"
              value={settings.maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)}
              className="w-full rounded-lg border border-[--color-border] bg-[--color-bg-primary] px-3 py-2 text-sm text-[--color-text-primary] outline-none focus:border-[--color-accent]"
            />
            <p className="mt-1 text-xs text-[--color-text-muted]">
              Maximum length of the AI response
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[--color-border] px-4 py-3">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-[--color-accent] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Icons
function IconSettings() {
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
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
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
