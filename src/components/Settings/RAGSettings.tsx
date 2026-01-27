import { useState, useEffect } from "react";
import { useRAGStore } from "../../stores/ragStore";
import {
  EMBEDDING_MODELS,
  EMBEDDING_PROVIDER_INFO,
  DEFAULT_EMBEDDING_BASE_URLS,
  type EmbeddingProvider,
} from "../../types/rag";

export function RAGSettings() {
  const {
    settings,
    isConfigured,
    isIndexing,
    isDiscoveringModels,
    stats,
    discoveredModels,
    lastError,
    loadConfig,
    configure,
    setProvider,
    setModel,
    setApiKey,
    setBaseUrl,
    setRagEnabled,
    setAutoIndexPages,
    setUseHybridSearch,
    setSemanticWeight,
    rebuildIndex,
    getStats,
    clearError,
    discoverModels,
  } = useRAGStore();

  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuildingIndex, setIsRebuildingIndex] = useState(false);

  const providerInfo = EMBEDDING_PROVIDER_INFO[settings.provider];
  // Use discovered models if available, otherwise fall back to static list
  const discovered = discoveredModels[settings.provider];
  const models = discovered.length > 0 ? discovered : EMBEDDING_MODELS[settings.provider];

  // Load config on mount
  useEffect(() => {
    loadConfig();
    getStats().catch(() => {});
  }, [loadConfig, getStats]);

  // Discover models when provider supports it
  useEffect(() => {
    if (providerInfo.supportsDiscovery) {
      discoverModels(settings.provider).catch(() => {});
    }
  }, [settings.provider, settings.baseUrl, discoverModels, providerInfo.supportsDiscovery]);

  const handleSaveConfig = async () => {
    setIsSaving(true);
    clearError();
    try {
      await configure(
        settings.provider,
        settings.model,
        settings.apiKey || undefined,
        settings.baseUrl || undefined
      );
    } catch (error) {
      console.error("Failed to save config:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRebuildIndex = async () => {
    if (!isConfigured) return;
    setIsRebuildingIndex(true);
    clearError();
    try {
      await rebuildIndex();
      await getStats();
    } catch (error) {
      console.error("Failed to rebuild index:", error);
    } finally {
      setIsRebuildingIndex(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div
        className="flex items-center justify-between rounded-lg border p-4"
        style={{
          backgroundColor: settings.ragEnabled
            ? "rgba(139, 92, 246, 0.1)"
            : "var(--color-bg-secondary)",
          borderColor: settings.ragEnabled
            ? "var(--color-accent)"
            : "var(--color-border)",
        }}
      >
        <div>
          <div
            className="font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Semantic Search
          </div>
          <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Enable AI-powered semantic search and RAG context
          </div>
        </div>
        <button
          onClick={() => setRagEnabled(!settings.ragEnabled)}
          className="relative h-6 w-11 rounded-full transition-colors"
          style={{
            backgroundColor: settings.ragEnabled
              ? "var(--color-accent)"
              : "var(--color-bg-tertiary)",
          }}
        >
          <span
            className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
            style={{
              transform: settings.ragEnabled
                ? "translateX(22px)"
                : "translateX(2px)",
            }}
          />
        </button>
      </div>

      {/* Provider Selection */}
      <div>
        <label
          className="mb-2 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Embedding Provider
        </label>
        <div className="space-y-2">
          {(Object.keys(EMBEDDING_PROVIDER_INFO) as EmbeddingProvider[]).map(
            (provider) => {
              const info = EMBEDDING_PROVIDER_INFO[provider];
              const isSelected = settings.provider === provider;
              return (
                <button
                  key={provider}
                  onClick={() => setProvider(provider)}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
                  style={{
                    borderColor: isSelected
                      ? "var(--color-accent)"
                      : "var(--color-border)",
                    backgroundColor: isSelected
                      ? "rgba(139, 92, 246, 0.1)"
                      : "transparent",
                  }}
                >
                  <div
                    className="flex h-4 w-4 items-center justify-center rounded-full border-2"
                    style={{
                      borderColor: isSelected
                        ? "var(--color-accent)"
                        : "var(--color-text-muted)",
                    }}
                  >
                    {isSelected && (
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: "var(--color-accent)" }}
                      />
                    )}
                  </div>
                  <div className="flex-1">
                    <div
                      className="font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {info.label}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {info.description}
                    </div>
                  </div>
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* API Key (for cloud providers) */}
      {providerInfo.needsApiKey && (
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
              placeholder={`Enter your ${providerInfo.label} API key`}
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
            {settings.provider === "openai" ? "platform.openai.com" : "your provider"}
          </p>
        </div>
      )}

      {/* Base URL (for local providers) */}
      {!providerInfo.needsApiKey && (
        <div>
          <label
            className="mb-2 block text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Server URL
          </label>
          <input
            type="text"
            value={settings.baseUrl || DEFAULT_EMBEDDING_BASE_URLS[settings.provider] || ""}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DEFAULT_EMBEDDING_BASE_URLS[settings.provider] || "http://localhost:11434"}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <p className="mt-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {settings.provider === "ollama"
              ? "Make sure Ollama is running locally"
              : "Make sure LM Studio is running with local server enabled"}
          </p>
        </div>
      )}

      {/* Model Selection */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Embedding Model
          </label>
          {providerInfo.supportsDiscovery && (
            <button
              onClick={() => discoverModels(settings.provider)}
              disabled={isDiscoveringModels}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary] disabled:opacity-50"
              style={{ color: "var(--color-text-muted)" }}
            >
              <IconRefresh spinning={isDiscoveringModels} />
              {isDiscoveringModels ? "Discovering..." : "Refresh"}
            </button>
          )}
        </div>
        <select
          value={settings.model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent] dark-select"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name} ({model.dimensions}d)
            </option>
          ))}
        </select>
        {providerInfo.supportsDiscovery && discovered.length > 0 && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Found {discovered.length} embedding model{discovered.length !== 1 ? "s" : ""} on server
          </p>
        )}
      </div>

      {/* Save Configuration Button */}
      <button
        onClick={handleSaveConfig}
        disabled={isSaving}
        className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
        style={{
          background:
            "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
        }}
      >
        {isSaving ? "Saving..." : isConfigured ? "Update Configuration" : "Save Configuration"}
      </button>

      {/* Error Display */}
      {lastError && (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            borderColor: "rgb(239, 68, 68)",
            color: "rgb(239, 68, 68)",
          }}
        >
          {lastError}
        </div>
      )}

      {/* Additional Settings */}
      <div
        className="rounded-lg border p-4 space-y-4"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <h4
          className="text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Indexing Options
        </h4>

        {/* Auto-index Pages */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm" style={{ color: "var(--color-text-primary)" }}>
              Auto-index Pages
            </div>
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Automatically index pages when created or updated
            </div>
          </div>
          <button
            onClick={() => setAutoIndexPages(!settings.autoIndexPages)}
            className="relative h-5 w-9 rounded-full transition-colors"
            style={{
              backgroundColor: settings.autoIndexPages
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{
                transform: settings.autoIndexPages
                  ? "translateX(18px)"
                  : "translateX(2px)",
              }}
            />
          </button>
        </div>

        {/* Hybrid Search */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm" style={{ color: "var(--color-text-primary)" }}>
              Hybrid Search
            </div>
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Combine semantic and keyword search for better results
            </div>
          </div>
          <button
            onClick={() => setUseHybridSearch(!settings.useHybridSearch)}
            className="relative h-5 w-9 rounded-full transition-colors"
            style={{
              backgroundColor: settings.useHybridSearch
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{
                transform: settings.useHybridSearch
                  ? "translateX(18px)"
                  : "translateX(2px)",
              }}
            />
          </button>
        </div>

        {/* Semantic Weight Slider */}
        {settings.useHybridSearch && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                Semantic Weight
              </div>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {Math.round(settings.semanticWeight * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={settings.semanticWeight * 100}
              onChange={(e) => setSemanticWeight(parseInt(e.target.value) / 100)}
              className="w-full accent-[--color-accent]"
            />
            <div
              className="mt-1 flex justify-between text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              <span>Keyword</span>
              <span>Semantic</span>
            </div>
          </div>
        )}
      </div>

      {/* Index Statistics */}
      {isConfigured && stats && (
        <div
          className="rounded-lg border p-4"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <h4
            className="mb-3 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Index Statistics
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div style={{ color: "var(--color-text-muted)" }}>Chunks</div>
              <div style={{ color: "var(--color-text-primary)" }}>{stats.chunkCount}</div>
            </div>
            <div>
              <div style={{ color: "var(--color-text-muted)" }}>Pages</div>
              <div style={{ color: "var(--color-text-primary)" }}>{stats.pageCount}</div>
            </div>
            <div>
              <div style={{ color: "var(--color-text-muted)" }}>Notebooks</div>
              <div style={{ color: "var(--color-text-primary)" }}>{stats.notebookCount}</div>
            </div>
            <div>
              <div style={{ color: "var(--color-text-muted)" }}>Dimensions</div>
              <div style={{ color: "var(--color-text-primary)" }}>{stats.dimensions}</div>
            </div>
          </div>

          {/* Rebuild Index Button */}
          <button
            onClick={handleRebuildIndex}
            disabled={isRebuildingIndex || isIndexing}
            className="mt-4 w-full rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            {isRebuildingIndex || isIndexing ? "Rebuilding..." : "Rebuild Index"}
          </button>
        </div>
      )}
    </div>
  );
}

// Icons
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

function IconRefresh({ spinning = false }: { spinning?: boolean }) {
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
      className={spinning ? "animate-spin" : ""}
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
