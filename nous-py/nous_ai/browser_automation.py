"""Browser automation using browser-use for AI-powered web interaction.

Note: browser-use is an optional dependency. Install with:
    uv pip install browser-use
    uvx browser-use install  # Installs Chromium
"""

import asyncio
import base64
from typing import Any

from pydantic import BaseModel

# Check if browser-use is available
BROWSER_USE_AVAILABLE = False
try:
    from browser_use import Agent, Browser
    BROWSER_USE_AVAILABLE = True
except ImportError:
    pass


class BrowserTaskResult(BaseModel):
    """Result from a browser automation task."""

    success: bool
    content: str  # Extracted text/data
    screenshot: str | None = None  # Base64 PNG if requested
    structured_data: dict[str, Any] | None = None  # If output_schema provided
    error: str | None = None


async def run_browser_task(
    task: str,
    provider_type: str,
    api_key: str,
    model: str,
    capture_screenshot: bool = False,
    max_actions: int = 20,
    timeout: int = 120,
) -> dict[str, Any]:
    """Execute a browser automation task using AI.

    Args:
        task: Description of the task to perform in the browser.
        provider_type: AI provider - "openai" or "anthropic".
        api_key: API key for the provider.
        model: Model name to use.
        capture_screenshot: Whether to capture a screenshot of the final page.
        max_actions: Maximum number of browser actions to take.
        timeout: Timeout in seconds for the entire task.

    Returns:
        Dict containing success status, content, optional screenshot, and error.
    """
    if not BROWSER_USE_AVAILABLE:
        return BrowserTaskResult(
            success=False,
            content="",
            error="browser-use is not installed. Install with: uv pip install browser-use && uvx browser-use install",
        ).model_dump()

    try:
        # Configure LLM based on provider
        if provider_type == "openai":
            from browser_use import ChatOpenAI

            llm = ChatOpenAI(model=model, api_key=api_key)
        elif provider_type == "anthropic":
            from browser_use import ChatAnthropic

            llm = ChatAnthropic(model=model, api_key=api_key)
        else:
            return BrowserTaskResult(
                success=False,
                content="",
                error=f"Unsupported provider: {provider_type}. Use 'openai' or 'anthropic'.",
            ).model_dump()

        browser = Browser()

        try:
            agent = Agent(
                task=task,
                llm=llm,
                browser=browser,
                max_actions_per_step=4,
                generate_gif=False,
            )

            # Run the agent with timeout
            history = await asyncio.wait_for(
                agent.run(max_steps=max_actions),
                timeout=timeout,
            )

            # Extract final result - browser-use returns AgentHistoryList
            if hasattr(history, "final_result"):
                result_content = history.final_result()
            elif hasattr(history, "last_result"):
                result_content = str(history.last_result())
            else:
                # Fallback: extract from history
                result_content = str(history)

            # Ensure result is a string
            if result_content is None:
                result_content = "Task completed but no explicit result returned."
            elif not isinstance(result_content, str):
                result_content = str(result_content)

            screenshot_b64 = None
            if capture_screenshot:
                try:
                    # Get the current page and capture screenshot
                    page = await browser.get_current_page()
                    if page:
                        screenshot_bytes = await page.screenshot()
                        screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
                except Exception as e:
                    # Non-fatal: screenshot capture failed but task may have succeeded
                    result_content += f"\n(Screenshot capture failed: {e})"

            return BrowserTaskResult(
                success=True,
                content=result_content,
                screenshot=screenshot_b64,
            ).model_dump()

        finally:
            await browser.close()

    except asyncio.TimeoutError:
        return BrowserTaskResult(
            success=False,
            content="",
            error=f"Task timed out after {timeout} seconds",
        ).model_dump()
    except ImportError as e:
        return BrowserTaskResult(
            success=False,
            content="",
            error=f"browser-use not installed or import error: {e}",
        ).model_dump()
    except Exception as e:
        return BrowserTaskResult(
            success=False,
            content="",
            error=str(e),
        ).model_dump()


def run_browser_task_sync(
    task: str,
    provider_type: str,
    api_key: str,
    model: str,
    capture_screenshot: bool = False,
    max_actions: int = 20,
    timeout: int = 120,
) -> dict[str, Any]:
    """Synchronous wrapper for run_browser_task (for PyO3 bridge).

    Args:
        task: Description of the task to perform in the browser.
        provider_type: AI provider - "openai" or "anthropic".
        api_key: API key for the provider.
        model: Model name to use.
        capture_screenshot: Whether to capture a screenshot of the final page.
        max_actions: Maximum number of browser actions to take.
        timeout: Timeout in seconds for the entire task.

    Returns:
        Dict containing success status, content, optional screenshot, and error.
    """
    return asyncio.run(
        run_browser_task(
            task=task,
            provider_type=provider_type,
            api_key=api_key,
            model=model,
            capture_screenshot=capture_screenshot,
            max_actions=max_actions,
            timeout=timeout,
        )
    )
