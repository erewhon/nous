import type {
  BlockTool,
  BlockToolConstructorOptions,
  ToolConfig,
} from "@editorjs/editorjs";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { VideoBlockData, VideoDisplayMode } from "../../types/video";
import { SUPPORTED_VIDEO_MIMETYPES, SUPPORTED_VIDEO_EXTENSIONS } from "../../types/video";
import { createVideoUploader } from "./videoUploader";

interface VideoToolConfig extends ToolConfig {
  notebookId?: string;
  onOpenFullScreen?: (blockId: string, data: VideoBlockData) => void;
  onTranscribe?: (blockId: string, videoPath: string) => void;
}

const DISPLAY_MODE_CONFIG: Record<
  VideoDisplayMode,
  { icon: string; label: string; maxHeight: string }
> = {
  compact: { icon: "S", label: "Compact", maxHeight: "200px" },
  standard: { icon: "M", label: "Standard", maxHeight: "400px" },
  large: { icon: "L", label: "Large", maxHeight: "600px" },
};

export class VideoTool implements BlockTool {
  private data: VideoBlockData;
  private config: VideoToolConfig;
  private blockId: string;
  private wrapper: HTMLDivElement | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private captionEl: HTMLInputElement | null = null;
  private viewerRoot: Root | null = null;

  static get toolbox() {
    return {
      title: "Video",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get pasteConfig() {
    return {
      files: {
        mimeTypes: [...SUPPORTED_VIDEO_MIMETYPES],
        extensions: SUPPORTED_VIDEO_EXTENSIONS.map((e) => e.slice(1)),
      },
    };
  }

  constructor({
    data,
    config,
    block,
  }: BlockToolConstructorOptions<VideoBlockData, VideoToolConfig>) {
    this.config = config || {};
    this.blockId = block?.id || crypto.randomUUID();
    this.data = {
      filename: data.filename || "",
      url: data.url || "",
      originalName: data.originalName || "",
      caption: data.caption || "",
      duration: data.duration,
      currentTime: data.currentTime || 0,
      displayMode: data.displayMode || "standard",
      transcription: data.transcription,
      transcriptionStatus: data.transcriptionStatus || "none",
      showTranscript: data.showTranscript || false,
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("video-block");

    if (this.data.url) {
      this.renderVideoPlayer();
    } else {
      this.renderUploader();
    }

    return this.wrapper;
  }

  private renderUploader(): void {
    if (!this.wrapper) return;

    const uploader = document.createElement("div");
    uploader.classList.add("video-uploader");
    uploader.innerHTML = `
      <div class="video-uploader-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--color-text-muted)">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
          <polygon points="10 8 16 12 10 16 10 8"/>
        </svg>
        <p style="color: var(--color-text-secondary); margin: 8px 0 4px 0;">Click to upload a video</p>
        <p style="color: var(--color-text-muted); font-size: 12px;">MP4, WebM, MOV, MKV, AVI</p>
      </div>
      <input type="file" accept="video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v,.flv" style="display: none;" />
    `;

    const fileInput = uploader.querySelector("input") as HTMLInputElement;

    uploader.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (file) {
        await this.handleFileUpload(file);
      }
    });

    // Drag and drop
    uploader.addEventListener("dragover", (e) => {
      e.preventDefault();
      uploader.classList.add("video-uploader--dragover");
    });

    uploader.addEventListener("dragleave", () => {
      uploader.classList.remove("video-uploader--dragover");
    });

    uploader.addEventListener("drop", async (e) => {
      e.preventDefault();
      uploader.classList.remove("video-uploader--dragover");
      const file = e.dataTransfer?.files[0];
      if (file && this.isVideoFile(file)) {
        await this.handleFileUpload(file);
      }
    });

    this.wrapper.appendChild(uploader);
  }

  private isVideoFile(file: File): boolean {
    const mimeOk = SUPPORTED_VIDEO_MIMETYPES.includes(
      file.type as (typeof SUPPORTED_VIDEO_MIMETYPES)[number]
    );
    const extOk = SUPPORTED_VIDEO_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );
    return mimeOk || extOk;
  }

  private async handleFileUpload(file: File): Promise<void> {
    if (!this.config.notebookId || !this.wrapper) return;

    // Show loading state
    const uploader = this.wrapper.querySelector(".video-uploader");
    if (uploader) {
      uploader.innerHTML = `
        <div class="video-uploader-content">
          <svg class="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-accent)">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.75"/>
          </svg>
          <p style="color: var(--color-text-secondary); margin-top: 8px;">Uploading video...</p>
        </div>
      `;
    }

    const videoUploader = createVideoUploader({ notebookId: this.config.notebookId });
    const result = await videoUploader.uploadByFile(file);

    if (result.success) {
      this.data.url = result.file.url;
      this.data.filename = result.file.filename;
      this.data.originalName = result.file.originalName;

      // Clear wrapper and render video player
      this.wrapper.innerHTML = "";
      this.renderVideoPlayer();
    } else {
      // Show error
      if (uploader) {
        uploader.innerHTML = `
          <div class="video-uploader-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style="color: var(--color-error); margin-top: 8px;">Failed to upload video</p>
            <p style="color: var(--color-text-muted); font-size: 12px;">Click to try again</p>
          </div>
        `;
      }
    }
  }

  private renderVideoPlayer(): void {
    if (!this.wrapper) return;

    const container = document.createElement("div");
    container.classList.add("video-player-container");

    // Header with filename and controls
    const header = document.createElement("div");
    header.classList.add("video-block-header");

    const filenameEl = document.createElement("span");
    filenameEl.classList.add("video-filename");
    filenameEl.textContent = this.data.originalName || "Video";
    filenameEl.title = this.data.originalName || "";

    const controls = document.createElement("div");
    controls.classList.add("video-controls");

    // Transcription status indicator
    if (this.data.transcriptionStatus === "complete") {
      const transcriptIndicator = document.createElement("span");
      transcriptIndicator.classList.add("video-transcript-indicator");
      transcriptIndicator.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
      transcriptIndicator.title = "Transcription available";
      controls.appendChild(transcriptIndicator);
    }

    // Full screen button
    const fullScreenBtn = document.createElement("button");
    fullScreenBtn.type = "button";
    fullScreenBtn.classList.add("video-fullscreen-btn");
    fullScreenBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    fullScreenBtn.title = "Open in full screen";
    fullScreenBtn.addEventListener("click", () => {
      this.config.onOpenFullScreen?.(this.blockId, this.data);
    });

    controls.appendChild(fullScreenBtn);

    header.appendChild(filenameEl);
    header.appendChild(controls);

    // Video element
    const videoWrapper = document.createElement("div");
    videoWrapper.classList.add("video-wrapper");
    videoWrapper.style.maxHeight = DISPLAY_MODE_CONFIG[this.data.displayMode].maxHeight;

    this.videoEl = document.createElement("video");
    this.videoEl.classList.add("video-element");
    this.videoEl.src = this.data.url;
    this.videoEl.controls = true;
    this.videoEl.preload = "metadata";
    this.videoEl.currentTime = this.data.currentTime;

    this.videoEl.addEventListener("loadedmetadata", () => {
      if (this.videoEl) {
        this.data.duration = this.videoEl.duration;
      }
    });

    this.videoEl.addEventListener("timeupdate", () => {
      if (this.videoEl) {
        this.data.currentTime = this.videoEl.currentTime;
      }
    });

    videoWrapper.appendChild(this.videoEl);

    // Inline transcript preview (if available and showTranscript is true)
    let transcriptContainer: HTMLElement | null = null;
    if (this.data.transcription && this.data.showTranscript) {
      transcriptContainer = document.createElement("div");
      transcriptContainer.classList.add("video-transcript-preview");
      transcriptContainer.id = `video-transcript-${this.blockId}`;
      this.mountTranscriptPreview(transcriptContainer);
    }

    // Caption input
    this.captionEl = document.createElement("input");
    this.captionEl.type = "text";
    this.captionEl.classList.add("video-caption");
    this.captionEl.placeholder = "Add a caption...";
    this.captionEl.value = this.data.caption;
    this.captionEl.addEventListener("input", () => {
      this.data.caption = this.captionEl?.value || "";
    });

    container.appendChild(header);
    container.appendChild(videoWrapper);
    if (transcriptContainer) {
      container.appendChild(transcriptContainer);
    }
    container.appendChild(this.captionEl);

    this.wrapper.appendChild(container);
  }

  private mountTranscriptPreview(container: HTMLElement): void {
    if (!this.data.transcription) return;

    // Dynamically import and render TranscriptPreview component
    import("../Video/TranscriptPreview").then(({ TranscriptPreview }) => {
      this.viewerRoot = createRoot(container);
      this.viewerRoot.render(
        createElement(TranscriptPreview, {
          transcription: this.data.transcription!,
          currentTime: this.data.currentTime,
          onSegmentClick: (segment) => {
            if (this.videoEl) {
              this.videoEl.currentTime = segment.start;
              this.videoEl.play();
            }
          },
          maxHeight: "150px",
        })
      );
    }).catch(() => {
      // TranscriptPreview not yet implemented - show placeholder
      container.innerHTML = `
        <div class="video-transcript-placeholder">
          <p style="color: var(--color-text-muted); font-size: 12px; padding: 8px;">
            ${this.data.transcription?.segments.length || 0} transcript segments available
          </p>
        </div>
      `;
    });
  }

  save(): VideoBlockData {
    return {
      filename: this.data.filename,
      url: this.data.url,
      originalName: this.data.originalName,
      caption: this.captionEl?.value || this.data.caption,
      duration: this.data.duration,
      currentTime: this.videoEl?.currentTime || this.data.currentTime,
      displayMode: this.data.displayMode,
      transcription: this.data.transcription,
      transcriptionStatus: this.data.transcriptionStatus,
      showTranscript: this.data.showTranscript,
    };
  }

  validate(savedData: VideoBlockData): boolean {
    return !!savedData.url;
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("video-settings");

    // Display mode settings
    const modeSection = document.createElement("div");
    modeSection.classList.add("video-settings-section");

    const modeLabel = document.createElement("div");
    modeLabel.classList.add("cdx-settings-label");
    modeLabel.textContent = "Display Size";
    modeSection.appendChild(modeLabel);

    (Object.keys(DISPLAY_MODE_CONFIG) as VideoDisplayMode[]).forEach((mode) => {
      const btn = document.createElement("div");
      btn.classList.add("cdx-settings-button");
      if (mode === this.data.displayMode) {
        btn.classList.add("cdx-settings-button--active");
      }
      btn.innerHTML = `${DISPLAY_MODE_CONFIG[mode].icon} ${DISPLAY_MODE_CONFIG[mode].label}`;
      btn.title = `Max height: ${DISPLAY_MODE_CONFIG[mode].maxHeight}`;
      btn.addEventListener("click", () => {
        this.setDisplayMode(mode);
        modeSection.querySelectorAll(".cdx-settings-button").forEach((b) => {
          b.classList.remove("cdx-settings-button--active");
        });
        btn.classList.add("cdx-settings-button--active");
      });
      modeSection.appendChild(btn);
    });

    wrapper.appendChild(modeSection);

    // Transcription section
    const transcriptSection = document.createElement("div");
    transcriptSection.classList.add("video-settings-section");
    transcriptSection.style.marginTop = "12px";

    const transcriptLabel = document.createElement("div");
    transcriptLabel.classList.add("cdx-settings-label");
    transcriptLabel.textContent = "Transcription";
    transcriptSection.appendChild(transcriptLabel);

    if (this.data.transcriptionStatus === "none" || this.data.transcriptionStatus === "error") {
      // Transcribe button
      const transcribeBtn = document.createElement("div");
      transcribeBtn.classList.add("cdx-settings-button");
      transcribeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Transcribe';
      transcribeBtn.title = "Transcribe video audio using AI";
      transcribeBtn.addEventListener("click", () => {
        this.config.onTranscribe?.(this.blockId, this.data.filename);
      });
      transcriptSection.appendChild(transcribeBtn);
    } else if (this.data.transcriptionStatus === "pending") {
      const pendingEl = document.createElement("div");
      pendingEl.classList.add("cdx-settings-button");
      pendingEl.style.cursor = "default";
      pendingEl.innerHTML = '<svg class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.75"/></svg> Transcribing...';
      transcriptSection.appendChild(pendingEl);
    } else if (this.data.transcriptionStatus === "complete") {
      // Show/hide transcript toggle
      const toggleBtn = document.createElement("div");
      toggleBtn.classList.add("cdx-settings-button");
      if (this.data.showTranscript) {
        toggleBtn.classList.add("cdx-settings-button--active");
      }
      toggleBtn.innerHTML = this.data.showTranscript ? "Hide Transcript" : "Show Transcript";
      toggleBtn.addEventListener("click", () => {
        this.data.showTranscript = !this.data.showTranscript;
        toggleBtn.innerHTML = this.data.showTranscript ? "Hide Transcript" : "Show Transcript";
        toggleBtn.classList.toggle("cdx-settings-button--active", this.data.showTranscript);
        // Re-render to show/hide transcript
        if (this.wrapper) {
          this.wrapper.innerHTML = "";
          this.renderVideoPlayer();
        }
      });
      transcriptSection.appendChild(toggleBtn);

      // Word count info
      if (this.data.transcription) {
        const infoEl = document.createElement("div");
        infoEl.style.cssText = "font-size: 11px; color: var(--color-text-muted); margin-top: 4px;";
        infoEl.textContent = `${this.data.transcription.wordCount} words, ${this.data.transcription.segments.length} segments`;
        transcriptSection.appendChild(infoEl);
      }
    }

    wrapper.appendChild(transcriptSection);

    return wrapper;
  }

  private setDisplayMode(mode: VideoDisplayMode): void {
    this.data.displayMode = mode;

    const videoWrapper = this.wrapper?.querySelector(".video-wrapper") as HTMLElement;
    if (videoWrapper) {
      videoWrapper.style.maxHeight = DISPLAY_MODE_CONFIG[mode].maxHeight;
    }
  }

  // Update transcription status (called from outside when transcription completes)
  updateTranscription(
    status: "none" | "pending" | "complete" | "error",
    transcription?: VideoBlockData["transcription"]
  ): void {
    this.data.transcriptionStatus = status;
    if (transcription) {
      this.data.transcription = transcription;
    }
    // Re-render to reflect new status
    if (this.wrapper) {
      this.wrapper.innerHTML = "";
      if (this.data.url) {
        this.renderVideoPlayer();
      }
    }
  }

  // Cleanup
  destroy(): void {
    if (this.viewerRoot) {
      this.viewerRoot.unmount();
      this.viewerRoot = null;
    }
    this.videoEl = null;
  }
}
