"""AWS Bedrock provider implementation."""

import json
from typing import Any

from katt_ai.models import ChatMessage, ChatResponse, ProviderConfig, ProviderType
from katt_ai.providers.base import BaseProvider

# Optional boto3 import
try:
    import boto3
    from botocore.config import Config as BotoConfig

    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False


def _parse_bedrock_credentials(api_key: str | None) -> dict[str, str] | None:
    """Parse Bedrock credentials from api_key field.

    Format: "access_key:secret_key" or empty/None to use default credentials.
    """
    if not api_key or api_key.strip() == "":
        return None

    if ":" in api_key:
        parts = api_key.split(":", 1)
        return {"access_key": parts[0], "secret_key": parts[1]}

    # If no colon, assume it's just the access key
    return {"access_key": api_key, "secret_key": ""}


class BedrockProvider(BaseProvider):
    """AWS Bedrock API provider using the Converse API."""

    def __init__(self, config: ProviderConfig) -> None:
        if not HAS_BOTO3:
            raise ImportError(
                "boto3 is required for Bedrock provider. "
                "Install with: pip install boto3"
            )

        super().__init__(config)

        # base_url is used as region for Bedrock
        region = config.base_url or "us-east-1"
        credentials = _parse_bedrock_credentials(config.api_key)

        # Configure boto3 client
        boto_config = BotoConfig(
            region_name=region,
            retries={"max_attempts": 3, "mode": "adaptive"},
        )

        if credentials and credentials.get("access_key") and credentials.get("secret_key"):
            self.client = boto3.client(
                "bedrock-runtime",
                region_name=region,
                aws_access_key_id=credentials["access_key"],
                aws_secret_access_key=credentials["secret_key"],
                config=boto_config,
            )
        else:
            # Use default credential chain (env vars, ~/.aws/credentials, IAM role, etc.)
            self.client = boto3.client(
                "bedrock-runtime",
                region_name=region,
                config=boto_config,
            )

    async def chat(self, messages: list[ChatMessage]) -> ChatResponse:
        """Send a chat completion request to Bedrock using Converse API."""
        import asyncio

        # Run sync boto3 call in executor
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._chat_sync, messages)

    def _chat_sync(self, messages: list[ChatMessage]) -> ChatResponse:
        """Synchronous chat implementation."""
        # Separate system message from conversation
        system_content: list[dict[str, Any]] = []
        conversation: list[dict[str, Any]] = []

        for msg in messages:
            if msg.role == "system":
                system_content.append({"text": msg.content})
            else:
                conversation.append({
                    "role": msg.role,
                    "content": [{"text": msg.content}],
                })

        # Ensure conversation is not empty
        if not conversation:
            conversation.append({
                "role": "user",
                "content": [{"text": ""}],
            })

        # Build inference config
        inference_config: dict[str, Any] = {
            "maxTokens": self.config.max_tokens,
            "temperature": self.config.temperature,
        }

        # Call Converse API
        try:
            kwargs: dict[str, Any] = {
                "modelId": self.config.model,
                "messages": conversation,
                "inferenceConfig": inference_config,
            }

            if system_content:
                kwargs["system"] = system_content

            response = self.client.converse(**kwargs)

            # Extract content from response
            content = ""
            output = response.get("output", {})
            message = output.get("message", {})
            for block in message.get("content", []):
                if "text" in block:
                    content += block["text"]

            # Calculate tokens
            usage = response.get("usage", {})
            input_tokens = usage.get("inputTokens", 0)
            output_tokens = usage.get("outputTokens", 0)

            return ChatResponse(
                content=content,
                model=self.config.model,
                provider=ProviderType.BEDROCK,
                tokens_used=input_tokens + output_tokens,
                finish_reason=response.get("stopReason"),
            )

        except self.client.exceptions.ValidationException as e:
            # Fall back to InvokeModel API for models that don't support Converse
            return self._invoke_model_fallback(messages, system_content)

    def _invoke_model_fallback(
        self,
        messages: list[ChatMessage],
        system_content: list[dict[str, Any]],
    ) -> ChatResponse:
        """Fallback to InvokeModel API for models that don't support Converse."""
        model_id = self.config.model

        # Build prompt based on model type
        if model_id.startswith("amazon.titan"):
            return self._invoke_titan(messages, system_content)
        elif model_id.startswith("meta.llama"):
            return self._invoke_llama(messages, system_content)
        else:
            # Default: try Titan format
            return self._invoke_titan(messages, system_content)

    def _invoke_titan(
        self,
        messages: list[ChatMessage],
        system_content: list[dict[str, Any]],
    ) -> ChatResponse:
        """Invoke Amazon Titan model."""
        # Build prompt
        prompt_parts = []
        if system_content:
            prompt_parts.append(system_content[0]["text"])

        for msg in messages:
            if msg.role == "user":
                prompt_parts.append(f"User: {msg.content}")
            elif msg.role == "assistant":
                prompt_parts.append(f"Bot: {msg.content}")

        prompt_parts.append("Bot:")
        prompt = "\n\n".join(prompt_parts)

        body = json.dumps({
            "inputText": prompt,
            "textGenerationConfig": {
                "maxTokenCount": self.config.max_tokens,
                "temperature": self.config.temperature,
            },
        })

        response = self.client.invoke_model(
            modelId=self.config.model,
            body=body,
            contentType="application/json",
            accept="application/json",
        )

        response_body = json.loads(response["body"].read())
        content = response_body.get("results", [{}])[0].get("outputText", "")

        return ChatResponse(
            content=content,
            model=self.config.model,
            provider=ProviderType.BEDROCK,
            tokens_used=None,
            finish_reason="stop",
        )

    def _invoke_llama(
        self,
        messages: list[ChatMessage],
        system_content: list[dict[str, Any]],
    ) -> ChatResponse:
        """Invoke Meta Llama model."""
        # Build prompt in Llama format
        prompt_parts = []
        if system_content:
            prompt_parts.append(f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n{system_content[0]['text']}<|eot_id|>")

        for msg in messages:
            if msg.role == "user":
                prompt_parts.append(f"<|start_header_id|>user<|end_header_id|>\n{msg.content}<|eot_id|>")
            elif msg.role == "assistant":
                prompt_parts.append(f"<|start_header_id|>assistant<|end_header_id|>\n{msg.content}<|eot_id|>")

        prompt_parts.append("<|start_header_id|>assistant<|end_header_id|>")
        prompt = "".join(prompt_parts)

        body = json.dumps({
            "prompt": prompt,
            "max_gen_len": self.config.max_tokens,
            "temperature": self.config.temperature,
        })

        response = self.client.invoke_model(
            modelId=self.config.model,
            body=body,
            contentType="application/json",
            accept="application/json",
        )

        response_body = json.loads(response["body"].read())
        content = response_body.get("generation", "")

        return ChatResponse(
            content=content,
            model=self.config.model,
            provider=ProviderType.BEDROCK,
            tokens_used=None,
            finish_reason="stop",
        )

    async def complete(self, prompt: str, system: str | None = None) -> ChatResponse:
        """Simple completion with optional system prompt."""
        messages: list[ChatMessage] = []

        if system:
            messages.append(ChatMessage(role="system", content=system))
        messages.append(ChatMessage(role="user", content=prompt))

        return await self.chat(messages)
