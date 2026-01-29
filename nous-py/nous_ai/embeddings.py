"""Embedding generation for RAG (Retrieval-Augmented Generation)."""

import asyncio
import json
from typing import Any

import httpx
from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel

# Optional boto3 import for AWS Bedrock
try:
    import boto3
    from botocore.config import Config as BotoConfig

    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False


# Known embedding model patterns for filtering
EMBEDDING_MODEL_PATTERNS = [
    "embed",
    "embedding",
    "minilm",
    "bge",
    "e5",
    "gte",
    "nomic",
    "instructor",
    "arctic",
    "snowflake",
]


class EmbeddingConfig(BaseModel):
    """Configuration for embedding generation."""

    provider: str  # "openai", "ollama", "lmstudio"
    model: str
    dimensions: int
    api_key: str | None = None
    base_url: str | None = None


async def generate_embedding(text: str, config: dict[str, Any]) -> list[float]:
    """Generate embedding for a single text using the configured provider.

    Args:
        text: The text to embed.
        config: Configuration dictionary with provider, model, api_key, base_url.

    Returns:
        List of floats representing the embedding vector.
    """
    provider = config.get("provider", "openai")
    model = config.get("model", "text-embedding-3-small")

    if provider == "openai":
        return await _generate_openai_embedding(text, model, config.get("api_key"))

    elif provider == "ollama":
        base_url = config.get("base_url", "http://localhost:11434")
        return await _generate_ollama_embedding(text, model, base_url)

    elif provider == "lmstudio":
        base_url = config.get("base_url", "http://localhost:1234/v1")
        return await _generate_lmstudio_embedding(text, model, base_url)

    elif provider == "bedrock":
        region = config.get("base_url", "us-east-1")  # Using base_url for region
        credentials = _parse_bedrock_credentials(config.get("api_key"))
        return await _generate_bedrock_embedding(text, model, region, credentials)

    else:
        raise ValueError(f"Unknown embedding provider: {provider}")


async def generate_embeddings_batch(
    texts: list[str], config: dict[str, Any]
) -> list[list[float]]:
    """Generate embeddings for multiple texts.

    For OpenAI, uses native batch API for efficiency.
    For other providers, processes sequentially.

    Args:
        texts: List of texts to embed.
        config: Configuration dictionary.

    Returns:
        List of embedding vectors (one per input text).
    """
    if not texts:
        return []

    provider = config.get("provider", "openai")
    model = config.get("model", "text-embedding-3-small")

    if provider == "openai":
        return await _generate_openai_embeddings_batch(texts, model, config.get("api_key"))

    # For non-OpenAI providers, process concurrently in small batches
    batch_size = 10  # Process 10 at a time to avoid overwhelming the server
    results: list[list[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        batch_results = await asyncio.gather(
            *[generate_embedding(text, config) for text in batch]
        )
        results.extend(batch_results)

    return results


async def _generate_openai_embedding(
    text: str, model: str, api_key: str | None
) -> list[float]:
    """Generate embedding using OpenAI API."""
    client = AsyncOpenAI(api_key=api_key)
    response = await client.embeddings.create(model=model, input=text)
    return response.data[0].embedding


async def _generate_openai_embeddings_batch(
    texts: list[str], model: str, api_key: str | None
) -> list[list[float]]:
    """Generate embeddings in batch using OpenAI API."""
    client = AsyncOpenAI(api_key=api_key)

    # OpenAI has a limit on batch size, split if needed
    max_batch_size = 2048
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), max_batch_size):
        batch = texts[i : i + max_batch_size]
        response = await client.embeddings.create(model=model, input=batch)
        # Sort by index to maintain order
        sorted_data = sorted(response.data, key=lambda x: x.index)
        all_embeddings.extend([d.embedding for d in sorted_data])

    return all_embeddings


async def _generate_ollama_embedding(
    text: str, model: str, base_url: str
) -> list[float]:
    """Generate embedding using Ollama API."""
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{base_url}/api/embeddings",
            json={"model": model, "prompt": text},
        )
        response.raise_for_status()
        return response.json()["embedding"]


async def _generate_lmstudio_embedding(
    text: str, model: str, base_url: str
) -> list[float]:
    """Generate embedding using LM Studio (OpenAI-compatible API)."""
    # LM Studio uses OpenAI-compatible API
    client = AsyncOpenAI(api_key="lm-studio", base_url=base_url)
    response = await client.embeddings.create(model=model, input=text)
    return response.data[0].embedding


async def _generate_bedrock_embedding(
    text: str, model: str, region: str, credentials: dict[str, str] | None = None
) -> list[float]:
    """Generate embedding using AWS Bedrock."""
    # Run sync version in executor to avoid blocking
    import asyncio

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _generate_bedrock_embedding_sync, text, model, region, credentials
    )


# Synchronous implementations for PyO3 integration
# Using sync clients to avoid asyncio.run() event loop issues


def _generate_openai_embedding_sync(text: str, model: str, api_key: str | None) -> list[float]:
    """Generate embedding using OpenAI API (synchronous)."""
    client = OpenAI(api_key=api_key)
    response = client.embeddings.create(model=model, input=text)
    return response.data[0].embedding


def _generate_openai_embeddings_batch_sync(
    texts: list[str], model: str, api_key: str | None
) -> list[list[float]]:
    """Generate embeddings in batch using OpenAI API (synchronous)."""
    client = OpenAI(api_key=api_key)
    max_batch_size = 2048
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), max_batch_size):
        batch = texts[i : i + max_batch_size]
        response = client.embeddings.create(model=model, input=batch)
        sorted_data = sorted(response.data, key=lambda x: x.index)
        all_embeddings.extend([d.embedding for d in sorted_data])

    return all_embeddings


def _generate_ollama_embedding_sync(text: str, model: str, base_url: str) -> list[float]:
    """Generate embedding using Ollama API (synchronous)."""
    with httpx.Client(timeout=60) as client:
        response = client.post(
            f"{base_url}/api/embeddings",
            json={"model": model, "prompt": text},
        )
        response.raise_for_status()
        return response.json()["embedding"]


def _generate_lmstudio_embedding_sync(text: str, model: str, base_url: str) -> list[float]:
    """Generate embedding using LM Studio (synchronous)."""
    client = OpenAI(api_key="lm-studio", base_url=base_url)
    response = client.embeddings.create(model=model, input=text)
    return response.data[0].embedding


def _generate_bedrock_embedding_sync(
    text: str, model: str, region: str, credentials: dict[str, str] | None = None
) -> list[float]:
    """Generate embedding using AWS Bedrock (synchronous)."""
    if not HAS_BOTO3:
        raise ImportError(
            "boto3 is required for Bedrock embeddings. "
            "Install with: pip install boto3"
        )

    # Configure boto3 client
    config = BotoConfig(
        region_name=region,
        retries={"max_attempts": 3, "mode": "adaptive"},
    )

    # Create client with explicit credentials or default credential chain
    if credentials and credentials.get("access_key") and credentials.get("secret_key"):
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            aws_access_key_id=credentials["access_key"],
            aws_secret_access_key=credentials["secret_key"],
            config=config,
        )
    else:
        # Use default credential chain (env vars, ~/.aws/credentials, IAM role, etc.)
        client = boto3.client("bedrock-runtime", region_name=region, config=config)

    # Prepare request body based on model provider
    if model.startswith("amazon.titan"):
        body = json.dumps({"inputText": text})
    elif model.startswith("cohere.embed"):
        body = json.dumps({
            "texts": [text],
            "input_type": "search_document",
        })
    else:
        # Default format (works for most models)
        body = json.dumps({"inputText": text})

    # Invoke model
    response = client.invoke_model(
        modelId=model,
        body=body,
        contentType="application/json",
        accept="application/json",
    )

    # Parse response based on model provider
    response_body = json.loads(response["body"].read())

    if model.startswith("amazon.titan"):
        return response_body["embedding"]
    elif model.startswith("cohere.embed"):
        return response_body["embeddings"][0]
    else:
        # Try common response formats
        if "embedding" in response_body:
            return response_body["embedding"]
        elif "embeddings" in response_body:
            return response_body["embeddings"][0]
        else:
            raise ValueError(f"Unknown response format for model {model}: {response_body}")


def _generate_bedrock_embeddings_batch_sync(
    texts: list[str], model: str, region: str, credentials: dict[str, str] | None = None
) -> list[list[float]]:
    """Generate embeddings in batch using AWS Bedrock (synchronous)."""
    if not HAS_BOTO3:
        raise ImportError(
            "boto3 is required for Bedrock embeddings. "
            "Install with: pip install boto3"
        )

    # Configure boto3 client
    config = BotoConfig(
        region_name=region,
        retries={"max_attempts": 3, "mode": "adaptive"},
    )

    if credentials and credentials.get("access_key") and credentials.get("secret_key"):
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            aws_access_key_id=credentials["access_key"],
            aws_secret_access_key=credentials["secret_key"],
            config=config,
        )
    else:
        client = boto3.client("bedrock-runtime", region_name=region, config=config)

    # Cohere supports batch natively
    if model.startswith("cohere.embed"):
        # Cohere has a max batch size of 96
        max_batch_size = 96
        all_embeddings: list[list[float]] = []

        for i in range(0, len(texts), max_batch_size):
            batch = texts[i : i + max_batch_size]
            body = json.dumps({
                "texts": batch,
                "input_type": "search_document",
            })

            response = client.invoke_model(
                modelId=model,
                body=body,
                contentType="application/json",
                accept="application/json",
            )

            response_body = json.loads(response["body"].read())
            all_embeddings.extend(response_body["embeddings"])

        return all_embeddings

    # For other models, process one at a time
    return [
        _generate_bedrock_embedding_sync(text, model, region, credentials)
        for text in texts
    ]


def generate_embedding_sync(text: str, config: dict[str, Any]) -> list[float]:
    """Generate embedding for a single text (synchronous version for PyO3)."""
    provider = config.get("provider", "openai")
    model = config.get("model", "text-embedding-3-small")

    if provider == "openai":
        return _generate_openai_embedding_sync(text, model, config.get("api_key"))
    elif provider == "ollama":
        base_url = config.get("base_url", "http://localhost:11434")
        return _generate_ollama_embedding_sync(text, model, base_url)
    elif provider == "lmstudio":
        base_url = config.get("base_url", "http://localhost:1234/v1")
        return _generate_lmstudio_embedding_sync(text, model, base_url)
    elif provider == "bedrock":
        region = config.get("base_url", "us-east-1")  # Using base_url field for region
        credentials = _parse_bedrock_credentials(config.get("api_key"))
        return _generate_bedrock_embedding_sync(text, model, region, credentials)
    else:
        raise ValueError(f"Unknown embedding provider: {provider}")


def _parse_bedrock_credentials(api_key: str | None) -> dict[str, str] | None:
    """Parse Bedrock credentials from api_key field.

    Format: "access_key:secret_key" or empty/None to use default credentials.
    """
    if not api_key or api_key.strip() == "":
        return None

    if ":" in api_key:
        parts = api_key.split(":", 1)
        return {"access_key": parts[0], "secret_key": parts[1]}

    # If no colon, assume it's just the access key (secret might be in env)
    return {"access_key": api_key, "secret_key": ""}


def generate_embeddings_batch_sync(
    texts: list[str], config: dict[str, Any]
) -> list[list[float]]:
    """Generate embeddings for multiple texts (synchronous version for PyO3)."""
    if not texts:
        return []

    provider = config.get("provider", "openai")
    model = config.get("model", "text-embedding-3-small")

    if provider == "openai":
        return _generate_openai_embeddings_batch_sync(texts, model, config.get("api_key"))

    if provider == "bedrock":
        region = config.get("base_url", "us-east-1")
        credentials = _parse_bedrock_credentials(config.get("api_key"))
        return _generate_bedrock_embeddings_batch_sync(texts, model, region, credentials)

    # For other providers, process sequentially
    return [generate_embedding_sync(text, config) for text in texts]


# Constants for common embedding models

EMBEDDING_MODELS = {
    "openai": [
        {"id": "text-embedding-3-small", "name": "text-embedding-3-small", "dimensions": 1536},
        {"id": "text-embedding-3-large", "name": "text-embedding-3-large", "dimensions": 3072},
        {"id": "text-embedding-ada-002", "name": "text-embedding-ada-002", "dimensions": 1536},
    ],
    "ollama": [
        {"id": "nomic-embed-text", "name": "Nomic Embed Text", "dimensions": 768},
        {"id": "all-minilm", "name": "all-MiniLM", "dimensions": 384},
        {"id": "mxbai-embed-large", "name": "mxbai-embed-large", "dimensions": 1024},
        {"id": "snowflake-arctic-embed", "name": "Snowflake Arctic Embed", "dimensions": 1024},
    ],
    "lmstudio": [
        {
            "id": "text-embedding-nomic-embed-text-v1.5",
            "name": "Nomic Embed",
            "dimensions": 768,
        },
    ],
    "bedrock": [
        {"id": "amazon.titan-embed-text-v1", "name": "Titan Embeddings G1", "dimensions": 1536},
        {"id": "amazon.titan-embed-text-v2:0", "name": "Titan Embeddings G2", "dimensions": 1024},
        {"id": "cohere.embed-english-v3", "name": "Cohere Embed English v3", "dimensions": 1024},
        {"id": "cohere.embed-multilingual-v3", "name": "Cohere Embed Multilingual v3", "dimensions": 1024},
    ],
}


def get_embedding_models(provider: str) -> list[dict[str, Any]]:
    """Get available embedding models for a provider."""
    return EMBEDDING_MODELS.get(provider, [])


def get_default_dimensions(provider: str, model: str) -> int:
    """Get the default dimensions for a provider/model combination."""
    models = EMBEDDING_MODELS.get(provider, [])
    for m in models:
        if m["id"] == model:
            return m["dimensions"]

    # Default dimensions for unknown models
    defaults = {
        "openai": 1536,
        "ollama": 768,
        "lmstudio": 768,
        "bedrock": 1024,
    }
    return defaults.get(provider, 768)


def _is_likely_embedding_model(model_name: str) -> bool:
    """Check if a model name suggests it's an embedding model."""
    name_lower = model_name.lower()
    return any(pattern in name_lower for pattern in EMBEDDING_MODEL_PATTERNS)


async def discover_ollama_models(base_url: str = "http://localhost:11434") -> list[dict[str, Any]]:
    """Discover available embedding models from Ollama.

    Args:
        base_url: Ollama server URL.

    Returns:
        List of model info dicts with id, name, and dimensions.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{base_url}/api/tags")
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get("models", []):
                name = model.get("name", "")
                # Filter to likely embedding models
                if _is_likely_embedding_model(name):
                    # Try to determine dimensions from model details
                    dimensions = _estimate_dimensions_from_name(name)
                    models.append({
                        "id": name,
                        "name": name,
                        "dimensions": dimensions,
                    })

            # If no embedding models found, return all models (user might know better)
            if not models:
                for model in data.get("models", []):
                    name = model.get("name", "")
                    models.append({
                        "id": name,
                        "name": name,
                        "dimensions": 768,  # Default
                    })

            return models
    except Exception as e:
        print(f"Failed to discover Ollama models: {e}")
        return []


async def discover_lmstudio_models(base_url: str = "http://localhost:1234/v1") -> list[dict[str, Any]]:
    """Discover available embedding models from LM Studio.

    Args:
        base_url: LM Studio server URL.

    Returns:
        List of model info dicts with id, name, and dimensions.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{base_url}/models")
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")
                # Filter to likely embedding models
                if _is_likely_embedding_model(model_id):
                    dimensions = _estimate_dimensions_from_name(model_id)
                    models.append({
                        "id": model_id,
                        "name": model_id,
                        "dimensions": dimensions,
                    })

            # If no embedding models found, return all models
            if not models:
                for model in data.get("data", []):
                    model_id = model.get("id", "")
                    models.append({
                        "id": model_id,
                        "name": model_id,
                        "dimensions": 768,  # Default
                    })

            return models
    except Exception as e:
        print(f"Failed to discover LM Studio models: {e}")
        return []


def _estimate_dimensions_from_name(model_name: str) -> int:
    """Estimate embedding dimensions from model name."""
    name_lower = model_name.lower()

    # Known dimension mappings
    if "nomic" in name_lower:
        return 768
    if "minilm" in name_lower or "all-minilm" in name_lower:
        return 384
    if "bge-small" in name_lower:
        return 384
    if "bge-base" in name_lower:
        return 768
    if "bge-large" in name_lower or "bge-m3" in name_lower:
        return 1024
    if "e5-small" in name_lower:
        return 384
    if "e5-base" in name_lower:
        return 768
    if "e5-large" in name_lower:
        return 1024
    if "gte-small" in name_lower:
        return 384
    if "gte-base" in name_lower:
        return 768
    if "gte-large" in name_lower:
        return 1024
    if "arctic" in name_lower or "snowflake" in name_lower:
        return 1024
    if "mxbai" in name_lower:
        return 1024
    if "instructor" in name_lower:
        return 768

    # Default
    return 768


async def discover_models(provider: str, base_url: str | None = None) -> list[dict[str, Any]]:
    """Discover available embedding models for a provider.

    Args:
        provider: The provider type ("ollama" or "lmstudio").
        base_url: Optional custom base URL.

    Returns:
        List of model info dicts with id, name, and dimensions.
    """
    if provider == "ollama":
        url = base_url or "http://localhost:11434"
        return await discover_ollama_models(url)
    elif provider == "lmstudio":
        url = base_url or "http://localhost:1234/v1"
        return await discover_lmstudio_models(url)
    elif provider == "openai":
        # OpenAI models are well-known, return static list
        return EMBEDDING_MODELS.get("openai", [])
    elif provider == "bedrock":
        # Bedrock models are well-known, return static list
        return EMBEDDING_MODELS.get("bedrock", [])
    else:
        return []


def _discover_ollama_models_sync(base_url: str) -> list[dict[str, Any]]:
    """Discover available embedding models from Ollama (synchronous)."""
    try:
        with httpx.Client(timeout=10) as client:
            response = client.get(f"{base_url}/api/tags")
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get("models", []):
                name = model.get("name", "")
                if _is_likely_embedding_model(name):
                    dimensions = _estimate_dimensions_from_name(name)
                    models.append({
                        "id": name,
                        "name": name,
                        "dimensions": dimensions,
                    })

            if not models:
                for model in data.get("models", []):
                    name = model.get("name", "")
                    models.append({
                        "id": name,
                        "name": name,
                        "dimensions": 768,
                    })

            return models
    except Exception as e:
        print(f"Failed to discover Ollama models: {e}")
        return []


def _discover_lmstudio_models_sync(base_url: str) -> list[dict[str, Any]]:
    """Discover available embedding models from LM Studio (synchronous)."""
    try:
        with httpx.Client(timeout=10) as client:
            response = client.get(f"{base_url}/models")
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")
                if _is_likely_embedding_model(model_id):
                    dimensions = _estimate_dimensions_from_name(model_id)
                    models.append({
                        "id": model_id,
                        "name": model_id,
                        "dimensions": dimensions,
                    })

            if not models:
                for model in data.get("data", []):
                    model_id = model.get("id", "")
                    models.append({
                        "id": model_id,
                        "name": model_id,
                        "dimensions": 768,
                    })

            return models
    except Exception as e:
        print(f"Failed to discover LM Studio models: {e}")
        return []


def discover_models_sync(provider: str, base_url: str | None = None) -> list[dict[str, Any]]:
    """Discover available embedding models for a provider (synchronous)."""
    if provider == "ollama":
        url = base_url or "http://localhost:11434"
        return _discover_ollama_models_sync(url)
    elif provider == "lmstudio":
        url = base_url or "http://localhost:1234/v1"
        return _discover_lmstudio_models_sync(url)
    elif provider == "openai":
        return EMBEDDING_MODELS.get("openai", [])
    elif provider == "bedrock":
        return EMBEDDING_MODELS.get("bedrock", [])
    else:
        return []
