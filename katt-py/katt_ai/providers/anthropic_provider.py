"""Anthropic (Claude) provider implementation."""

from anthropic import AsyncAnthropic

from katt_ai.models import ChatMessage, ChatResponse, ProviderConfig, ProviderType
from katt_ai.providers.base import BaseProvider


class AnthropicProvider(BaseProvider):
    """Anthropic Claude API provider."""

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.client = AsyncAnthropic(
            api_key=config.api_key,
            base_url=config.base_url,
        )

    async def chat(self, messages: list[ChatMessage]) -> ChatResponse:
        """Send a chat completion request to Anthropic."""
        # Separate system message from conversation
        system_content = None
        conversation: list[dict] = []

        for msg in messages:
            if msg.role == "system":
                system_content = msg.content
            else:
                conversation.append({"role": msg.role, "content": msg.content})

        # Ensure conversation is not empty
        if not conversation:
            conversation.append({"role": "user", "content": ""})

        response = await self.client.messages.create(
            model=self.config.model,
            messages=conversation,
            system=system_content or "",
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
        )

        # Extract text from content blocks
        content = ""
        for block in response.content:
            if hasattr(block, "text"):
                content += block.text

        return ChatResponse(
            content=content,
            model=response.model,
            provider=ProviderType.ANTHROPIC,
            tokens_used=response.usage.input_tokens + response.usage.output_tokens,
            finish_reason=response.stop_reason,
        )

    async def complete(self, prompt: str, system: str | None = None) -> ChatResponse:
        """Simple completion with optional system prompt."""
        messages: list[ChatMessage] = []

        if system:
            messages.append(ChatMessage(role="system", content=system))
        messages.append(ChatMessage(role="user", content=prompt))

        return await self.chat(messages)
