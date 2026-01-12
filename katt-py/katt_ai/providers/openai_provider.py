"""OpenAI provider implementation."""

from openai import AsyncOpenAI

from katt_ai.models import ChatMessage, ChatResponse, ProviderConfig, ProviderType
from katt_ai.providers.base import BaseProvider


class OpenAIProvider(BaseProvider):
    """OpenAI API provider."""

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.client = AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
        )

    async def chat(self, messages: list[ChatMessage]) -> ChatResponse:
        """Send a chat completion request to OpenAI."""
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
            provider=ProviderType.OPENAI,
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
