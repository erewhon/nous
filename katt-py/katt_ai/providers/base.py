"""Base class for AI providers."""

from abc import ABC, abstractmethod

from katt_ai.models import ChatMessage, ChatResponse, ProviderConfig


class BaseProvider(ABC):
    """Abstract base class for AI providers."""

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @abstractmethod
    async def chat(self, messages: list[ChatMessage]) -> ChatResponse:
        """Send a chat completion request.

        Args:
            messages: List of chat messages.

        Returns:
            Chat response from the provider.
        """
        ...

    @abstractmethod
    async def complete(self, prompt: str, system: str | None = None) -> ChatResponse:
        """Simple completion with optional system prompt.

        Args:
            prompt: The user prompt.
            system: Optional system prompt.

        Returns:
            Chat response from the provider.
        """
        ...

    async def summarize(self, content: str, max_length: int = 500) -> str:
        """Summarize the given content.

        Args:
            content: Content to summarize.
            max_length: Maximum length of summary in words.

        Returns:
            Summary text.
        """
        system = f"""You are a helpful assistant that summarizes content concisely.
Provide a summary in {max_length} words or less.
Focus on the key points and main ideas."""

        response = await self.complete(
            f"Please summarize the following content:\n\n{content}",
            system=system,
        )
        return response.content

    async def suggest_tags(self, content: str, existing_tags: list[str] | None = None) -> list[str]:
        """Suggest tags for the given content.

        Args:
            content: Content to analyze.
            existing_tags: Tags already applied (to avoid duplicates).

        Returns:
            List of suggested tags.
        """
        existing = ", ".join(existing_tags) if existing_tags else "none"
        system = """You are a helpful assistant that suggests relevant tags for content.
Return only a comma-separated list of 3-5 relevant tags.
Tags should be lowercase, single words or short phrases with hyphens.
Do not include any other text or explanation."""

        response = await self.complete(
            f"Suggest tags for this content (existing tags: {existing}):\n\n{content}",
            system=system,
        )

        # Parse comma-separated tags
        tags = [tag.strip().lower() for tag in response.content.split(",")]
        # Filter out existing tags and empty strings
        existing_set = set(existing_tags) if existing_tags else set()
        return [tag for tag in tags if tag and tag not in existing_set]
