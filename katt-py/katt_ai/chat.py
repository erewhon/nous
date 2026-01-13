"""Chat functionality for Katt AI."""

import asyncio
import json
from typing import Any

from katt_ai.models import (
    ChatMessage,
    ChatResponse,
    PageContext,
    ProviderConfig,
    ProviderType,
)
from katt_ai.providers import get_provider


# Tool definitions for notebook/page creation
NOTEBOOK_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_notebook",
            "description": "Create a new notebook in the Katt application. Use this when the user asks to create a notebook or wants to organize content into a new notebook.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the notebook to create"
                    },
                    "description": {
                        "type": "string",
                        "description": "Optional description of the notebook's purpose"
                    }
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_page",
            "description": "Create a new page in a notebook. Use this when the user asks to create a page, note, or document. The content should be formatted as Editor.js blocks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "notebook_name": {
                        "type": "string",
                        "description": "Name of the notebook to create the page in. Use 'current' for the currently selected notebook, or specify a notebook name."
                    },
                    "title": {
                        "type": "string",
                        "description": "Title of the page"
                    },
                    "content_blocks": {
                        "type": "array",
                        "description": "Array of content blocks in Editor.js format",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": ["paragraph", "header", "list", "checklist", "code", "quote"],
                                    "description": "Type of the block"
                                },
                                "data": {
                                    "type": "object",
                                    "description": "Block-specific data. For paragraph: {text}. For header: {text, level}. For list: {style, items}. For checklist: {items: [{text, checked}]}. For code: {code, language}. For quote: {text, caption}."
                                }
                            },
                            "required": ["type", "data"]
                        }
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional tags for the page"
                    }
                },
                "required": ["notebook_name", "title", "content_blocks"]
            }
        }
    }
]


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


async def chat_with_tools(
    user_message: str,
    page_context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    available_notebooks: list[dict[str, str]] | None = None,
    current_notebook_id: str | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Chat with AI using tools for notebook/page creation.

    This function enables the AI to create notebooks and pages based on
    user requests. It returns both the AI response and any actions that
    need to be executed.

    Args:
        user_message: The user's message.
        page_context: Optional current page context.
        conversation_history: Previous messages in the conversation.
        available_notebooks: List of existing notebooks with 'id' and 'name'.
        current_notebook_id: ID of the currently selected notebook.
        provider_type: One of 'openai', 'anthropic', 'ollama'.
        api_key: API key for the provider.
        model: Model to use.
        temperature: Sampling temperature.
        max_tokens: Maximum tokens in response.

    Returns:
        Dict with response content, metadata, and actions to execute.
    """
    from openai import AsyncOpenAI
    from anthropic import AsyncAnthropic

    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        model=model or "",
        temperature=temperature,
        max_tokens=max_tokens,
    )

    # Build messages
    messages: list[dict[str, Any]] = []

    # Build system prompt
    system_parts = [
        "You are a helpful AI assistant integrated into a personal notebook application called Katt.",
        "You have the ability to create notebooks and pages for the user.",
        "When the user asks you to create content, organize notes, or set up a system (like Agile Results, GTD, etc.), use the available tools to create the appropriate notebooks and pages.",
        "Create well-structured content with appropriate headings, lists, and organization.",
    ]

    if available_notebooks:
        notebook_names = [n.get("name", "") for n in available_notebooks]
        system_parts.append(f"\nExisting notebooks: {', '.join(notebook_names)}")

    if current_notebook_id and available_notebooks:
        current_nb = next((n for n in available_notebooks if n.get("id") == current_notebook_id), None)
        if current_nb:
            system_parts.append(f"Currently selected notebook: {current_nb.get('name')}")

    if page_context:
        ctx = PageContext(**page_context)
        system_parts.append(f"\nCurrent page: {ctx.title}")
        if ctx.tags:
            system_parts.append(f"Tags: {', '.join(ctx.tags)}")
        if ctx.content:
            system_parts.append(f"\nPage content:\n{ctx.content}")

    system_message = "\n".join(system_parts)

    # Handle based on provider
    actions: list[dict[str, Any]] = []
    response_content = ""
    thinking_content = ""
    response_model = config.model
    tokens_used = None

    if provider_type == "openai":
        client = AsyncOpenAI(api_key=api_key)

        # Build OpenAI messages
        oai_messages: list[dict[str, Any]] = [{"role": "system", "content": system_message}]
        if conversation_history:
            oai_messages.extend(conversation_history)
        oai_messages.append({"role": "user", "content": user_message})

        # First API call with tools
        response = await client.chat.completions.create(
            model=config.model,
            messages=oai_messages,
            tools=NOTEBOOK_TOOLS,
            tool_choice="auto",
            temperature=config.temperature,
            max_tokens=config.max_tokens,
        )

        response_model = response.model
        if response.usage:
            tokens_used = response.usage.total_tokens

        choice = response.choices[0]

        # Process tool calls if any
        while choice.finish_reason == "tool_calls" and choice.message.tool_calls:
            # Add assistant message with tool calls
            oai_messages.append({
                "role": "assistant",
                "content": choice.message.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in choice.message.tool_calls
                ]
            })

            # Process each tool call
            for tool_call in choice.message.tool_calls:
                func_name = tool_call.function.name
                func_args = json.loads(tool_call.function.arguments)

                # Record the action to be executed by Rust
                action = {
                    "tool": func_name,
                    "arguments": func_args,
                    "tool_call_id": tool_call.id,
                }
                actions.append(action)

                # Create a placeholder result (actual execution happens in Rust)
                if func_name == "create_notebook":
                    result = f"Created notebook: {func_args.get('name')}"
                elif func_name == "create_page":
                    result = f"Created page: {func_args.get('title')} in {func_args.get('notebook_name')}"
                else:
                    result = "Action completed"

                # Add tool result message
                oai_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })

            # Continue conversation after tool calls
            response = await client.chat.completions.create(
                model=config.model,
                messages=oai_messages,
                tools=NOTEBOOK_TOOLS,
                tool_choice="auto",
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )

            if response.usage:
                tokens_used = (tokens_used or 0) + response.usage.total_tokens

            choice = response.choices[0]

        response_content = choice.message.content or ""

    elif provider_type == "anthropic":
        client = AsyncAnthropic(api_key=api_key)

        # Convert tools to Anthropic format
        anthropic_tools = [
            {
                "name": t["function"]["name"],
                "description": t["function"]["description"],
                "input_schema": t["function"]["parameters"]
            }
            for t in NOTEBOOK_TOOLS
        ]

        # Build Anthropic messages
        ant_messages: list[dict[str, Any]] = []
        if conversation_history:
            ant_messages.extend(conversation_history)
        ant_messages.append({"role": "user", "content": user_message})

        # First API call with tools
        response = await client.messages.create(
            model=config.model,
            system=system_message,
            messages=ant_messages,
            tools=anthropic_tools,
            max_tokens=config.max_tokens,
        )

        response_model = response.model
        tokens_used = response.usage.input_tokens + response.usage.output_tokens

        # Process tool use blocks
        while response.stop_reason == "tool_use":
            # Get all content from response
            assistant_content = response.content
            ant_messages.append({"role": "assistant", "content": assistant_content})

            # Process tool use blocks
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    func_name = block.name
                    func_args = block.input

                    # Record the action
                    action = {
                        "tool": func_name,
                        "arguments": func_args,
                        "tool_call_id": block.id,
                    }
                    actions.append(action)

                    # Create placeholder result
                    if func_name == "create_notebook":
                        result = f"Created notebook: {func_args.get('name')}"
                    elif func_name == "create_page":
                        result = f"Created page: {func_args.get('title')} in {func_args.get('notebook_name')}"
                    else:
                        result = "Action completed"

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })

            # Add tool results
            ant_messages.append({"role": "user", "content": tool_results})

            # Continue conversation
            response = await client.messages.create(
                model=config.model,
                system=system_message,
                messages=ant_messages,
                tools=anthropic_tools,
                max_tokens=config.max_tokens,
            )

            tokens_used += response.usage.input_tokens + response.usage.output_tokens

        # Extract final text response and thinking
        thinking_content = ""
        for block in response.content:
            if hasattr(block, "text"):
                response_content += block.text
            elif block.type == "thinking":
                thinking_content = block.thinking

    else:
        # Ollama doesn't support native tool use, fall back to regular chat
        # with instructions to output JSON actions
        result = await chat_with_context(
            user_message,
            page_context,
            conversation_history,
            provider_type,
            api_key,
            model,
            temperature,
            max_tokens,
        )
        return {
            **result,
            "actions": [],
        }

    return {
        "content": response_content,
        "model": response_model,
        "provider": provider_type,
        "tokens_used": tokens_used,
        "finish_reason": "stop",
        "actions": actions,
        "thinking": thinking_content,
    }


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


async def suggest_related_pages(
    content: str,
    title: str,
    available_pages: list[dict[str, str]],
    existing_links: list[str] | None = None,
    max_suggestions: int = 5,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> list[dict[str, str]]:
    """Suggest related pages to link based on content analysis.

    Uses AI to analyze the current page content and find conceptually
    related pages from the available pages list.

    Args:
        content: The page content to analyze.
        title: Title of the current page.
        available_pages: List of dicts with 'id', 'title', and optionally 'summary' keys.
        existing_links: Page titles already linked from the current page.
        max_suggestions: Maximum number of suggestions to return.
        provider_type: AI provider to use.
        api_key: API key for the provider.
        model: Model to use.

    Returns:
        List of dicts with 'id', 'title', and 'reason' keys for suggested pages.
    """
    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        model=model or "",
        temperature=0.3,  # Low temperature for consistent suggestions
        max_tokens=1000,
    )

    provider = get_provider(config)
    return await provider.suggest_related_pages(
        content, title, available_pages, existing_links, max_suggestions
    )


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


def suggest_related_pages_sync(
    content: str,
    title: str,
    available_pages: list[dict[str, str]],
    existing_links: list[str] | None = None,
    max_suggestions: int = 5,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> list[dict[str, str]]:
    """Synchronous wrapper for suggest_related_pages function."""
    return asyncio.run(
        suggest_related_pages(
            content,
            title,
            available_pages,
            existing_links,
            max_suggestions,
            provider_type,
            api_key,
            model,
        )
    )


def chat_with_tools_sync(
    user_message: str,
    page_context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    available_notebooks: list[dict[str, str]] | None = None,
    current_notebook_id: str | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Synchronous wrapper for chat_with_tools function."""
    return asyncio.run(
        chat_with_tools(
            user_message,
            page_context,
            conversation_history,
            available_notebooks,
            current_notebook_id,
            provider_type,
            api_key,
            model,
            temperature,
            max_tokens,
        )
    )
