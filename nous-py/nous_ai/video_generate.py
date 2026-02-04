"""Video generation for Katt — narrated presentations from study content."""

import asyncio
import io
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from nous_ai.audio_generate import TTSConfig, TTSProviderType, synthesize

# ===== Optional dependency checks =====

PILLOW_AVAILABLE = False
try:
    from PIL import Image, ImageDraw, ImageFont

    PILLOW_AVAILABLE = True
except ImportError:
    pass

FFMPEG_AVAILABLE = False
try:
    result = subprocess.run(
        ["ffmpeg", "-version"],
        capture_output=True,
        timeout=5,
    )
    FFMPEG_AVAILABLE = result.returncode == 0
except Exception:
    pass

PYDUB_AVAILABLE = False
try:
    from pydub import AudioSegment

    PYDUB_AVAILABLE = True
except ImportError:
    pass


# ===== Models =====


class SlideContent(BaseModel):
    """Content for a single slide."""

    title: str
    body: str = ""
    bullet_points: list[str] = Field(default_factory=list)
    duration_hint: float | None = None  # Suggested duration in seconds


class VideoConfig(BaseModel):
    """Configuration for video generation."""

    width: int = 1920
    height: int = 1080
    fps: int = 30
    theme: str = "light"  # light, dark
    transition: str = "cut"  # cut, fade
    title: str | None = None


class VideoResult(BaseModel):
    """Result from video generation."""

    video_path: str
    duration_seconds: float
    slide_count: int
    generation_time_seconds: float


# ===== Theme Colors =====


def get_theme_colors(theme: str) -> dict[str, tuple[int, int, int]]:
    """Get color palette for a theme (RGB tuples)."""
    if theme == "dark":
        return {
            "background": (26, 26, 46),
            "text": (234, 234, 234),
            "text_secondary": (176, 176, 176),
            "primary": (15, 76, 117),
            "secondary": (50, 130, 184),
            "accent": (187, 225, 250),
        }
    else:  # light
        return {
            "background": (255, 255, 255),
            "text": (44, 62, 80),
            "text_secondary": (127, 140, 141),
            "primary": (52, 152, 219),
            "secondary": (41, 128, 185),
            "accent": (231, 76, 60),
        }


# ===== Text Utilities =====


def wrap_text_pil(text: str, font: Any, max_width: int) -> list[str]:
    """Wrap text to fit within max_width pixels using the given font."""
    words = text.split()
    lines: list[str] = []
    current_line: list[str] = []

    for word in words:
        test_line = " ".join(current_line + [word])
        # Use getbbox for modern PIL, fallback to getsize for older versions
        try:
            bbox = font.getbbox(test_line)
            text_width = bbox[2] - bbox[0]
        except AttributeError:
            text_width = font.getsize(test_line)[0]

        if text_width <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(" ".join(current_line))
            current_line = [word]

    if current_line:
        lines.append(" ".join(current_line))

    return lines if lines else [""]


def get_font(size: int, bold: bool = False) -> Any:
    """Get a font, falling back to default if custom fonts aren't available."""
    if not PILLOW_AVAILABLE:
        raise ImportError("Pillow is not installed. Install with: pip install pillow")

    # Try common system fonts
    font_names = [
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        "Arial Bold.ttf" if bold else "Arial.ttf",
        "Helvetica-Bold.ttf" if bold else "Helvetica.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]

    for font_name in font_names:
        try:
            return ImageFont.truetype(font_name, size)
        except (OSError, IOError):
            continue

    # Fall back to default font
    return ImageFont.load_default()


# ===== Slide Rendering =====


def render_slide(
    slide: SlideContent,
    config: VideoConfig,
    slide_number: int,
    total_slides: int,
) -> Image.Image:
    """Render a slide to a PIL Image.

    Args:
        slide: Slide content
        config: Video configuration
        slide_number: Current slide number (1-indexed)
        total_slides: Total number of slides

    Returns:
        PIL Image of the rendered slide
    """
    if not PILLOW_AVAILABLE:
        raise ImportError("Pillow is not installed. Install with: pip install pillow")

    colors = get_theme_colors(config.theme)

    # Create image
    img = Image.new("RGB", (config.width, config.height), colors["background"])
    draw = ImageDraw.Draw(img)

    # Fonts
    title_font = get_font(64, bold=True)
    body_font = get_font(36)
    bullet_font = get_font(32)
    footer_font = get_font(24)

    # Margins
    margin_x = 100
    margin_y = 80
    content_width = config.width - 2 * margin_x

    # Draw title
    y_pos = margin_y
    title_lines = wrap_text_pil(slide.title, title_font, content_width)
    for line in title_lines[:3]:  # Max 3 lines for title
        draw.text((margin_x, y_pos), line, font=title_font, fill=colors["text"])
        y_pos += 80

    # Title underline
    y_pos += 20
    draw.line(
        [(margin_x, y_pos), (config.width - margin_x, y_pos)],
        fill=colors["primary"],
        width=4,
    )
    y_pos += 40

    # Draw body text
    if slide.body:
        body_lines = wrap_text_pil(slide.body, body_font, content_width)
        for line in body_lines[:8]:  # Max 8 lines
            draw.text((margin_x, y_pos), line, font=body_font, fill=colors["text"])
            y_pos += 50
        y_pos += 20

    # Draw bullet points
    bullet_y = y_pos
    for i, bullet in enumerate(slide.bullet_points[:8]):  # Max 8 bullets
        # Bullet character
        bullet_x = margin_x + 20
        draw.ellipse(
            [(bullet_x, bullet_y + 10), (bullet_x + 12, bullet_y + 22)],
            fill=colors["secondary"],
        )

        # Bullet text
        text_x = bullet_x + 30
        bullet_lines = wrap_text_pil(bullet, bullet_font, content_width - 50)
        for line in bullet_lines[:2]:  # Max 2 lines per bullet
            draw.text((text_x, bullet_y), line, font=bullet_font, fill=colors["text"])
            bullet_y += 42
        bullet_y += 10

    # Footer with slide number
    footer_text = f"{slide_number} / {total_slides}"
    try:
        bbox = footer_font.getbbox(footer_text)
        footer_width = bbox[2] - bbox[0]
    except AttributeError:
        footer_width = footer_font.getsize(footer_text)[0]

    draw.text(
        (config.width - margin_x - footer_width, config.height - 60),
        footer_text,
        font=footer_font,
        fill=colors["text_secondary"],
    )

    return img


def render_title_slide(
    title: str,
    config: VideoConfig,
    total_slides: int,
) -> Image.Image:
    """Render a title slide.

    Args:
        title: Video/presentation title
        config: Video configuration
        total_slides: Total number of slides

    Returns:
        PIL Image of the title slide
    """
    if not PILLOW_AVAILABLE:
        raise ImportError("Pillow is not installed. Install with: pip install pillow")

    colors = get_theme_colors(config.theme)

    img = Image.new("RGB", (config.width, config.height), colors["background"])
    draw = ImageDraw.Draw(img)

    title_font = get_font(80, bold=True)
    subtitle_font = get_font(36)

    # Center the title
    title_lines = wrap_text_pil(title, title_font, config.width - 200)
    total_height = len(title_lines) * 100

    y_start = (config.height - total_height) // 2 - 50

    for line in title_lines[:3]:
        try:
            bbox = title_font.getbbox(line)
            text_width = bbox[2] - bbox[0]
        except AttributeError:
            text_width = title_font.getsize(line)[0]

        x = (config.width - text_width) // 2
        draw.text((x, y_start), line, font=title_font, fill=colors["text"])
        y_start += 100

    # Subtitle with slide count
    subtitle = f"{total_slides} slides"
    try:
        bbox = subtitle_font.getbbox(subtitle)
        subtitle_width = bbox[2] - bbox[0]
    except AttributeError:
        subtitle_width = subtitle_font.getsize(subtitle)[0]

    draw.text(
        ((config.width - subtitle_width) // 2, y_start + 40),
        subtitle,
        font=subtitle_font,
        fill=colors["text_secondary"],
    )

    return img


# ===== Audio Generation =====


async def generate_slide_audio(
    slide: SlideContent,
    tts_config: TTSConfig,
    output_path: str,
) -> float:
    """Generate audio narration for a slide.

    Returns duration in seconds.
    """
    # Build narration text
    narration_parts = [slide.title]

    if slide.body:
        narration_parts.append(slide.body)

    for bullet in slide.bullet_points:
        narration_parts.append(bullet)

    narration = ". ".join(narration_parts)

    # Generate audio
    audio_bytes = await synthesize(narration, tts_config)

    with open(output_path, "wb") as f:
        f.write(audio_bytes)

    # Get duration
    duration = _get_audio_duration(output_path)
    return duration


def _get_audio_duration(path: str) -> float:
    """Get audio duration in seconds."""
    if PYDUB_AVAILABLE:
        try:
            audio = AudioSegment.from_file(path)
            return len(audio) / 1000.0
        except Exception:
            pass

    # Fallback: estimate from file size (~16kB/s for 128kbps MP3)
    return os.path.getsize(path) / 16000.0


# ===== FFmpeg Video Assembly =====


def assemble_video_ffmpeg(
    slide_images: list[str],
    audio_files: list[str],
    durations: list[float],
    output_path: str,
    config: VideoConfig,
) -> float:
    """Assemble slides and audio into a video using FFmpeg.

    Args:
        slide_images: List of paths to slide PNG images
        audio_files: List of paths to audio MP3 files
        durations: Duration for each slide in seconds
        output_path: Output video path
        config: Video configuration

    Returns:
        Total video duration in seconds
    """
    if not FFMPEG_AVAILABLE:
        raise RuntimeError(
            "FFmpeg is not available. Please install FFmpeg to generate videos."
        )

    # Concatenate audio files first
    combined_audio = None

    if audio_files and PYDUB_AVAILABLE:
        combined = AudioSegment.empty()
        for audio_path in audio_files:
            try:
                segment = AudioSegment.from_file(audio_path)
                combined += segment
            except Exception:
                # If audio loading fails, add silence
                silence = AudioSegment.silent(duration=int(durations[0] * 1000))
                combined += silence

        combined_audio = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False).name
        combined.export(combined_audio, format="mp3")

    concat_file = None

    try:
        if config.transition == "fade" and len(slide_images) > 1:
            # Use xfade filter for fade transitions
            return _assemble_with_fade(
                slide_images, durations, output_path, config, combined_audio
            )
        else:
            # Use concat demuxer for cut transitions (faster)
            return _assemble_with_cut(
                slide_images, durations, output_path, config, combined_audio
            )
    finally:
        # Clean up temp files
        if combined_audio:
            try:
                os.unlink(combined_audio)
            except Exception:
                pass


def _assemble_with_cut(
    slide_images: list[str],
    durations: list[float],
    output_path: str,
    config: VideoConfig,
    combined_audio: str | None,
) -> float:
    """Assemble video using concat demuxer (cut transitions)."""
    # Create a concat file for FFmpeg
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        concat_file = f.name
        for img, duration in zip(slide_images, durations):
            f.write(f"file '{img}'\n")
            f.write(f"duration {duration}\n")
        # Add last image again for FFmpeg concat demuxer
        if slide_images:
            f.write(f"file '{slide_images[-1]}'\n")

    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_file,
        ]

        if combined_audio:
            cmd.extend(["-i", combined_audio])
            cmd.extend([
                "-c:v", "libx264",
                "-c:a", "aac",
                "-pix_fmt", "yuv420p",
                "-shortest",
            ])
        else:
            cmd.extend([
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
            ])

        cmd.extend([
            "-r", str(config.fps),
            output_path,
        ])

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=300,
        )

        if result.returncode != 0:
            error_msg = result.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(f"FFmpeg failed: {error_msg[:500]}")

        return sum(durations)

    finally:
        try:
            os.unlink(concat_file)
        except Exception:
            pass


def _assemble_with_fade(
    slide_images: list[str],
    durations: list[float],
    output_path: str,
    config: VideoConfig,
    combined_audio: str | None,
) -> float:
    """Assemble video using xfade filter for fade transitions."""
    fade_duration = 0.5  # Half second fade

    # Build filter_complex for xfade transitions
    # Each image needs to be looped and trimmed to its duration
    inputs = []
    filter_parts = []

    for i, (img, duration) in enumerate(zip(slide_images, durations)):
        inputs.extend(["-loop", "1", "-t", str(duration), "-i", img])
        # Scale and set pixel format for each input
        filter_parts.append(
            f"[{i}:v]scale={config.width}:{config.height}:force_original_aspect_ratio=decrease,"
            f"pad={config.width}:{config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={config.fps}[v{i}]"
        )

    # Chain xfade filters
    if len(slide_images) == 1:
        # Single slide, no transition needed
        filter_complex = filter_parts[0].replace(f"[v0]", "[vout]")
    else:
        # Build xfade chain
        # First transition: [v0][v1]xfade=...[xf0]
        # Second transition: [xf0][v2]xfade=...[xf1]
        # etc.
        offset = durations[0] - fade_duration
        xfade_parts = []

        for i in range(len(slide_images) - 1):
            if i == 0:
                in1 = f"[v0]"
                in2 = f"[v1]"
            else:
                in1 = f"[xf{i-1}]"
                in2 = f"[v{i+1}]"

            if i == len(slide_images) - 2:
                out = "[vout]"
            else:
                out = f"[xf{i}]"

            xfade_parts.append(
                f"{in1}{in2}xfade=transition=fade:duration={fade_duration}:offset={offset}{out}"
            )

            # Update offset for next transition
            if i + 1 < len(durations) - 1:
                offset += durations[i + 1] - fade_duration

        filter_complex = ";".join(filter_parts + xfade_parts)

    # Build full command
    cmd = ["ffmpeg", "-y"]
    cmd.extend(inputs)

    if combined_audio:
        cmd.extend(["-i", combined_audio])

    cmd.extend(["-filter_complex", filter_complex])
    cmd.extend(["-map", "[vout]"])

    if combined_audio:
        cmd.extend(["-map", f"{len(slide_images)}:a"])
        cmd.extend(["-c:a", "aac", "-shortest"])

    cmd.extend([
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        output_path,
    ])

    result = subprocess.run(
        cmd,
        capture_output=True,
        timeout=600,  # Longer timeout for complex filter
    )

    if result.returncode != 0:
        error_msg = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"FFmpeg failed: {error_msg[:500]}")

    # Calculate total duration accounting for fade overlaps
    total_duration = sum(durations) - (fade_duration * (len(slide_images) - 1))
    return max(total_duration, 0)


# ===== Main Entry Points =====


async def generate_video(
    slides: list[dict[str, Any]],
    output_dir: str,
    tts_config: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    progress_callback: Any | None = None,
) -> dict[str, Any]:
    """Generate a narrated video from slides.

    Args:
        slides: List of slide dicts with title, body, bullet_points
        output_dir: Directory to save output video
        tts_config: TTS configuration dict
        config: Video configuration dict
        progress_callback: Optional callback function(current_slide, total_slides, status)

    Returns:
        VideoResult as a dict
    """
    def report_progress(current: int, total: int, status: str) -> None:
        """Report progress if callback is available."""
        if progress_callback:
            try:
                progress_callback(current, total, status)
            except Exception:
                pass  # Ignore callback errors
    start_time = time.time()

    if not PILLOW_AVAILABLE:
        raise ImportError("Pillow is not installed. Install with: pip install pillow")

    if not FFMPEG_AVAILABLE:
        raise RuntimeError("FFmpeg is not available. Please install FFmpeg.")

    # Parse configurations
    tts_config = tts_config or {}
    tts = TTSConfig(
        provider=TTSProviderType(tts_config.get("provider", "openai")),
        api_key=tts_config.get("api_key"),
        base_url=tts_config.get("base_url"),
        voice=tts_config.get("voice", "alloy"),
        model=tts_config.get("model"),
        speed=tts_config.get("speed", 1.0),
    )

    config = config or {}
    video_config = VideoConfig(
        width=config.get("width", 1920),
        height=config.get("height", 1080),
        fps=config.get("fps", 30),
        theme=config.get("theme", "light"),
        transition=config.get("transition", "cut"),
        title=config.get("title"),
    )

    # Parse slides
    slide_contents = [
        SlideContent(
            title=s.get("title", ""),
            body=s.get("body", ""),
            bullet_points=s.get("bullet_points", []),
            duration_hint=s.get("duration_hint"),
        )
        for s in slides
    ]

    if not slide_contents:
        raise ValueError("No slides provided")

    # Ensure output directory exists
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Create temp directory for intermediate files
    with tempfile.TemporaryDirectory() as temp_dir:
        slide_images: list[str] = []
        audio_files: list[str] = []
        durations: list[float] = []

        # Render title slide if title is provided
        total_slides = len(slide_contents)
        if video_config.title:
            total_slides += 1
            report_progress(0, total_slides, "Rendering title slide")
            title_img = render_title_slide(
                video_config.title, video_config, len(slide_contents)
            )
            title_path = os.path.join(temp_dir, "slide_000_title.png")
            title_img.save(title_path)
            slide_images.append(title_path)
            durations.append(3.0)  # 3 second title slide

        # Render slides and generate audio
        for i, slide in enumerate(slide_contents):
            current_slide = i + 1
            report_progress(current_slide, total_slides, f"Rendering slide {current_slide}")

            # Render slide
            img = render_slide(slide, video_config, i + 1, len(slide_contents))
            img_path = os.path.join(temp_dir, f"slide_{i + 1:03d}.png")
            img.save(img_path)
            slide_images.append(img_path)

            # Generate audio
            report_progress(current_slide, total_slides, f"Generating audio for slide {current_slide}")
            audio_path = os.path.join(temp_dir, f"audio_{i + 1:03d}.mp3")
            try:
                duration = await generate_slide_audio(slide, tts, audio_path)
                audio_files.append(audio_path)
                # Add a small buffer to duration
                durations.append(max(duration + 0.5, slide.duration_hint or 5.0))
            except Exception as e:
                # If audio generation fails, use duration hint or default
                durations.append(slide.duration_hint or 5.0)
                print(f"Warning: Audio generation failed for slide {i + 1}: {e}")

        # Assemble video
        report_progress(total_slides, total_slides, "Assembling video with FFmpeg")
        timestamp = int(time.time())
        video_filename = f"presentation_{timestamp}.mp4"
        video_path = os.path.join(output_dir, video_filename)

        total_duration = assemble_video_ffmpeg(
            slide_images,
            audio_files,
            durations,
            video_path,
            video_config,
        )

    report_progress(total_slides, total_slides, "Complete")
    generation_time = time.time() - start_time

    result = VideoResult(
        video_path=video_path,
        duration_seconds=total_duration,
        slide_count=len(slide_contents),
        generation_time_seconds=round(generation_time, 2),
    )

    return result.model_dump()


def generate_video_sync(
    slides: list[dict[str, Any]],
    output_dir: str,
    tts_config: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    progress_callback: Any | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for generate_video."""
    return asyncio.run(generate_video(slides, output_dir, tts_config, config, progress_callback))


# ===== Availability Check =====


def check_video_availability() -> dict[str, bool]:
    """Check which video generation features are available."""
    return {
        "pillow": PILLOW_AVAILABLE,
        "ffmpeg": FFMPEG_AVAILABLE,
        "pydub": PYDUB_AVAILABLE,
        "fully_available": PILLOW_AVAILABLE and FFMPEG_AVAILABLE,
    }
