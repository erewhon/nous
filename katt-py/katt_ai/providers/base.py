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

    async def suggest_related_pages(
        self,
        content: str,
        title: str,
        available_pages: list[dict[str, str]],
        existing_links: list[str] | None = None,
        max_suggestions: int = 5,
    ) -> list[dict[str, str]]:
        """Suggest related pages to link based on content similarity.

        Args:
            content: Content of the current page.
            title: Title of the current page.
            available_pages: List of dicts with 'id', 'title', and optionally 'summary' keys.
            existing_links: Page titles already linked from the current page.
            max_suggestions: Maximum number of suggestions to return.

        Returns:
            List of dicts with 'id', 'title', and 'reason' keys for suggested pages.
        """
        if not available_pages:
            return []

        existing_set = set(existing_links) if existing_links else set()
        # Filter out current page and already linked pages
        candidates = [
            p for p in available_pages
            if p["title"].lower() != title.lower()
            and p["title"] not in existing_set
        ]

        if not candidates:
            return []

        # Build page list for the prompt
        page_list = "\n".join(
            f"- {p['title']}" + (f": {p.get('summary', '')[:100]}" if p.get('summary') else "")
            for p in candidates[:50]  # Limit to avoid token overflow
        )

        system = f"""You are a helpful assistant that suggests relevant wiki-links for a Zettelkasten-style notebook.
Analyze the content and suggest up to {max_suggestions} pages from the available list that would be valuable to link.
Consider:
- Conceptual relationships and shared topics
- Pages that expand on ideas mentioned in the content
- Pages that provide background context
- Pages that reference similar concepts

Return your response as a JSON array of objects with "title" and "reason" keys.
Only suggest pages from the provided list. Return an empty array if no good matches exist.
Example: [{{"title": "Page Title", "reason": "Brief explanation of the connection"}}]"""

        prompt = f"""Current page: {title}

Content:
{content[:2000]}

Available pages to link:
{page_list}

Suggest the most relevant pages to link from the current page."""

        response = await self.complete(prompt, system=system)

        # Parse JSON response
        try:
            import json
            # Try to extract JSON from the response
            text = response.content.strip()
            # Handle potential markdown code blocks
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            suggestions = json.loads(text)

            # Match suggestions to available pages (to get IDs)
            title_to_page = {p["title"].lower(): p for p in candidates}
            results = []
            for s in suggestions[:max_suggestions]:
                title_lower = s.get("title", "").lower()
                if title_lower in title_to_page:
                    page = title_to_page[title_lower]
                    results.append({
                        "id": page["id"],
                        "title": page["title"],
                        "reason": s.get("reason", "Related content"),
                    })
            return results
        except (json.JSONDecodeError, KeyError, TypeError):
            # If parsing fails, return empty list
            return []
