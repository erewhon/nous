"""Chat functionality for Katt AI."""

import asyncio
from typing import Any

from katt_ai.models import (
    ChatMessage,
    ChatResponse,
    PageContext,
    ProviderConfig,
    ProviderType,
)
from katt_ai.providers import get_provider


async def chat(
    messages: list[dict[str, str]],
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Send a chat request to an AI provider.

    This is the main entry point called from Rust via PyO3.

    Args:
        messages: List of message dicts with 'role' and 'content' keys.
        provider_type: One of 'openai', 'anthropic', 'ollama'.
        api_key: API key for the provider (not needed for ollama).
        model: Model to use (uses provider default if not specified).
        temperature: Sampling temperature (0.0 to 2.0).
        max_tokens: Maximum tokens in response.

    Returns:
        Dict with response content and metadata.
    """
    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        model=model or "",
        temperature=temperature,
        max_tokens=max_tokens,
    )

    provider = get_provider(config)
    chat_messages = [ChatMessage(**msg) for msg in messages]

    response = await provider.chat(chat_messages)

    return {
        "content": response.content,
        "model": response.model,
        "provider": response.provider.value,
        "tokens_used": response.tokens_used,
        "finish_reason": response.finish_reason,
    }


async def chat_with_context(
    user_message: str,
    page_context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Chat with context from a notebook page.

    Args:
        user_message: The user's message.
        page_context: Optional page context dict with title, content, tags.
        conversation_history: Previous messages in the conversation.
        provider_type: One of 'openai', 'anthropic', 'ollama'.
        api_key: API key for the provider.
        model: Model to use.
        temperature: Sampling temperature.
        max_tokens: Maximum tokens in response.

    Returns:
        Dict with response content and metadata.
    """
    messages: list[dict[str, str]] = []

    # Build system prompt with page context
    system_parts = ["You are a helpful AI assistant integrated into a personal notebook application."]

    if page_context:
        ctx = PageContext(**page_context)
        system_parts.append(f"\nCurrent page: {ctx.title}")
        if ctx.tags:
            system_parts.append(f"Tags: {', '.join(ctx.tags)}")
        if ctx.notebook_name:
            system_parts.append(f"Notebook: {ctx.notebook_name}")
        system_parts.append(f"\nPage content:\n{ctx.content}")

    messages.append({"role": "system", "content": "\n".join(system_parts)})

    # Add conversation history
    if conversation_history:
        messages.extend(conversation_history)

    # Add user message
    messages.append({"role": "user", "content": user_message})

    return await chat(
        messages=messages,
        provider_type=provider_type,
        api_key=api_key,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    )


async def summarize_page(
    content: str,
    title: str | None = None,
    max_length: int = 500,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Summarize a page's content.

    Args:
        content: The page content to summarize.
        title: Optional page title for context.
        max_length: Maximum summary length in words.
        provider_type: AI provider to use.
        api_key: API key for the provider.
        model: Model to use.

    Returns:
        Dict with summary and metadata.
    """
    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        model=model or "",
        temperature=0.5,  # Lower temperature for summarization
        max_tokens=max_length * 2,  # Rough estimate
    )

    provider = get_provider(config)

    context = f"Page: {title}\n\n" if title else ""
    summary = await provider.summarize(f"{context}{content}", max_length)

    return {
        "summary": summary,
        "original_length": len(content),
        "summary_length": len(summary),
    }


async def suggest_page_tags(
    content: str,
    existing_tags: list[str] | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> list[str]:
    """Suggest tags for a page based on its content.

    Args:
        content: The page content to analyze.
        existing_tags: Tags already applied to the page.
        provider_type: AI provider to use.
        api_key: API key for the provider.
        model: Model to use.

    Returns:
        List of suggested tags.
    """
    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        model=model or "",
        temperature=0.3,  # Low temperature for consistent tagging
        max_tokens=100,
    )

    provider = get_provider(config)
    return await provider.suggest_tags(content, existing_tags)


# Synchronous wrappers for PyO3 (called from Rust)
def chat_sync(
    messages: list[dict[str, str]],
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Synchronous wrapper for chat function."""
    return asyncio.run(chat(messages, provider_type, api_key, model, temperature, max_tokens))


def chat_with_context_sync(
    user_message: str,
    page_context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Synchronous wrapper for chat_with_context function."""
    return asyncio.run(
        chat_with_context(
            user_message,
            page_context,
            conversation_history,
            provider_type,
            api_key,
            model,
            temperature,
            max_tokens,
        )
    )


def summarize_page_sync(
    content: str,
    title: str | None = None,
    max_length: int = 500,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for summarize_page function."""
    return asyncio.run(summarize_page(content, title, max_length, provider_type, api_key, model))


def suggest_page_tags_sync(
    content: str,
    existing_tags: list[str] | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> list[str]:
    """Synchronous wrapper for suggest_page_tags function."""
    return asyncio.run(suggest_page_tags(content, existing_tags, provider_type, api_key, model))
