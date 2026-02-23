"""Multimodal AI vision analysis for app monitoring.

Analyzes screenshots of desktop applications using vision-capable AI models
to extract structured information about notifications, messages, etc.
"""

import asyncio
import base64
import json
from pathlib import Path
from typing import Any

from nous_ai.models import ProviderConfig, ProviderType

VISION_SYSTEM_PROMPT = """You are an AI assistant that analyzes screenshots of desktop applications.
Your task is to extract structured information about the visible content.

Analyze the screenshot and return a JSON object with the following structure:
{
  "app_name": "name of the application shown",
  "summary": "brief summary of what's visible",
  "items": [
    {
      "item_type": "message|email|notification|task|other",
      "sender": "who sent it (if applicable)",
      "subject": "subject or title (if applicable)",
      "content": "brief content summary",
      "timestamp": "when it was sent/received (if visible)",
      "urgency": "low|medium|high",
      "is_unread": true/false
    }
  ],
  "unread_count": 0
}

Focus on extracting actionable information. If you can see unread messages,
notifications, or items requiring attention, include them in the items array.
Return ONLY the JSON object, no other text."""


async def analyze_screenshot(
    image_path: str,
    prompt: str | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    watch_instructions: str | None = None,
) -> dict[str, Any]:
    """Analyze a screenshot using a vision-capable AI model.

    Args:
        image_path: Path to the screenshot image file.
        prompt: Optional custom prompt (appended to system prompt).
        provider_type: AI provider to use ("openai" or "anthropic").
        api_key: API key for the provider.
        model: Model to use (defaults to provider's vision model).
        base_url: Optional base URL override.
        watch_instructions: Optional per-target custom instructions.

    Returns:
        Parsed JSON response with extracted information.
    """
    image_data = Path(image_path).read_bytes()
    b64_image = base64.b64encode(image_data).decode("utf-8")

    user_prompt = "Analyze this screenshot and extract all visible information."
    if watch_instructions:
        user_prompt += f"\n\nAdditional instructions: {watch_instructions}"
    if prompt:
        user_prompt += f"\n\n{prompt}"

    ptype = ProviderType(provider_type)

    if ptype == ProviderType.ANTHROPIC:
        result = await _analyze_anthropic(
            b64_image, user_prompt, api_key, model or "claude-sonnet-4-20250514"
        )
    elif ptype == ProviderType.OLLAMA:
        result = await _analyze_ollama(
            b64_image, user_prompt, model or "llava", base_url
        )
    else:
        # OpenAI-compatible (OpenAI, LMStudio)
        result = await _analyze_openai(
            b64_image, user_prompt, api_key, model or "gpt-4o", base_url
        )

    return result


async def _analyze_openai(
    b64_image: str,
    prompt: str,
    api_key: str | None,
    model: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Analyze using OpenAI's vision API."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": VISION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{b64_image}",
                            "detail": "high",
                        },
                    },
                ],
            },
        ],
        max_tokens=4096,
        temperature=0.3,
    )

    content = response.choices[0].message.content or "{}"
    return _parse_json_response(content)


async def _analyze_anthropic(
    b64_image: str,
    prompt: str,
    api_key: str | None,
    model: str,
) -> dict[str, Any]:
    """Analyze using Anthropic's vision API."""
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=api_key)

    response = await client.messages.create(
        model=model,
        max_tokens=4096,
        system=VISION_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": b64_image,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )

    content = response.content[0].text if response.content else "{}"
    return _parse_json_response(content)


async def _analyze_ollama(
    b64_image: str,
    prompt: str,
    model: str,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Analyze using Ollama's vision models (llava, etc.)."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key="ollama",
        base_url=base_url or "http://localhost:11434/v1",
    )

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": VISION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{b64_image}",
                        },
                    },
                ],
            },
        ],
        max_tokens=4096,
        temperature=0.3,
    )

    content = response.choices[0].message.content or "{}"
    return _parse_json_response(content)


def _parse_json_response(text: str) -> dict[str, Any]:
    """Parse a JSON response, handling markdown code blocks."""
    text = text.strip()

    # Handle markdown code blocks
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last ``` lines
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {
            "app_name": "unknown",
            "summary": text[:500],
            "items": [],
            "unread_count": 0,
        }


def analyze_screenshot_sync(
    image_path: str,
    prompt: str | None = None,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    watch_instructions: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for analyze_screenshot (PyO3-compatible)."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(
                asyncio.run,
                analyze_screenshot(
                    image_path, prompt, provider_type, api_key, model, base_url,
                    watch_instructions,
                ),
            )
            return future.result()
    else:
        return asyncio.run(
            analyze_screenshot(
                image_path, prompt, provider_type, api_key, model, base_url,
                watch_instructions,
            )
        )
