import { z } from "zod";

// Embedding provider types
export const EmbeddingProviderSchema = z.enum(["openai", "ollama", "lmstudio", "bedrock"]);
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;

// Embedding configuration schema
export const EmbeddingConfigSchema = z.object({
  provider: EmbeddingProviderSchema,
  model: z.string(),
  dimensions: z.number(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

// Semantic search result schema
export const SemanticSearchResultSchema = z.object({
  chunkId: z.string(),
  pageId: z.string(),
  notebookId: z.string(),
  title: z.string(),
  content: z.string(),
  score: z.number(),
});

export type SemanticSearchResult = z.infer<typeof SemanticSearchResultSchema>;

// Vector index statistics
export const VectorIndexStatsSchema = z.object({
  chunkCount: z.number(),
  pageCount: z.number(),
  notebookCount: z.number(),
  dimensions: z.number(),
});

export type VectorIndexStats = z.infer<typeof VectorIndexStatsSchema>;

// Available embedding models per provider
export const EMBEDDING_MODELS: Record<
  EmbeddingProvider,
  Array<{ id: string; name: string; dimensions: number }>
> = {
  openai: [
    { id: "text-embedding-3-small", name: "text-embedding-3-small", dimensions: 1536 },
    { id: "text-embedding-3-large", name: "text-embedding-3-large", dimensions: 3072 },
    { id: "text-embedding-ada-002", name: "text-embedding-ada-002", dimensions: 1536 },
  ],
  ollama: [
    { id: "nomic-embed-text", name: "Nomic Embed Text", dimensions: 768 },
    { id: "all-minilm", name: "all-MiniLM", dimensions: 384 },
    { id: "mxbai-embed-large", name: "mxbai-embed-large", dimensions: 1024 },
    { id: "snowflake-arctic-embed", name: "Snowflake Arctic Embed", dimensions: 1024 },
  ],
  lmstudio: [
    { id: "text-embedding-nomic-embed-text-v1.5", name: "Nomic Embed", dimensions: 768 },
  ],
  bedrock: [
    { id: "amazon.titan-embed-text-v1", name: "Titan Embeddings G1", dimensions: 1536 },
    { id: "amazon.titan-embed-text-v2:0", name: "Titan Embeddings G2", dimensions: 1024 },
    { id: "cohere.embed-english-v3", name: "Cohere Embed English v3", dimensions: 1024 },
    { id: "cohere.embed-multilingual-v3", name: "Cohere Embed Multilingual v3", dimensions: 1024 },
  ],
};

// Default base URLs for local providers (or region for Bedrock)
export const DEFAULT_EMBEDDING_BASE_URLS: Partial<Record<EmbeddingProvider, string>> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234/v1",
  bedrock: "us-east-1",
};

// Helper to get default dimensions for a model
export function getModelDimensions(provider: EmbeddingProvider, modelId: string): number {
  const models = EMBEDDING_MODELS[provider];
  const model = models.find((m) => m.id === modelId);
  if (model) {
    return model.dimensions;
  }
  // Default dimensions for unknown models
  const defaults: Record<EmbeddingProvider, number> = {
    openai: 1536,
    ollama: 768,
    lmstudio: 768,
    bedrock: 1024,
  };
  return defaults[provider];
}

// Provider info for UI
export const EMBEDDING_PROVIDER_INFO: Record<
  EmbeddingProvider,
  {
    label: string;
    description: string;
    needsApiKey: boolean;
    supportsDiscovery: boolean;
    needsRegion?: boolean;
    apiKeyPlaceholder?: string;
  }
> = {
  openai: {
    label: "OpenAI",
    description: "Cloud-based, high-quality embeddings",
    needsApiKey: true,
    supportsDiscovery: false,
  },
  ollama: {
    label: "Ollama",
    description: "Local embeddings via Ollama",
    needsApiKey: false,
    supportsDiscovery: true,
  },
  lmstudio: {
    label: "LM Studio",
    description: "Local embeddings via LM Studio",
    needsApiKey: false,
    supportsDiscovery: true,
  },
  bedrock: {
    label: "AWS Bedrock",
    description: "AWS-hosted embeddings (Titan, Cohere)",
    needsApiKey: true,
    supportsDiscovery: false,
    needsRegion: true,
    apiKeyPlaceholder: "access_key:secret_key (or leave empty for IAM role)",
  },
};

// Discovered model schema
export const DiscoveredModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  dimensions: z.number(),
});

export type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>;
