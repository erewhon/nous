"""Ollama provider implementation for local models."""

import httpx

from nous_ai.models import ChatMessage, ChatResponse, ProviderConfig, ProviderType
from nous_ai.providers.base import BaseProvider


class OllamaProvider(BaseProvider):
    """Ollama local model provider."""

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.base_url = config.base_url or "http://localhost:11434"

    async def chat(self, messages: list[ChatMessage]) -> ChatResponse:
        """Send a chat completion request to Ollama."""
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.config.model,
                    "messages": [{"role": m.role, "content": m.content} for m in messages],
                    "stream": False,
                    "options": {
                        "temperature": self.config.temperature,
                        "num_predict": self.config.max_tokens,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        return ChatResponse(
            content=data.get("message", {}).get("content", ""),
            model=data.get("model", self.config.model),
            provider=ProviderType.OLLAMA,
            tokens_used=data.get("eval_count"),
            finish_reason=data.get("done_reason"),
        )

    async def complete(self, prompt: str, system: str | None = None) -> ChatResponse:
        """Simple completion with optional system prompt."""
        messages: list[ChatMessage] = []

        if system:
            messages.append(ChatMessage(role="system", content=system))
        messages.append(ChatMessage(role="user", content=prompt))

        return await self.chat(messages)

    async def list_models(self) -> list[str]:
        """List available models from Ollama."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()

        return [model["name"] for model in data.get("models", [])]
