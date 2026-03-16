#!/usr/bin/env python3
"""Test harness for OpenAI-compatible streaming with reasoning support."""

import asyncio
import sys
import os

# Add nous-py to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "nous-py"))

BASE_URL = "https://llm.peacock-bramble.ts.net"
API_KEY = "sk-litellm-master"


async def test_raw_stream(model: str):
    """Test raw OpenAI SDK streaming to see what fields come back."""
    from openai import AsyncOpenAI

    url = BASE_URL.rstrip("/")
    if not url.endswith("/v1"):
        url += "/v1"

    print(f"\n{'='*60}")
    print(f"RAW STREAM TEST: model={model}, url={url}")
    print(f"{'='*60}")

    client = AsyncOpenAI(api_key=API_KEY, base_url=url)

    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is 2+2? Be brief."},
        ],
        temperature=0.7,
        max_tokens=512,
        stream=True,
    )

    chunk_count = 0
    async for chunk in stream:
        chunk_count += 1
        if not chunk.choices:
            print(f"  chunk {chunk_count}: no choices, model={chunk.model}")
            continue

        delta = chunk.choices[0].delta
        finish = chunk.choices[0].finish_reason

        # Print all attributes on delta
        delta_attrs = {k: v for k, v in vars(delta).items() if v is not None and k != "_"}

        # Also check for reasoning via getattr (may not be in __dict__)
        for attr_name in ("reasoning", "reasoning_content"):
            val = getattr(delta, attr_name, None)
            if val is not None:
                delta_attrs[attr_name] = val

        print(f"  chunk {chunk_count}: finish={finish} delta={delta_attrs}")

    print(f"\nTotal chunks: {chunk_count}")


async def test_stream_with_tools(model: str):
    """Test streaming with tools parameter (like the app does)."""
    from openai import AsyncOpenAI

    url = BASE_URL.rstrip("/")
    if not url.endswith("/v1"):
        url += "/v1"

    print(f"\n{'='*60}")
    print(f"STREAM WITH TOOLS TEST: model={model}")
    print(f"{'='*60}")

    client = AsyncOpenAI(api_key=API_KEY, base_url=url)

    tools = [
        {
            "type": "function",
            "function": {
                "name": "create_page",
                "description": "Create a new page",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                    },
                    "required": ["title"],
                },
            },
        }
    ]

    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "What is 2+2? Be brief."},
            ],
            tools=tools,
            tool_choice="auto",
            temperature=0.7,
            max_tokens=512,
            stream=True,
        )

        chunk_count = 0
        content = ""
        thinking = ""

        async for chunk in stream:
            chunk_count += 1
            if not chunk.choices:
                continue

            delta = chunk.choices[0].delta
            finish = chunk.choices[0].finish_reason

            reasoning_text = getattr(delta, "reasoning", None) or getattr(delta, "reasoning_content", None)
            if reasoning_text:
                thinking += reasoning_text
                print(f"  [THINKING] {repr(reasoning_text[:80])}")

            if delta.content:
                content += delta.content
                print(f"  [CONTENT]  {repr(delta.content[:80])}")

            if delta.tool_calls:
                for tc in delta.tool_calls:
                    print(f"  [TOOL]     idx={tc.index} id={tc.id} fn={tc.function}")

            if finish:
                print(f"  [FINISH]   {finish}")

        print(f"\nTotal chunks: {chunk_count}")
        print(f"Content: {repr(content[:200])}")
        print(f"Thinking: {repr(thinking[:200])}")

    except Exception as e:
        print(f"ERROR: {e}")


async def test_nous_chat(model: str):
    """Test the actual nous chat_with_tools_stream function."""
    from nous_ai.chat import chat_with_tools_stream

    print(f"\n{'='*60}")
    print(f"NOUS CHAT TEST: model={model}")
    print(f"{'='*60}")

    events = []

    def callback(event):
        events.append(event)
        etype = event.get("type", "?")
        if etype == "chunk":
            print(f"  [CHUNK]    {repr(event['content'][:80])}")
        elif etype == "thinking":
            print(f"  [THINKING] {repr(event['content'][:80])}")
        elif etype == "action":
            print(f"  [ACTION]   {event['tool']}({event['arguments']})")
        elif etype == "done":
            print(f"  [DONE]     model={event.get('model')} tokens={event.get('tokens_used')}")
        elif etype == "error":
            print(f"  [ERROR]    {event.get('message')}")
        else:
            print(f"  [{etype}]  {event}")

    try:
        result = await chat_with_tools_stream(
            user_message="What is 2+2? Be brief.",
            callback=callback,
            provider_type="lmstudio",
            api_key=API_KEY,
            base_url=BASE_URL,
            model=model,
            temperature=0.7,
            max_tokens=512,
            system_prompt="You are a helpful assistant.",
        )
        print(f"\nResult: content={repr(result.get('content', '')[:200])}")
        print(f"        thinking={repr(result.get('thinking', '')[:200])}")
        print(f"Total events: {len(events)}")
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()


async def main():
    models = sys.argv[1:] if len(sys.argv) > 1 else ["research", "thinker"]

    for model in models:
        await test_raw_stream(model)
        await test_stream_with_tools(model)
        await test_nous_chat(model)


if __name__ == "__main__":
    asyncio.run(main())
