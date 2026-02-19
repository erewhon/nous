"""LMStudio provider implementation for local models via OpenAI-compatible API."""

from openai import AsyncOpenAI

from nous_ai.models import ChatMessage, ChatResponse, ProviderConfig, ProviderType
from nous_ai.providers.base import BaseProvider


class LMStudioProvider(BaseProvider):
    """LMStudio local model provider using OpenAI-compatible API."""

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        # LMStudio/vLLM default server URL
        base_url = config.base_url or "http://localhost:1234/v1"
        # OpenAI SDK expects base_url to end with /v1
        if not base_url.rstrip("/").endswith("/v1"):
            base_url = base_url.rstrip("/") + "/v1"
        self.client = AsyncOpenAI(
            api_key=config.api_key or "lm-studio",  # Local providers may not need a real key
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
