"""Video transcription using faster-whisper.

Note: faster-whisper is an optional dependency. Install with:
    uv pip install faster-whisper

System requirement: ffmpeg must be installed for audio extraction.
"""

import asyncio
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

# Check if faster-whisper is available
FASTER_WHISPER_AVAILABLE = False
try:
    from faster_whisper import WhisperModel

    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    pass


# Supported video formats
SUPPORTED_VIDEO_EXTENSIONS: dict[str, str] = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".m4v": "video/x-m4v",
    ".flv": "video/x-flv",
}


class TranscriptWord(BaseModel):
    """A single word with timing information."""

    word: str
    start: float  # seconds
    end: float  # seconds
    probability: float


class TranscriptSegment(BaseModel):
    """A segment of transcription with word-level timestamps."""

    id: int
    start: float  # seconds
    end: float  # seconds
    text: str
    words: list[TranscriptWord] = Field(default_factory=list)


class TranscriptionResult(BaseModel):
    """Result of video transcription."""

    video_path: str
    audio_path: str | None = None
    language: str
    language_probability: float
    duration: float  # Total video duration in seconds
    segments: list[TranscriptSegment]
    word_count: int
    transcription_time: float  # Time taken to transcribe


def is_ffmpeg_available() -> bool:
    """Check if ffmpeg is installed and available."""
    return shutil.which("ffmpeg") is not None


def is_ffprobe_available() -> bool:
    """Check if ffprobe is installed and available."""
    return shutil.which("ffprobe") is not None


def get_video_duration(video_path: str) -> float:
    """Get video duration in seconds using ffprobe.

    Args:
        video_path: Path to the video file.

    Returns:
        Duration in seconds.

    Raises:
        FileNotFoundError: If video file doesn't exist.
        RuntimeError: If ffprobe is not available or fails.
    """
    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    if not is_ffprobe_available():
        raise RuntimeError("ffprobe is not installed. Please install ffmpeg.")

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(result.stdout.strip())
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffprobe failed: {e.stderr}") from e
    except ValueError as e:
        raise RuntimeError(f"Could not parse duration: {e}") from e


def is_supported_video(file_path: str) -> bool:
    """Check if file is a supported video format.

    Args:
        file_path: Path to check.

    Returns:
        True if the file extension is supported.
    """
    ext = Path(file_path).suffix.lower()
    return ext in SUPPORTED_VIDEO_EXTENSIONS


def get_supported_extensions() -> list[str]:
    """Get list of supported video extensions."""
    return list(SUPPORTED_VIDEO_EXTENSIONS.keys())


async def extract_audio(video_path: str, output_path: str | None = None) -> str:
    """Extract audio from video using ffmpeg.

    Args:
        video_path: Path to the video file.
        output_path: Optional path for the output audio file.
                    If not provided, creates a temp file.

    Returns:
        Path to the extracted audio file (WAV, 16kHz, mono).

    Raises:
        FileNotFoundError: If video file doesn't exist.
        RuntimeError: If ffmpeg is not available or fails.
    """
    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    if not is_ffmpeg_available():
        raise RuntimeError("ffmpeg is not installed. Please install ffmpeg.")

    # Generate output path if not provided
    if output_path is None:
        # Create temp file with .wav extension
        temp_dir = tempfile.gettempdir()
        output_path = str(Path(temp_dir) / f"{path.stem}_audio.wav")

    # Extract audio: 16kHz mono WAV (optimal for Whisper)
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-i",
        str(path),
        "-vn",  # No video
        "-acodec",
        "pcm_s16le",  # 16-bit PCM
        "-ar",
        "16000",  # 16kHz sample rate
        "-ac",
        "1",  # Mono
        "-y",  # Overwrite output
        output_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    _, stderr = await process.communicate()

    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {stderr.decode()}")

    return output_path


async def transcribe_video(
    video_path: str,
    model_size: str = "base",
    language: str | None = None,
    compute_type: str = "int8",
    device: str = "auto",
) -> dict[str, Any]:
    """Transcribe a video file using faster-whisper.

    Args:
        video_path: Path to the video file.
        model_size: Whisper model size (tiny, base, small, medium, large-v3).
        language: Language code (e.g., "en"). Auto-detected if None.
        compute_type: Compute type (int8, float16, float32).
        device: Device to use (auto, cpu, cuda).

    Returns:
        TranscriptionResult as a dictionary.

    Raises:
        ImportError: If faster-whisper is not installed.
        FileNotFoundError: If video file doesn't exist.
        RuntimeError: If transcription fails.
    """
    if not FASTER_WHISPER_AVAILABLE:
        raise ImportError(
            "faster-whisper is not installed. Install with: uv pip install faster-whisper"
        )

    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    if not is_supported_video(video_path):
        raise ValueError(f"Unsupported video format: {path.suffix}")

    start_time = time.time()

    # Get video duration
    duration = get_video_duration(video_path)

    # Extract audio
    audio_path = await extract_audio(video_path)

    try:
        # Load model
        model = WhisperModel(model_size, device=device, compute_type=compute_type)

        # Transcribe with word timestamps
        segments_generator, info = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            vad_filter=True,  # Filter out non-speech
        )

        # Process segments
        segments: list[TranscriptSegment] = []
        total_words = 0

        for idx, segment in enumerate(segments_generator):
            words: list[TranscriptWord] = []

            if segment.words:
                for word in segment.words:
                    words.append(
                        TranscriptWord(
                            word=word.word.strip(),
                            start=word.start,
                            end=word.end,
                            probability=word.probability,
                        )
                    )
                    total_words += 1

            segments.append(
                TranscriptSegment(
                    id=idx,
                    start=segment.start,
                    end=segment.end,
                    text=segment.text.strip(),
                    words=words,
                )
            )

        transcription_time = time.time() - start_time

        result = TranscriptionResult(
            video_path=video_path,
            audio_path=audio_path,
            language=info.language,
            language_probability=info.language_probability,
            duration=duration,
            segments=segments,
            word_count=total_words,
            transcription_time=transcription_time,
        )

        return result.model_dump()

    except Exception as e:
        raise RuntimeError(f"Transcription failed: {e}") from e


def transcribe_video_sync(
    video_path: str,
    model_size: str = "base",
    language: str | None = None,
    compute_type: str = "int8",
    device: str = "auto",
) -> dict[str, Any]:
    """Synchronous wrapper for transcribe_video (for PyO3 bridge).

    Args:
        video_path: Path to the video file.
        model_size: Whisper model size (tiny, base, small, medium, large-v3).
        language: Language code (e.g., "en"). Auto-detected if None.
        compute_type: Compute type (int8, float16, float32).
        device: Device to use (auto, cpu, cuda).

    Returns:
        TranscriptionResult as a dictionary.
    """
    return asyncio.run(
        transcribe_video(
            video_path=video_path,
            model_size=model_size,
            language=language,
            compute_type=compute_type,
            device=device,
        )
    )


def get_video_duration_sync(video_path: str) -> float:
    """Synchronous wrapper for get_video_duration (for PyO3 bridge)."""
    return get_video_duration(video_path)


def is_supported_video_sync(file_path: str) -> bool:
    """Synchronous wrapper for is_supported_video (for PyO3 bridge)."""
    return is_supported_video(file_path)


def get_supported_extensions_sync() -> list[str]:
    """Synchronous wrapper for get_supported_extensions (for PyO3 bridge)."""
    return get_supported_extensions()


async def extract_thumbnail(
    video_path: str,
    output_path: str | None = None,
    timestamp_seconds: float = 1.0,
    width: int = 480,
) -> str:
    """Extract a single frame as JPEG thumbnail from a video.

    Args:
        video_path: Path to the video file.
        output_path: Optional path for the output thumbnail.
                    If not provided, creates file alongside video as {video}.thumb.jpg.
        timestamp_seconds: Time in video to extract frame from (default 1.0s).
        width: Width of thumbnail in pixels (height auto-scales to maintain aspect ratio).

    Returns:
        Path to the extracted thumbnail file.

    Raises:
        FileNotFoundError: If video file doesn't exist.
        RuntimeError: If ffmpeg is not available or fails.
    """
    path = Path(video_path)
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    if not is_ffmpeg_available():
        raise RuntimeError("ffmpeg is not installed. Please install ffmpeg.")

    # Generate output path if not provided
    if output_path is None:
        output_path = str(path.parent / f"{path.name}.thumb.jpg")

    # Get video duration to ensure timestamp is valid
    try:
        duration = get_video_duration(video_path)
        # If requested timestamp is beyond video duration, use 10% of duration or 0
        if timestamp_seconds >= duration:
            timestamp_seconds = min(1.0, duration * 0.1)
    except RuntimeError:
        # If we can't get duration, just try with the requested timestamp
        pass

    # Extract single frame using ffmpeg
    # -ss before -i for fast seeking
    # -vframes 1 to extract only one frame
    # -vf scale to resize maintaining aspect ratio
    # -q:v 2 for high quality JPEG (lower is better, range 2-31)
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-ss",
        str(timestamp_seconds),
        "-i",
        str(path),
        "-vframes",
        "1",
        "-vf",
        f"scale={width}:-1",
        "-q:v",
        "2",
        "-y",  # Overwrite output
        output_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    _, stderr = await process.communicate()

    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg thumbnail extraction failed: {stderr.decode()}")

    # Verify output file was created
    if not Path(output_path).exists():
        raise RuntimeError("Thumbnail file was not created")

    return output_path


def extract_thumbnail_sync(
    video_path: str,
    output_path: str | None = None,
    timestamp_seconds: float = 1.0,
    width: int = 480,
) -> str:
    """Synchronous wrapper for extract_thumbnail (for PyO3 bridge)."""
    return asyncio.run(
        extract_thumbnail(
            video_path=video_path,
            output_path=output_path,
            timestamp_seconds=timestamp_seconds,
            width=width,
        )
    )
