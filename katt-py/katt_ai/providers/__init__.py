"""AI provider implementations."""

from katt_ai.models import ProviderConfig, ProviderType
from katt_ai.providers.base import BaseProvider
from katt_ai.providers.openai_provider import OpenAIProvider
from katt_ai.providers.anthropic_provider import AnthropicProvider
from katt_ai.providers.ollama_provider import OllamaProvider
from katt_ai.providers.lmstudio_provider import LMStudioProvider
from katt_ai.providers.bedrock_provider import BedrockProvider

_PROVIDERS: dict[ProviderType, type[BaseProvider]] = {
    ProviderType.OPENAI: OpenAIProvider,
    ProviderType.ANTHROPIC: AnthropicProvider,
    ProviderType.OLLAMA: OllamaProvider,
    ProviderType.LMSTUDIO: LMStudioProvider,
    ProviderType.BEDROCK: BedrockProvider,
}


def get_provider(config: ProviderConfig) -> BaseProvider:
    """Get an AI provider instance based on configuration."""
    provider_class = _PROVIDERS.get(config.provider_type)
    if provider_class is None:
        raise ValueError(f"Unknown provider type: {config.provider_type}")
    return provider_class(config)


def list_providers() -> list[str]:
    """List available provider types."""
    return [p.value for p in ProviderType]


__all__ = [
    "BaseProvider",
    "OpenAIProvider",
    "AnthropicProvider",
    "OllamaProvider",
    "LMStudioProvider",
    "BedrockProvider",
    "get_provider",
    "list_providers",
]
