"""LMStudio provider implementation for local models via OpenAI-compatible API."""

from openai import AsyncOpenAI

from katt_ai.models import ChatMessage, ChatResponse, ProviderConfig, ProviderType
from katt_ai.providers.base import BaseProvider


class LMStudioProvider(BaseProvider):
    """LMStudio local model provider using OpenAI-compatible API."""

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        # LMStudio default server URL
        base_url = config.base_url or "http://localhost:1234/v1"
        self.client = AsyncOpenAI(
            api_key="lm-studio",  # LMStudio doesn't require a real API key
            base_url=base_url,
        )

    async def chat(self, messages: list[ChatMessage]) -> ChatResponse:
        """Send a chat completion request to LMStudio."""
        response = await self.client.chat.completions.create(
            model=self.config.model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
        )

        choice = response.choices[0]
        return ChatResponse(
            content=choice.message.content or "",
            model=response.model,
            provider=ProviderType.LMSTUDIO,
            tokens_used=response.usage.total_tokens if response.usage else None,
            finish_reason=choice.finish_reason,
        )

    async def complete(self, prompt: str, system: str | None = None) -> ChatResponse:
        """Simple completion with optional system prompt."""
        messages: list[ChatMessage] = []

        if system:
            messages.append(ChatMessage(role="system", content=system))
        messages.append(ChatMessage(role="user", content=prompt))

        return await self.chat(messages)

    async def list_models(self) -> list[str]:
        """List available models from LMStudio."""
        try:
            models = await self.client.models.list()
            return [model.id for model in models.data]
        except Exception:
            # Return empty list if LMStudio is not running
            return []
