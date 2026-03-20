"""AI configuration loader for Nous scripts.

Reads AI provider settings from:
1. Environment variables (NOUS_AI_BASE_URL, NOUS_AI_API_KEY, NOUS_AI_MODEL)
2. Config file (~/.config/nous/ai.json)
3. Fallback defaults
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def load_ai_config() -> dict[str, Any]:
    """Load AI configuration from env vars or config file.

    Returns dict with: base_url, api_key, model
    """
    # 1. Environment variables take priority
    env_config = {}
    if os.environ.get("NOUS_AI_BASE_URL"):
        env_config["base_url"] = os.environ["NOUS_AI_BASE_URL"]
    if os.environ.get("NOUS_AI_API_KEY"):
        env_config["api_key"] = os.environ["NOUS_AI_API_KEY"]
    if os.environ.get("NOUS_AI_MODEL"):
        env_config["model"] = os.environ["NOUS_AI_MODEL"]

    if len(env_config) >= 2:  # At least base_url + model or api_key + model
        return {
            "base_url": env_config.get("base_url"),
            "api_key": env_config.get("api_key", "not-needed"),
            "model": env_config.get("model", "gpt-4o-mini"),
        }

    # 2. Config file
    config_paths = [
        Path.home() / ".config" / "nous" / "ai.json",
        Path.home() / ".local" / "share" / "nous" / "ai.json",
    ]
    for path in config_paths:
        if path.exists():
            try:
                data = json.loads(path.read_text())
                return {
                    "base_url": data.get("base_url") or data.get("baseUrl"),
                    "api_key": data.get("api_key") or data.get("apiKey", "not-needed"),
                    "model": data.get("model", "gpt-4o-mini"),
                }
            except (json.JSONDecodeError, OSError):
                continue

    return {}


def save_ai_config(config: dict[str, Any]) -> Path:
    """Save AI configuration to the config file."""
    config_dir = Path.home() / ".config" / "nous"
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_dir / "ai.json"
    path.write_text(json.dumps(config, indent=2))
    return path


def has_ai_config() -> bool:
    """Check if AI configuration is available."""
    config = load_ai_config()
    return bool(config.get("base_url") or config.get("api_key"))
