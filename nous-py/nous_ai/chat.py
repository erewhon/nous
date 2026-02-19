"""Chat functionality for Katt AI."""

import asyncio
import json
import re
from typing import Any, Generator

from nous_ai.models import (
    ChatMessage,
    ChatResponse,
    MCPTool,
    PageContext,
    ProviderConfig,
    ProviderType,
)
from nous_ai.providers import get_provider
from nous_ai.browser_automation import BROWSER_USE_AVAILABLE

# MCP tool namespace prefix
MCP_TOOL_PREFIX = "mcp:"


def is_mcp_tool(tool_name: str) -> bool:
    """Check if a tool name refers to an MCP tool."""
    return tool_name.startswith(MCP_TOOL_PREFIX)


def parse_mcp_tool_name(namespaced_name: str) -> tuple[str, str]:
    """Parse 'mcp:server:tool' -> (server_name, tool_name)."""
    if not is_mcp_tool(namespaced_name):
        raise ValueError(f"Not an MCP tool: {namespaced_name}")
    parts = namespaced_name[len(MCP_TOOL_PREFIX):].split(":", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid MCP tool name format: {namespaced_name}")
    return parts[0], parts[1]


def format_mcp_tool_name(server_name: str, tool_name: str) -> str:
    """Format server and tool names into namespaced format."""
    return f"{MCP_TOOL_PREFIX}{server_name}:{tool_name}"


def convert_mcp_tools_to_openai_format(mcp_tools: list[MCPTool]) -> list[dict]:
    """Convert MCP tools to OpenAI function calling format."""
    tools = []
    for tool in mcp_tools:
        namespaced_name = format_mcp_tool_name(tool.server_name, tool.name)
        tools.append({
            "type": "function",
            "function": {
                "name": namespaced_name,
                "description": tool.description or f"MCP tool: {tool.name} from {tool.server_name}",
                "parameters": tool.input_schema if tool.input_schema else {
                    "type": "object",
                    "properties": {},
                },
            },
        })
    return tools


def _split_into_chunks(text: str, chunk_size: int = 20) -> Generator[str, None, None]:
    """Split text into chunks for simulated streaming.

    Yields approximately chunk_size characters at a time, breaking
    at newlines or spaces when possible. All whitespace (including
    newlines and indentation) is preserved exactly.
    """
    if not text:
        return

    i = 0
    while i < len(text):
        end = min(i + chunk_size, len(text))

        # If not at the end, try to break at a newline or space
        if end < len(text):
            # Prefer breaking at a newline
            nl_pos = text.find("\n", i, end)
            if nl_pos >= 0:
                end = nl_pos + 1
            else:
                # Try to break at a space
                space_pos = text.rfind(" ", i, end)
                if space_pos > i:
                    end = space_pos + 1

        yield text[i:end]
        i = end


def _emit_chunks_with_delay(callback: Any, event_type: str, text: str) -> None:
    """Emit text chunks with a small delay for streaming effect."""
    import time
    for chunk in _split_into_chunks(text):
        callback({"type": event_type, "content": chunk})
        time.sleep(0.02)  # 20ms delay between chunks for visible streaming


# Tool definitions for notebook/page creation and actions
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
    },
    {
        "type": "function",
        "function": {
            "name": "run_action",
            "description": "Run a custom action by name. Actions are automations that can create pages, notebooks, manage tags, and more. Use this when the user asks to run an action like 'daily goals', 'weekly review', or any other custom workflow they have set up.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action_name": {
                        "type": "string",
                        "description": "Name of the action to run. This can be a partial match - the system will find the best matching action."
                    },
                    "variables": {
                        "type": "object",
                        "description": "Optional variables to pass to the action. Keys are variable names, values are strings.",
                        "additionalProperties": {"type": "string"}
                    }
                },
                "required": ["action_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_actions",
            "description": "List available custom actions. Use this when the user asks what actions are available, or when you need to know what workflows are set up.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": ["agileResults", "dailyRoutines", "weeklyReviews", "organization", "custom", "all"],
                        "description": "Filter by action category. Use 'all' to see all actions."
                    }
                },
                "required": []
            }
        }
    },
]

# Browser tool - only included if browser-use is installed
BROWSER_TOOL = {
    "type": "function",
    "function": {
        "name": "browse_web",
        "description": "Use an AI-controlled browser to interact with websites. Use this when you need to: navigate dynamic/JavaScript-heavy pages, fill forms, click buttons, log in to sites, or extract data that requires browser interaction. The browser will autonomously complete the task you describe.",
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Detailed description of what to do in the browser. Be specific about: the website to visit, actions to take, and what information to extract. Example: 'Go to github.com/browser-use/browser-use and extract the number of stars and the latest release version'"
                },
                "capture_screenshot": {
                    "type": "boolean",
                    "description": "Whether to capture a screenshot of the final page state",
                    "default": False
                }
            },
            "required": ["task"]
        }
    }
}

# Add browser tool only if browser-use is available
if BROWSER_USE_AVAILABLE:
    NOTEBOOK_TOOLS.append(BROWSER_TOOL)


async def chat(
    messages: list[dict[str, str]],
    provider_type: str = "openai",
    api_key: str | None = None,
    base_url: str | None = None,
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
        base_url: Custom base URL for the provider (for vLLM, LMStudio, etc.).
        model: Model to use (uses provider default if not specified).
        temperature: Sampling temperature (0.0 to 2.0).
        max_tokens: Maximum tokens in response.

    Returns:
        Dict with response content and metadata.
    """
    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        base_url=base_url,
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
    base_url: str | None = None,
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
        base_url=base_url,
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
    base_url: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    system_prompt: str | None = None,
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
        system_prompt: Custom system prompt (overrides default).

    Returns:
        Dict with response content, metadata, and actions to execute.
    """
    from openai import AsyncOpenAI
    from anthropic import AsyncAnthropic

    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        base_url=base_url,
        model=model or "",
        temperature=temperature,
        max_tokens=max_tokens,
    )

    # Build messages
    messages: list[dict[str, Any]] = []

    # Strong tool usage instructions - always appended
    tool_instructions = """
CRITICAL TOOL USAGE INSTRUCTIONS:
You have tools available: create_page, create_notebook, run_action, list_actions.

When the user asks you to "create", "write", "make", "generate", or "save" ANY content (code, notes, documentation, etc.):
1. You MUST use the create_page tool to actually create the page
2. Do NOT just write the content in your response - actually CALL the create_page tool
3. The create_page tool takes: notebook_name ("current" for selected notebook), title, content_blocks (array), and optional tags
4. After calling create_page, provide a brief summary of what you created

Example: If user says "Create a Python function that calculates factorial" - you should call create_page with the code, NOT just write the code in your response.
"""

    # Build system prompt - use custom prompt if provided, otherwise use default
    if system_prompt:
        system_parts = [system_prompt]
        system_parts.append(tool_instructions)
    else:
        system_parts = [
            "You are a helpful AI assistant integrated into a personal notebook application called Katt.",
            tool_instructions,
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
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)

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
                elif func_name == "run_action":
                    result = f"Running action: {func_args.get('action_name')}"
                elif func_name == "list_actions":
                    result = "Listing actions"
                elif func_name == "browse_web":
                    task_preview = func_args.get('task', '')[:100]
                    result = f"Browser task initiated: {task_preview}..."
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
            tool_choice={"type": "auto"},
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
                    elif func_name == "run_action":
                        result = f"Running action: {func_args.get('action_name')}"
                    elif func_name == "list_actions":
                        result = "Listing actions"
                    elif func_name == "browse_web":
                        task_preview = func_args.get('task', '')[:100]
                        result = f"Browser task initiated: {task_preview}..."
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
                tool_choice={"type": "auto"},
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


async def summarize_pages(
    pages: list[dict[str, Any]],
    custom_prompt: str | None = None,
    summary_style: str = "concise",
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Summarize multiple pages into a single summary.

    This is useful for weekly reviews, project summaries, or batch processing.

    Args:
        pages: List of page dicts with 'title', 'content', and optionally 'tags'.
        custom_prompt: Custom prompt to use instead of default summary prompt.
        summary_style: Style of summary - 'concise', 'detailed', 'bullets', 'narrative'.
        provider_type: AI provider to use.
        api_key: API key for the provider.
        model: Model to use.

    Returns:
        Dict with summary, key_points, and metadata.
    """
    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        model=model or "",
        temperature=0.5,
        max_tokens=4096,
    )

    provider = get_provider(config)

    # Build combined content from all pages
    combined_content = ""
    for i, page in enumerate(pages, 1):
        title = page.get("title", f"Page {i}")
        content = page.get("content", "")
        tags = page.get("tags", [])
        tag_str = f" [Tags: {', '.join(tags)}]" if tags else ""
        combined_content += f"\n\n--- {title}{tag_str} ---\n{content}"

    # Build the prompt based on style
    style_instructions = {
        "concise": "Provide a brief, focused summary highlighting the most important points.",
        "detailed": "Provide a comprehensive summary covering all significant details and nuances.",
        "bullets": "Summarize using bullet points, organized by theme or topic.",
        "narrative": "Write a flowing narrative summary that tells the story of these pages.",
    }

    style_instruction = style_instructions.get(summary_style, style_instructions["concise"])

    if custom_prompt:
        prompt = f"""{custom_prompt}

Pages to summarize:
{combined_content}"""
    else:
        prompt = f"""Summarize the following {len(pages)} page(s). {style_instruction}

Also extract:
1. Key points (3-7 bullet points)
2. Action items or todos mentioned (if any)
3. Themes or topics covered

Pages:
{combined_content}

Respond in the following JSON format:
{{
    "summary": "Your summary here",
    "key_points": ["point 1", "point 2", ...],
    "action_items": ["item 1", "item 2", ...],
    "themes": ["theme 1", "theme 2", ...]
}}"""

    messages = [{"role": "user", "content": prompt}]
    response = await provider.chat(messages)

    # Try to parse JSON response, fallback to plain text
    content = response.content
    try:
        import json
        # Find JSON in response
        start = content.find("{")
        end = content.rfind("}") + 1
        if start >= 0 and end > start:
            result = json.loads(content[start:end])
            return {
                "summary": result.get("summary", content),
                "key_points": result.get("key_points", []),
                "action_items": result.get("action_items", []),
                "themes": result.get("themes", []),
                "pages_count": len(pages),
                "model": response.model,
                "tokens_used": response.tokens_used,
            }
    except json.JSONDecodeError:
        pass

    # Fallback if JSON parsing fails
    return {
        "summary": content,
        "key_points": [],
        "action_items": [],
        "themes": [],
        "pages_count": len(pages),
        "model": response.model,
        "tokens_used": response.tokens_used,
    }


# Synchronous wrappers for PyO3 (called from Rust)
def chat_sync(
    messages: list[dict[str, str]],
    provider_type: str = "openai",
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Synchronous wrapper for chat function."""
    return asyncio.run(
        chat(messages, provider_type, api_key, base_url=base_url, model=model,
             temperature=temperature, max_tokens=max_tokens)
    )


def chat_with_context_sync(
    user_message: str,
    page_context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    base_url: str | None = None,
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
            base_url=base_url,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
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


def summarize_pages_sync(
    pages: list[dict[str, Any]],
    custom_prompt: str | None = None,
    summary_style: str = "concise",
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for summarize_pages function."""
    return asyncio.run(
        summarize_pages(pages, custom_prompt, summary_style, provider_type, api_key, model)
    )


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
    system_prompt: str | None = None,
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
            system_prompt,
        )
    )


async def chat_with_tools_stream(
    user_message: str,
    callback: Any,  # Callable that receives event dicts
    page_context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    available_notebooks: list[dict[str, str]] | None = None,
    current_notebook_id: str | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    system_prompt: str | None = None,
    library_path: str | None = None,
) -> dict[str, Any]:
    """Chat with AI using tools, streaming the response via callback.

    The callback receives events of different types:
    - {"type": "chunk", "content": "..."} - Text chunk
    - {"type": "thinking", "content": "..."} - Thinking content (Anthropic)
    - {"type": "action", "tool": "...", "arguments": {...}, "tool_call_id": "..."} - Tool action
    - {"type": "done", "model": "...", "tokens_used": N} - Completion

    Args:
        library_path: Path to the library for MCP server access. If provided, MCP tools
                      will be loaded and made available to the AI.

    Returns the final complete response dict.
    """
    from openai import AsyncOpenAI
    from anthropic import AsyncAnthropic

    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        base_url=base_url,
        model=model or "",
        temperature=temperature,
        max_tokens=max_tokens,
    )

    # Load MCP tools if library_path is provided
    mcp_tools: list[MCPTool] = []
    mcp_manager = None
    if library_path:
        try:
            from nous_ai.mcp_client import get_manager
            mcp_manager = get_manager(library_path)
            mcp_tools = await mcp_manager.get_all_tools()
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to load MCP tools: {e}")

    # Merge NOTEBOOK_TOOLS with MCP tools
    all_tools = list(NOTEBOOK_TOOLS)
    if mcp_tools:
        all_tools.extend(convert_mcp_tools_to_openai_format(mcp_tools))

    # Strong tool usage instructions - always appended
    tool_instructions = """
CRITICAL TOOL USAGE INSTRUCTIONS:
You have tools available: create_page, create_notebook, run_action, list_actions.

When the user asks you to "create", "write", "make", "generate", or "save" ANY content (code, notes, documentation, etc.):
1. You MUST use the create_page tool to actually create the page
2. Do NOT just write the content in your response - actually CALL the create_page tool
3. The create_page tool takes: notebook_name ("current" for selected notebook), title, content_blocks (array), and optional tags
4. After calling create_page, provide a brief summary of what you created

Example: If user says "Create a Python function that calculates factorial" - you should call create_page with the code, NOT just write the code in your response.
"""

    # Build system prompt - use custom prompt if provided, otherwise use default
    if system_prompt:
        system_parts = [system_prompt]
        system_parts.append(tool_instructions)
    else:
        system_parts = [
            "You are a helpful AI assistant integrated into a personal notebook application called Katt.",
            tool_instructions,
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

    actions: list[dict[str, Any]] = []
    response_content = ""
    thinking_content = ""
    response_model = config.model
    tokens_used = 0

    # Validate API key for cloud providers
    if provider_type in ("openai", "anthropic") and not api_key:
        import os
        env_key = os.environ.get("OPENAI_API_KEY" if provider_type == "openai" else "ANTHROPIC_API_KEY")
        if not env_key:
            raise ValueError(f"No API key provided for {provider_type}. Please configure your API key in Settings > AI Providers.")

    if provider_type == "openai":
        client = AsyncOpenAI(api_key=api_key, base_url=base_url)

        oai_messages: list[dict[str, Any]] = [{"role": "system", "content": system_message}]
        if conversation_history:
            oai_messages.extend(conversation_history)
        oai_messages.append({"role": "user", "content": user_message})

        # First, handle tool calls (non-streaming since we need complete tool data)
        response = await client.chat.completions.create(
            model=config.model,
            messages=oai_messages,
            tools=all_tools,
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

            for tool_call in choice.message.tool_calls:
                func_name = tool_call.function.name
                func_args = json.loads(tool_call.function.arguments)

                action = {
                    "tool": func_name,
                    "arguments": func_args,
                    "tool_call_id": tool_call.id,
                }
                actions.append(action)

                # Emit action event
                callback({"type": "action", **action})

                # Handle MCP tools differently - they execute and return results
                if is_mcp_tool(func_name):
                    if mcp_manager:
                        server_name, tool_name = parse_mcp_tool_name(func_name)
                        mcp_result = await mcp_manager.call_tool(server_name, tool_name, func_args)
                        if mcp_result.success:
                            result = str(mcp_result.content) if mcp_result.content else "Tool executed successfully"
                        else:
                            result = f"Tool error: {mcp_result.error}"
                    else:
                        result = "MCP server not available"
                elif func_name == "create_notebook":
                    result = f"Created notebook: {func_args.get('name')}"
                elif func_name == "create_page":
                    result = f"Created page: {func_args.get('title')} in {func_args.get('notebook_name')}"
                elif func_name == "run_action":
                    result = f"Running action: {func_args.get('action_name')}"
                elif func_name == "list_actions":
                    result = "Listing actions"
                elif func_name == "browse_web":
                    task_preview = func_args.get('task', '')[:100]
                    result = f"Browser task initiated: {task_preview}..."
                else:
                    result = "Action completed"

                oai_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })

            # Continue with streaming for the final response
            response = await client.chat.completions.create(
                model=config.model,
                messages=oai_messages,
                tools=all_tools,
                tool_choice="auto",
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )

            if response.usage:
                tokens_used += response.usage.total_tokens

            choice = response.choices[0]

        # If no more tool calls, emit the response
        if choice.finish_reason != "tool_calls":
            # If we have content from the non-streaming response, emit it
            if choice.message.content:
                response_content = choice.message.content
                # Emit in chunks with delay for visible streaming effect
                _emit_chunks_with_delay(callback, "chunk", response_content)

    elif provider_type == "anthropic":
        import logging
        logger = logging.getLogger(__name__)

        client = AsyncAnthropic(api_key=api_key)

        anthropic_tools = [
            {
                "name": t["function"]["name"],
                "description": t["function"]["description"],
                "input_schema": t["function"]["parameters"]
            }
            for t in all_tools
        ]

        logger.info(f"[Anthropic] Making request with {len(anthropic_tools)} tools")
        logger.info(f"[Anthropic] Tool names: {[t['name'] for t in anthropic_tools]}")

        ant_messages: list[dict[str, Any]] = []
        if conversation_history:
            ant_messages.extend(conversation_history)
        ant_messages.append({"role": "user", "content": user_message})

        # First, handle tool calls (non-streaming)
        # Use tool_choice=auto to let model decide, but ensure tools are available
        response = await client.messages.create(
            model=config.model,
            system=system_message,
            messages=ant_messages,
            tools=anthropic_tools,
            tool_choice={"type": "auto"},
            max_tokens=config.max_tokens,
        )

        response_model = response.model
        tokens_used = response.usage.input_tokens + response.usage.output_tokens

        # Log response details for debugging
        logger.info(f"[Anthropic] Response stop_reason: {response.stop_reason}")
        logger.info(f"[Anthropic] Response content blocks: {len(response.content)}")
        for i, block in enumerate(response.content):
            logger.info(f"[Anthropic] Block {i}: type={block.type}")
            if block.type == "tool_use":
                logger.info(f"[Anthropic] Tool use detected: {block.name}")

        # Process tool use
        while response.stop_reason == "tool_use":
            assistant_content = response.content
            ant_messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    func_name = block.name
                    func_args = block.input

                    action = {
                        "tool": func_name,
                        "arguments": func_args,
                        "tool_call_id": block.id,
                    }
                    actions.append(action)
                    callback({"type": "action", **action})

                    # Handle MCP tools differently - they execute and return results
                    if is_mcp_tool(func_name):
                        if mcp_manager:
                            server_name, tool_name = parse_mcp_tool_name(func_name)
                            mcp_result = await mcp_manager.call_tool(server_name, tool_name, func_args)
                            if mcp_result.success:
                                result = str(mcp_result.content) if mcp_result.content else "Tool executed successfully"
                            else:
                                result = f"Tool error: {mcp_result.error}"
                        else:
                            result = "MCP server not available"
                    elif func_name == "create_notebook":
                        result = f"Created notebook: {func_args.get('name')}"
                    elif func_name == "create_page":
                        result = f"Created page: {func_args.get('title')} in {func_args.get('notebook_name')}"
                    elif func_name == "run_action":
                        result = f"Running action: {func_args.get('action_name')}"
                    elif func_name == "list_actions":
                        result = "Listing actions"
                    elif func_name == "browse_web":
                        task_preview = func_args.get('task', '')[:100]
                        result = f"Browser task initiated: {task_preview}..."
                    else:
                        result = "Action completed"

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })

            ant_messages.append({"role": "user", "content": tool_results})

            response = await client.messages.create(
                model=config.model,
                system=system_message,
                messages=ant_messages,
                tools=anthropic_tools,
                tool_choice={"type": "auto"},
                max_tokens=config.max_tokens,
            )

            tokens_used += response.usage.input_tokens + response.usage.output_tokens

        # Emit the final response from the existing response object
        if response.stop_reason != "tool_use":
            # Extract content from response blocks
            for block in response.content:
                if hasattr(block, "text"):
                    response_content += block.text
                elif block.type == "thinking" and hasattr(block, "thinking"):
                    thinking_content += block.thinking

            # Emit content in chunks with delay for visible streaming effect
            if thinking_content:
                _emit_chunks_with_delay(callback, "thinking", thinking_content)
            if response_content:
                _emit_chunks_with_delay(callback, "chunk", response_content)

    else:
        # Ollama/LMStudio/other - fall back to non-streaming
        result = await chat_with_context(
            user_message,
            page_context,
            conversation_history,
            provider_type,
            api_key,
            base_url,
            model,
            temperature,
            max_tokens,
        )
        response_content = result.get("content", "")
        response_model = result.get("model", "")
        tokens_used = result.get("tokens_used", 0) or 0
        # Emit in chunks with delay for streaming effect
        _emit_chunks_with_delay(callback, "chunk", response_content)

    # Emit done event
    callback({
        "type": "done",
        "model": response_model,
        "tokens_used": tokens_used,
    })

    return {
        "content": response_content,
        "model": response_model,
        "provider": provider_type,
        "tokens_used": tokens_used,
        "finish_reason": "stop",
        "actions": actions,
        "thinking": thinking_content,
    }


def chat_with_tools_stream_sync(
    user_message: str,
    callback: Any,
    page_context: dict[str, Any] | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    available_notebooks: list[dict[str, str]] | None = None,
    current_notebook_id: str | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    system_prompt: str | None = None,
    library_path: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for streaming chat with callback.

    This wrapper catches exceptions and emits them as error events via the callback,
    ensuring the frontend always receives feedback about what happened.
    """
    try:
        return asyncio.run(
            chat_with_tools_stream(
                user_message,
                callback,
                page_context,
                conversation_history,
                available_notebooks,
                current_notebook_id,
                provider_type,
                api_key,
                base_url,
                model,
                temperature,
                max_tokens,
                system_prompt,
                library_path,
            )
        )
    except Exception as e:
        # Emit error event so frontend knows what happened
        error_message = str(e)
        # Check for common issues and provide helpful messages
        if "api_key" in error_message.lower() or "authentication" in error_message.lower():
            error_message = f"API key error: {error_message}. Please check your API key in Settings."
        elif "rate limit" in error_message.lower():
            error_message = f"Rate limit exceeded: {error_message}. Please wait a moment and try again."
        elif "model" in error_message.lower() and "not found" in error_message.lower():
            error_message = f"Model not found: {error_message}. Please check your model settings."

        callback({"type": "error", "message": error_message})
        return {
            "content": "",
            "model": model or "",
            "provider": provider_type,
            "tokens_used": 0,
            "finish_reason": "error",
            "actions": [],
            "thinking": "",
        }


def discover_chat_models_sync(provider: str, base_url: str) -> list[dict[str, str]]:
    """Discover available chat models from a local provider.

    Args:
        provider: Provider type ('ollama' or 'lmstudio').
        base_url: Base URL of the provider server.

    Returns:
        List of dicts with 'id' and 'name' keys.
    """
    import urllib.request
    import urllib.error

    try:
        if provider == "ollama":
            url = f"{base_url.rstrip('/')}/api/tags"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                models = data.get("models", [])
                return [
                    {"id": m.get("name", ""), "name": m.get("name", "")}
                    for m in models
                    if m.get("name")
                ]
        elif provider == "lmstudio":
            url = f"{base_url.rstrip('/')}/v1/models"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                models = data.get("data", [])
                return [
                    {"id": m.get("id", ""), "name": m.get("id", "")}
                    for m in models
                    if m.get("id")
                ]
        else:
            return []
    except (urllib.error.URLError, OSError, json.JSONDecodeError, KeyError):
        return []
