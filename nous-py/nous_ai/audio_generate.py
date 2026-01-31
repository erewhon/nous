"""Audio generation for Katt — TTS narration and podcast discussion from page content."""

import asyncio
import json
import os
import re
import time
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from nous_ai.models import ProviderConfig, ProviderType
from nous_ai.providers import get_provider

# ===== Optional dependency checks =====

ELEVENLABS_AVAILABLE = False
try:
    import elevenlabs  # noqa: F401

    ELEVENLABS_AVAILABLE = True
except ImportError:
    pass

KOKORO_AVAILABLE = False
try:
    import kokoro  # noqa: F401

    KOKORO_AVAILABLE = True
except ImportError:
    pass

PYDUB_AVAILABLE = False
try:
    from pydub import AudioSegment  # noqa: F401

    PYDUB_AVAILABLE = True
except ImportError:
    pass


# ===== Models =====


class TTSProviderType(str, Enum):
    """Supported TTS provider types."""

    OPENAI = "openai"
    ELEVENLABS = "elevenlabs"
    KOKORO = "kokoro"
    OPENAI_COMPATIBLE = "openai_compatible"


class TTSVoice(BaseModel):
    """A voice available from a TTS provider."""

    id: str
    name: str
    language: str | None = None
    preview_url: str | None = None


class TTSConfig(BaseModel):
    """Configuration for a TTS backend."""

    provider: TTSProviderType
    api_key: str | None = None
    base_url: str | None = None
    voice: str = "alloy"
    model: str | None = None
    speed: float = 1.0


class AudioResult(BaseModel):
    """Result from audio generation."""

    audio_path: str
    duration_seconds: float
    format: str = "mp3"
    file_size_bytes: int
    generation_time_seconds: float
    transcript: list[dict[str, str]] | None = None


# ===== TTS Backend Implementations =====


async def _synthesize_openai(text: str, config: TTSConfig) -> bytes:
    """Synthesize speech using the OpenAI TTS API."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=config.api_key or os.environ.get("OPENAI_API_KEY"))
    model = config.model or "tts-1"
    response = await client.audio.speech.create(
        model=model,
        voice=config.voice,  # type: ignore[arg-type]
        input=text,
        speed=config.speed,
        response_format="mp3",
    )
    return response.content


async def _synthesize_elevenlabs(text: str, config: TTSConfig) -> bytes:
    """Synthesize speech using the ElevenLabs API."""
    if not ELEVENLABS_AVAILABLE:
        raise ImportError(
            "elevenlabs package is not installed. Install with: pip install elevenlabs"
        )

    from elevenlabs import AsyncElevenLabs

    client = AsyncElevenLabs(
        api_key=config.api_key or os.environ.get("ELEVENLABS_API_KEY"),
    )
    model = config.model or "eleven_multilingual_v2"
    audio_generator = await client.text_to_speech.convert(
        voice_id=config.voice,
        text=text,
        model_id=model,
    )

    # Collect async generator into bytes
    chunks: list[bytes] = []
    async for chunk in audio_generator:
        chunks.append(chunk)
    return b"".join(chunks)


async def _synthesize_kokoro(text: str, config: TTSConfig) -> bytes:
    """Synthesize speech using the local Kokoro model."""
    if not KOKORO_AVAILABLE:
        raise ImportError("kokoro package is not installed. Install with: pip install kokoro")

    import io

    import soundfile as sf
    from kokoro import KPipeline

    voice = config.voice or "af_heart"
    lang_code = voice[0] if voice else "a"
    pipeline = KPipeline(lang_code=lang_code)

    # Generate audio samples
    samples_list = []
    for _gs, _ps, audio in pipeline(text, voice=voice, speed=config.speed):
        if audio is not None:
            samples_list.append(audio)

    if not samples_list:
        raise RuntimeError("Kokoro produced no audio output")

    import numpy as np

    all_samples = np.concatenate(samples_list)

    # Convert to WAV bytes first, then the caller can handle format
    buf = io.BytesIO()
    sf.write(buf, all_samples, 24000, format="WAV")
    wav_bytes = buf.getvalue()

    # Convert WAV to MP3 if pydub is available
    if PYDUB_AVAILABLE:
        from pydub import AudioSegment

        audio_seg = AudioSegment.from_wav(io.BytesIO(wav_bytes))
        mp3_buf = io.BytesIO()
        audio_seg.export(mp3_buf, format="mp3")
        return mp3_buf.getvalue()

    # Fall back to returning WAV
    return wav_bytes


async def _synthesize_openai_compatible(text: str, config: TTSConfig) -> bytes:
    """Synthesize speech using an OpenAI-compatible TTS endpoint."""
    import httpx

    if not config.base_url:
        raise ValueError("base_url is required for openai_compatible provider")

    url = config.base_url.rstrip("/") + "/v1/audio/speech"
    model = config.model or "tts-1"

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"

    payload = {
        "model": model,
        "voice": config.voice,
        "input": text,
        "speed": config.speed,
        "response_format": "mp3",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return response.content


_SYNTHESIZERS = {
    TTSProviderType.OPENAI: _synthesize_openai,
    TTSProviderType.ELEVENLABS: _synthesize_elevenlabs,
    TTSProviderType.KOKORO: _synthesize_kokoro,
    TTSProviderType.OPENAI_COMPATIBLE: _synthesize_openai_compatible,
}


async def synthesize(text: str, config: TTSConfig) -> bytes:
    """Route TTS synthesis to the appropriate backend."""
    fn = _SYNTHESIZERS.get(config.provider)
    if fn is None:
        raise ValueError(f"Unknown TTS provider: {config.provider}")
    return await fn(text, config)


# ===== Content Extraction =====


def extract_text_from_blocks(blocks: list[dict[str, Any]]) -> str:
    """Extract plain text from EditorData blocks for TTS input.

    Handles paragraph, header, list, quote, code, and checklist blocks.
    Skips image, video, embed, and other non-text blocks.
    """
    parts: list[str] = []

    for block in blocks:
        block_type = block.get("type", "")
        data = block.get("data", {})

        if block_type in ("paragraph", "header", "quote"):
            text = data.get("text", "")
            # Strip HTML tags
            text = re.sub(r"<[^>]+>", "", text)
            text = text.strip()
            if text:
                parts.append(text)

        elif block_type == "list":
            items = data.get("items", [])
            for item in items:
                if isinstance(item, str):
                    clean = re.sub(r"<[^>]+>", "", item).strip()
                    if clean:
                        parts.append(clean)
                elif isinstance(item, dict):
                    clean = re.sub(r"<[^>]+>", "", item.get("content", "")).strip()
                    if clean:
                        parts.append(clean)

        elif block_type == "checklist":
            items = data.get("items", [])
            for item in items:
                text = re.sub(r"<[^>]+>", "", item.get("text", "")).strip()
                if text:
                    parts.append(text)

        elif block_type == "code":
            code = data.get("code", "").strip()
            if code:
                parts.append(f"Code block: {code}")

    return "\n\n".join(parts)


# ===== Podcast Script Generation =====

PODCAST_SYSTEM_PROMPT = """You are a podcast script writer. Given source material, \
write a natural, engaging conversation between two hosts (Host A and Host B) who \
discuss the key ideas. Host A leads the discussion and introduces topics. Host B \
asks clarifying questions and adds insights. Keep it conversational and accessible.

Output valid JSON: an array of objects with "speaker" (either "A" or "B") and "text" fields.
Keep each line of dialogue to 1-3 sentences for natural pacing.
Aim for {target_lines} total exchanges."""

_LENGTH_TO_LINES = {
    "short": 12,
    "medium": 30,
    "long": 60,
}


async def generate_podcast_script(
    content: str,
    title: str,
    ai_config: dict[str, Any],
    target_length: str = "medium",
    custom_instructions: str | None = None,
) -> list[dict[str, str]]:
    """Generate a two-speaker podcast discussion script from page content.

    Uses the app's configured LLM provider via the existing get_provider/complete pattern.
    """
    target_lines = _LENGTH_TO_LINES.get(target_length, 30)
    system = PODCAST_SYSTEM_PROMPT.format(target_lines=target_lines)
    if custom_instructions:
        system += f"\n\nAdditional instructions: {custom_instructions}"

    provider_type = ai_config.get("provider_type", "openai")
    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=ai_config.get("api_key"),
        model=ai_config.get("model", ""),
        temperature=0.8,
        max_tokens=ai_config.get("max_tokens", 4096),
    )
    if ai_config.get("base_url"):
        config.base_url = ai_config["base_url"]

    provider = get_provider(config)

    user_prompt = f'Title: "{title}"\n\nContent:\n{content}'
    response = await provider.complete(user_prompt, system=system)

    # Parse the JSON response
    text = response.content.strip()
    # Try to extract JSON from markdown code blocks
    json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if json_match:
        text = json_match.group(1).strip()

    script: list[dict[str, str]] = json.loads(text)

    # Validate structure
    validated: list[dict[str, str]] = []
    for entry in script:
        if isinstance(entry, dict) and "speaker" in entry and "text" in entry:
            speaker = entry["speaker"].upper()
            if speaker in ("A", "B"):
                validated.append({"speaker": speaker, "text": entry["text"]})

    if not validated:
        raise ValueError("LLM did not produce a valid podcast script")

    return validated


# ===== Audio Concatenation =====


async def _generate_podcast_audio(
    script: list[dict[str, str]],
    config_a: TTSConfig,
    config_b: TTSConfig,
    output_path: str,
) -> float:
    """Generate audio for each script line and concatenate into a single MP3.

    Returns duration in seconds.
    """
    audio_chunks: list[bytes] = []

    for line in script:
        cfg = config_a if line["speaker"] == "A" else config_b
        chunk = await synthesize(line["text"], cfg)
        audio_chunks.append(chunk)

    if PYDUB_AVAILABLE:
        from pydub import AudioSegment

        silence = AudioSegment.silent(duration=400)  # 400ms pause between speakers
        combined = AudioSegment.empty()

        for i, chunk in enumerate(audio_chunks):
            import io

            try:
                segment = AudioSegment.from_mp3(io.BytesIO(chunk))
            except Exception:
                # Try WAV fallback (e.g. from Kokoro without ffmpeg mp3 support)
                segment = AudioSegment.from_wav(io.BytesIO(chunk))
            combined += segment
            if i < len(audio_chunks) - 1:
                combined += silence

        combined.export(output_path, format="mp3")
        duration = len(combined) / 1000.0
    else:
        # Raw byte concatenation fallback — works for MP3 but no silence gaps
        with open(output_path, "wb") as f:
            for chunk in audio_chunks:
                f.write(chunk)
        # Estimate duration from file size (~16kB/s for 128kbps MP3)
        file_size = os.path.getsize(output_path)
        duration = file_size / 16000.0

    return duration


# ===== Main Entry Points =====


async def generate_page_audio(
    content: str,
    title: str,
    output_dir: str,
    mode: str = "tts",
    tts_config: dict[str, Any] | None = None,
    ai_config: dict[str, Any] | None = None,
    voice_b: str | None = None,
    target_length: str = "medium",
    custom_instructions: str | None = None,
) -> dict[str, Any]:
    """Generate audio from page content.

    Args:
        content: Plain text content of the page.
        title: Page title.
        output_dir: Directory to write audio files to.
        mode: "tts" for single-voice narration, "podcast" for two-speaker discussion.
        tts_config: TTSConfig fields as a dict.
        ai_config: LLM config for podcast script generation (provider_type, api_key, model).
        voice_b: Second voice ID for podcast mode.
        target_length: Podcast length — "short", "medium", or "long".
        custom_instructions: Custom instructions for podcast script generation.

    Returns:
        AudioResult as a dict.
    """
    start_time = time.time()

    tts_config = tts_config or {}
    config_a = TTSConfig(
        provider=TTSProviderType(tts_config.get("provider", "openai")),
        api_key=tts_config.get("api_key"),
        base_url=tts_config.get("base_url"),
        voice=tts_config.get("voice", "alloy"),
        model=tts_config.get("model"),
        speed=tts_config.get("speed", 1.0),
    )

    # Ensure output directory exists
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    timestamp = int(time.time())
    filename = f"audio_{timestamp}.mp3"
    output_path = os.path.join(output_dir, filename)

    transcript: list[dict[str, str]] | None = None

    if mode == "podcast":
        if not ai_config:
            raise ValueError("ai_config is required for podcast mode")

        # Generate the discussion script
        script = await generate_podcast_script(
            content=content,
            title=title,
            ai_config=ai_config,
            target_length=target_length,
            custom_instructions=custom_instructions,
        )
        transcript = script

        # Build config for voice B
        config_b = config_a.model_copy()
        config_b.voice = voice_b or _default_voice_b(config_a.provider)

        duration = await _generate_podcast_audio(script, config_a, config_b, output_path)
    else:
        # Simple TTS mode
        audio_bytes = await synthesize(content, config_a)
        with open(output_path, "wb") as f:
            f.write(audio_bytes)

        # Try to get duration
        duration = _estimate_duration(output_path)

    generation_time = time.time() - start_time
    file_size = os.path.getsize(output_path)

    result = AudioResult(
        audio_path=output_path,
        duration_seconds=duration,
        format="mp3",
        file_size_bytes=file_size,
        generation_time_seconds=round(generation_time, 2),
        transcript=transcript,
    )
    return result.model_dump()


def _default_voice_b(provider: TTSProviderType) -> str:
    """Return a sensible default second voice for each provider."""
    defaults = {
        TTSProviderType.OPENAI: "nova",
        TTSProviderType.ELEVENLABS: "Rachel",
        TTSProviderType.KOKORO: "bf_emma",
        TTSProviderType.OPENAI_COMPATIBLE: "nova",
    }
    return defaults.get(provider, "nova")


def _estimate_duration(path: str) -> float:
    """Try to get audio duration; fall back to file-size estimate."""
    if PYDUB_AVAILABLE:
        try:
            from pydub import AudioSegment

            seg = AudioSegment.from_file(path)
            return len(seg) / 1000.0
        except Exception:
            pass
    # Rough estimate: 128kbps MP3 ≈ 16kB/s
    return os.path.getsize(path) / 16000.0


def generate_page_audio_sync(
    content: str,
    title: str,
    output_dir: str,
    mode: str = "tts",
    tts_config: dict[str, Any] | None = None,
    ai_config: dict[str, Any] | None = None,
    voice_b: str | None = None,
    target_length: str = "medium",
    custom_instructions: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for generate_page_audio."""
    return asyncio.run(
        generate_page_audio(
            content=content,
            title=title,
            output_dir=output_dir,
            mode=mode,
            tts_config=tts_config,
            ai_config=ai_config,
            voice_b=voice_b,
            target_length=target_length,
            custom_instructions=custom_instructions,
        )
    )


# ===== Voice Listing =====


async def list_tts_voices(
    provider: str,
    api_key: str | None = None,
    base_url: str | None = None,
) -> list[dict[str, Any]]:
    """Return available voices for the given TTS provider."""
    ptype = TTSProviderType(provider)

    if ptype == TTSProviderType.OPENAI:
        # OpenAI has fixed voices
        voices = [
            TTSVoice(id="alloy", name="Alloy"),
            TTSVoice(id="ash", name="Ash"),
            TTSVoice(id="ballad", name="Ballad"),
            TTSVoice(id="coral", name="Coral"),
            TTSVoice(id="echo", name="Echo"),
            TTSVoice(id="fable", name="Fable"),
            TTSVoice(id="nova", name="Nova"),
            TTSVoice(id="onyx", name="Onyx"),
            TTSVoice(id="sage", name="Sage"),
            TTSVoice(id="shimmer", name="Shimmer"),
        ]
        return [v.model_dump() for v in voices]

    elif ptype == TTSProviderType.ELEVENLABS:
        if not ELEVENLABS_AVAILABLE:
            return []
        from elevenlabs import AsyncElevenLabs

        client = AsyncElevenLabs(api_key=api_key or os.environ.get("ELEVENLABS_API_KEY"))
        response = await client.voices.get_all()
        voices = []
        for v in response.voices:
            voices.append(
                TTSVoice(
                    id=v.voice_id,
                    name=v.name or v.voice_id,
                    preview_url=v.preview_url,
                ).model_dump()
            )
        return voices

    elif ptype == TTSProviderType.KOKORO:
        if not KOKORO_AVAILABLE:
            return []
        # Kokoro has preset voice IDs
        kokoro_voices = [
            TTSVoice(id="af_heart", name="Heart (American Female)", language="en"),
            TTSVoice(id="af_alloy", name="Alloy (American Female)", language="en"),
            TTSVoice(id="af_aoede", name="Aoede (American Female)", language="en"),
            TTSVoice(id="af_bella", name="Bella (American Female)", language="en"),
            TTSVoice(id="af_jessica", name="Jessica (American Female)", language="en"),
            TTSVoice(id="af_nicole", name="Nicole (American Female)", language="en"),
            TTSVoice(id="af_nova", name="Nova (American Female)", language="en"),
            TTSVoice(id="af_river", name="River (American Female)", language="en"),
            TTSVoice(id="af_sarah", name="Sarah (American Female)", language="en"),
            TTSVoice(id="af_sky", name="Sky (American Female)", language="en"),
            TTSVoice(id="am_adam", name="Adam (American Male)", language="en"),
            TTSVoice(id="am_echo", name="Echo (American Male)", language="en"),
            TTSVoice(id="am_eric", name="Eric (American Male)", language="en"),
            TTSVoice(id="am_liam", name="Liam (American Male)", language="en"),
            TTSVoice(id="am_michael", name="Michael (American Male)", language="en"),
            TTSVoice(id="am_onyx", name="Onyx (American Male)", language="en"),
            TTSVoice(id="bf_emma", name="Emma (British Female)", language="en"),
            TTSVoice(id="bf_isabella", name="Isabella (British Female)", language="en"),
            TTSVoice(id="bm_daniel", name="Daniel (British Male)", language="en"),
            TTSVoice(id="bm_fable", name="Fable (British Male)", language="en"),
            TTSVoice(id="bm_george", name="George (British Male)", language="en"),
            TTSVoice(id="bm_lewis", name="Lewis (British Male)", language="en"),
        ]
        return [v.model_dump() for v in kokoro_voices]

    elif ptype == TTSProviderType.OPENAI_COMPATIBLE:
        # We don't know what voices a generic endpoint supports;
        # return the standard OpenAI set as a starting point.
        voices = [
            TTSVoice(id="alloy", name="Alloy"),
            TTSVoice(id="echo", name="Echo"),
            TTSVoice(id="fable", name="Fable"),
            TTSVoice(id="nova", name="Nova"),
            TTSVoice(id="onyx", name="Onyx"),
            TTSVoice(id="shimmer", name="Shimmer"),
        ]
        return [v.model_dump() for v in voices]

    return []


def list_tts_voices_sync(
    provider: str,
    api_key: str | None = None,
    base_url: str | None = None,
) -> list[dict[str, Any]]:
    """Synchronous wrapper for list_tts_voices."""
    return asyncio.run(list_tts_voices(provider, api_key, base_url))


# ===== Provider Discovery =====


def get_tts_providers_sync() -> list[dict[str, Any]]:
    """Return list of available TTS providers with availability status."""
    providers = [
        {
            "id": "openai",
            "name": "OpenAI TTS",
            "available": True,  # openai is a core dependency
        },
        {
            "id": "elevenlabs",
            "name": "ElevenLabs",
            "available": ELEVENLABS_AVAILABLE,
        },
        {
            "id": "kokoro",
            "name": "Kokoro (Local)",
            "available": KOKORO_AVAILABLE,
        },
        {
            "id": "openai_compatible",
            "name": "OpenAI-Compatible Endpoint",
            "available": True,  # Uses httpx, always available
        },
    ]
    return providers
