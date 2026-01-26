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
import { VideoThumbnail } from "./VideoThumbnail";
import { VideoPlayerModal } from "./VideoPlayerModal";
import { transcribeVideo } from "../../utils/videoApi";

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
  private modalRoot: Root | null = null;
  private modalContainer: HTMLDivElement | null = null;
  private uploaderMode: "upload" | "url" = "upload";
  private isModalOpen: boolean = false;

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
      thumbnailUrl: data.thumbnailUrl || "",
      originalName: data.originalName || "",
      caption: data.caption || "",
      duration: data.duration,
      currentTime: data.currentTime || 0,
      displayMode: data.displayMode || "standard",
      transcription: data.transcription,
      transcriptionStatus: data.transcriptionStatus || "none",
      showTranscript: data.showTranscript || false,
      isExternal: data.isExternal || false,
      externalType: data.externalType,
      localPath: data.localPath,
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("video-block");

    if (this.data.localPath) {
      // Local file - need to re-link to ensure symlink exists and URL is valid
      this.relinkLocalVideo();
    } else if (this.data.url) {
      this.renderVideoPlayer();
    } else {
      this.renderUploader();
    }

    return this.wrapper;
  }

  private async relinkLocalVideo(): Promise<void> {
    if (!this.wrapper || !this.data.localPath) return;

    // Show loading state
    this.wrapper.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100px; background: var(--color-bg-tertiary); border-radius: 8px;">
        <p style="color: var(--color-text-muted); font-size: 13px;">Loading video...</p>
      </div>
    `;

    try {
      const { invoke } = await import("@tauri-apps/api/core");

      const linkedPath = await invoke<string>("link_external_video", {
        sourcePath: this.data.localPath,
      });

      // Construct asset URL manually - use http://asset.localhost format
      this.data.url = `http://asset.localhost${linkedPath}`;
      this.wrapper.innerHTML = "";
      this.renderVideoPlayer();
    } catch (error) {
      console.error("Failed to relink video:", error);
      this.wrapper.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 150px; background: var(--color-bg-tertiary); border-radius: 8px; padding: 1rem;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p style="color: var(--color-error); margin: 8px 0 4px 0; font-size: 13px;">Failed to load video</p>
          <p style="color: var(--color-text-muted); font-size: 11px; text-align: center; word-break: break-all; max-width: 300px;">${this.data.localPath}</p>
        </div>
      `;
    }
  }

  private renderUploader(): void {
    if (!this.wrapper) return;

    const uploader = document.createElement("div");
    uploader.classList.add("video-uploader");

    // Tab buttons
    const tabContainer = document.createElement("div");
    tabContainer.style.cssText = "display: flex; gap: 0; border-bottom: 1px solid var(--color-border); margin-bottom: 12px;";

    const uploadTab = document.createElement("button");
    uploadTab.type = "button";
    uploadTab.textContent = "Upload";
    uploadTab.style.cssText = `
      flex: 1; padding: 8px 16px; border: none; background: none; cursor: pointer;
      font-size: 13px; color: var(--color-text-secondary); transition: all 0.2s;
      border-bottom: 2px solid transparent; margin-bottom: -1px;
    `;

    const urlTab = document.createElement("button");
    urlTab.type = "button";
    urlTab.textContent = "Link URL";
    urlTab.style.cssText = uploadTab.style.cssText;

    const updateTabs = () => {
      if (this.uploaderMode === "upload") {
        uploadTab.style.color = "var(--color-accent)";
        uploadTab.style.borderBottomColor = "var(--color-accent)";
        urlTab.style.color = "var(--color-text-secondary)";
        urlTab.style.borderBottomColor = "transparent";
      } else {
        urlTab.style.color = "var(--color-accent)";
        urlTab.style.borderBottomColor = "var(--color-accent)";
        uploadTab.style.color = "var(--color-text-secondary)";
        uploadTab.style.borderBottomColor = "transparent";
      }
    };

    uploadTab.addEventListener("click", (e) => {
      e.stopPropagation();
      this.uploaderMode = "upload";
      updateTabs();
      renderContent();
    });

    urlTab.addEventListener("click", (e) => {
      e.stopPropagation();
      this.uploaderMode = "url";
      updateTabs();
      renderContent();
    });

    tabContainer.appendChild(uploadTab);
    tabContainer.appendChild(urlTab);
    uploader.appendChild(tabContainer);

    // Content area
    const contentArea = document.createElement("div");
    contentArea.classList.add("video-uploader-content");
    uploader.appendChild(contentArea);

    const renderContent = () => {
      if (this.uploaderMode === "upload") {
        contentArea.innerHTML = `
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--color-text-muted)">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
            <polygon points="10 8 16 12 10 16 10 8"/>
          </svg>
          <p style="color: var(--color-text-secondary); margin: 8px 0 4px 0;">Click to upload a video</p>
          <p style="color: var(--color-text-muted); font-size: 12px;">MP4, WebM, MOV, MKV, AVI</p>
        `;
        const fileInputEl = document.createElement("input");
        fileInputEl.type = "file";
        fileInputEl.accept = "video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v,.flv";
        fileInputEl.style.display = "none";
        contentArea.appendChild(fileInputEl);

        contentArea.style.cursor = "pointer";
        contentArea.onclick = () => fileInputEl.click();

        fileInputEl.addEventListener("change", async () => {
          const file = fileInputEl.files?.[0];
          if (file) {
            await this.handleFileUpload(file);
          }
        });
      } else {
        contentArea.innerHTML = `
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--color-text-muted); margin-bottom: 8px;">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <p style="color: var(--color-text-secondary); margin: 0 0 12px 0; font-size: 13px;">Enter a video URL or browse for a local file</p>
          <p style="color: var(--color-text-muted); margin: 0 0 8px 0; font-size: 11px;">YouTube, Vimeo, direct link, or local video file</p>
        `;

        const inputWrapper = document.createElement("div");
        inputWrapper.style.cssText = "display: flex; gap: 8px; width: 100%; max-width: 450px;";

        const urlInput = document.createElement("input");
        urlInput.type = "text";
        urlInput.placeholder = "https://... or /path/to/video.mp4";
        urlInput.style.cssText = `
          flex: 1; padding: 8px 12px; border: 1px solid var(--color-border);
          border-radius: 6px; background: var(--color-bg-secondary);
          color: var(--color-text-primary); font-size: 13px;
        `;

        const browseBtn = document.createElement("button");
        browseBtn.type = "button";
        browseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
        browseBtn.title = "Browse for local video file";
        browseBtn.style.cssText = `
          padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 6px;
          background: var(--color-bg-tertiary); color: var(--color-text-secondary);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
        `;

        browseBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();
          try {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selected = await open({
              multiple: false,
              filters: [{
                name: "Video",
                extensions: ["mp4", "webm", "mov", "mkv", "avi", "m4v", "flv"]
              }]
            });
            if (selected && typeof selected === "string") {
              urlInput.value = selected;
              // Directly link to local file (don't upload)
              await this.linkLocalFile(selected);
            }
          } catch (err) {
            console.error("Failed to open file dialog:", err);
          }
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.textContent = "Add";
        addBtn.style.cssText = `
          padding: 8px 16px; border: none; border-radius: 6px;
          background: var(--color-accent); color: white; font-size: 13px;
          cursor: pointer; font-weight: 500;
        `;

        addBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const url = urlInput.value.trim();
          if (url) {
            this.handleExternalUrl(url);
          }
        });

        urlInput.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            const url = urlInput.value.trim();
            if (url) {
              this.handleExternalUrl(url);
            }
          }
        });

        urlInput.addEventListener("click", (e) => e.stopPropagation());

        inputWrapper.appendChild(urlInput);
        inputWrapper.appendChild(browseBtn);
        inputWrapper.appendChild(addBtn);
        contentArea.appendChild(inputWrapper);

        contentArea.style.cursor = "default";
        contentArea.onclick = null;
      }
    };

    updateTabs();
    renderContent();

    // Drag and drop (for upload mode)
    uploader.addEventListener("dragover", (e) => {
      if (this.uploaderMode === "upload") {
        e.preventDefault();
        uploader.classList.add("video-uploader--dragover");
      }
    });

    uploader.addEventListener("dragleave", () => {
      uploader.classList.remove("video-uploader--dragover");
    });

    uploader.addEventListener("drop", async (e) => {
      if (this.uploaderMode === "upload") {
        e.preventDefault();
        uploader.classList.remove("video-uploader--dragover");
        const file = e.dataTransfer?.files[0];
        if (file && this.isVideoFile(file)) {
          await this.handleFileUpload(file);
        }
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

    // Format file size for display
    const formatSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    // Show loading state with file info and progress
    const uploader = this.wrapper.querySelector(".video-uploader");
    if (uploader) {
      const fileSize = formatSize(file.size);
      uploader.innerHTML = `
        <div class="video-uploader-content" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
          <svg class="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-accent)">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.75"/>
          </svg>
          <p style="color: var(--color-text-secondary); margin: 12px 0 4px 0; font-weight: 500;">Uploading video...</p>
          <p style="color: var(--color-text-muted); font-size: 12px; margin: 0; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</p>
          <p style="color: var(--color-text-muted); font-size: 11px; margin: 4px 0 0 0;">${fileSize}</p>
          <div class="video-upload-progress" style="width: 200px; height: 4px; background: var(--color-bg-tertiary); border-radius: 2px; margin-top: 16px; overflow: hidden;">
            <div class="video-upload-progress-bar" style="width: 0%; height: 100%; background: var(--color-accent); transition: width 0.3s ease;"></div>
          </div>
          <p class="video-upload-status" style="color: var(--color-text-muted); font-size: 11px; margin-top: 8px;">Reading file...</p>
        </div>
      `;
    }

    const progressBar = uploader?.querySelector(".video-upload-progress-bar") as HTMLElement;
    const statusText = uploader?.querySelector(".video-upload-status") as HTMLElement;

    // Update progress
    const updateProgress = (percent: number, status: string) => {
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (statusText) statusText.textContent = status;
    };

    updateProgress(10, "Reading file...");

    const videoUploader = createVideoUploader({ notebookId: this.config.notebookId });

    // Simulate progress for file read (since we can't track actual invoke progress)
    updateProgress(30, "Processing...");

    const result = await videoUploader.uploadByFile(file);

    if (result.success) {
      updateProgress(100, "Complete!");

      this.data.url = result.file.url;
      this.data.thumbnailUrl = result.file.thumbnailUrl;
      this.data.filename = result.file.filename;
      this.data.originalName = result.file.originalName;

      // Brief delay to show completion, then render player
      setTimeout(() => {
        if (this.wrapper) {
          this.wrapper.innerHTML = "";
          this.renderVideoPlayer();
        }
      }, 300);
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

  private async linkLocalFile(filePath: string): Promise<void> {
    if (!this.wrapper) return;

    // Remove file:// prefix if present and decode if URL-encoded
    let cleanPath = filePath;
    if (filePath.startsWith("file://")) {
      cleanPath = filePath.replace("file://", "");
    }
    // Decode any URL-encoded characters
    try {
      cleanPath = decodeURIComponent(cleanPath);
    } catch {
      // Path wasn't encoded, use as-is
    }

    try {
      // Create a symlink in the app's data directory to bypass asset protocol scope issues
      const { invoke } = await import("@tauri-apps/api/core");

      const linkedPath = await invoke<string>("link_external_video", {
        sourcePath: cleanPath,
      });

      // Construct asset URL manually - use http://asset.localhost format
      const assetUrl = `http://asset.localhost${linkedPath}`;

      this.data.url = assetUrl;
      this.data.isExternal = true;
      this.data.externalType = "direct";
      this.data.originalName = cleanPath.split(/[/\\]/).pop() || "Local Video";
      this.data.filename = "";
      this.data.localPath = cleanPath;
      this.wrapper.innerHTML = "";
      this.renderVideoPlayer();
    } catch (error) {
      console.error("Failed to link video:", error);
      alert(`Failed to link video: ${error}`);
    }
  }

  private async handleExternalUrl(url: string): Promise<void> {
    if (!this.wrapper) return;

    // Check if it's a local file path (Unix or Windows)
    const isLocalPath = url.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(url) || url.startsWith("file://");

    if (isLocalPath) {
      await this.linkLocalFile(url);
      return;
    }

    // Validate URL for remote URLs
    try {
      new URL(url);
    } catch {
      alert("Please enter a valid URL or local file path");
      return;
    }

    // Check if it's a YouTube URL and convert to embed format
    const youtubeMatch = url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (youtubeMatch) {
      const videoId = youtubeMatch[1];
      this.data.url = `https://www.youtube.com/embed/${videoId}`;
      this.data.isExternal = true;
      this.data.externalType = "youtube";
      this.data.originalName = `YouTube: ${videoId}`;
      this.data.filename = "";
      this.wrapper.innerHTML = "";
      this.renderVideoPlayer();
      return;
    }

    // Check if it's a Vimeo URL
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
      const videoId = vimeoMatch[1];
      this.data.url = `https://player.vimeo.com/video/${videoId}`;
      this.data.isExternal = true;
      this.data.externalType = "vimeo";
      this.data.originalName = `Vimeo: ${videoId}`;
      this.data.filename = "";
      this.wrapper.innerHTML = "";
      this.renderVideoPlayer();
      return;
    }

    // Direct video URL
    this.data.url = url;
    this.data.isExternal = true;
    this.data.externalType = "direct";
    this.data.originalName = url.split("/").pop() || "External Video";
    this.data.filename = "";
    this.wrapper.innerHTML = "";
    this.renderVideoPlayer();
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

    // External video badge
    if (this.data.isExternal) {
      const externalBadge = document.createElement("span");
      externalBadge.classList.add("video-external-badge");
      externalBadge.style.cssText = "font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--color-bg-tertiary); color: var(--color-text-muted); text-transform: uppercase; margin-right: 4px;";
      externalBadge.textContent = this.data.externalType === "youtube" ? "YouTube" : this.data.externalType === "vimeo" ? "Vimeo" : "External";
      controls.appendChild(externalBadge);
    }

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

    // Video element or iframe (for external embeds)
    const videoWrapper = document.createElement("div");
    videoWrapper.classList.add("video-wrapper");
    videoWrapper.style.maxHeight = DISPLAY_MODE_CONFIG[this.data.displayMode].maxHeight;

    // Check if this is an embedded video (YouTube/Vimeo)
    if (this.data.isExternal && (this.data.externalType === "youtube" || this.data.externalType === "vimeo")) {
      const iframe = document.createElement("iframe");
      iframe.classList.add("video-element", "video-iframe");
      iframe.src = this.data.url;
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("allowfullscreen", "true");
      iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
      iframe.style.cssText = "width: 100%; aspect-ratio: 16/9; border-radius: 8px;";
      videoWrapper.appendChild(iframe);
      this.videoEl = null; // No native video element for embeds
    } else if (this.data.thumbnailUrl && !this.data.isExternal) {
      // Local video with thumbnail - use VideoThumbnail + VideoPlayerModal
      this.videoEl = null;

      // Create thumbnail container and mount React component
      const thumbnailContainer = document.createElement("div");
      thumbnailContainer.classList.add("video-thumbnail-container");
      const thumbnailRoot = createRoot(thumbnailContainer);

      thumbnailRoot.render(
        createElement(VideoThumbnail, {
          videoPath: this.data.url,
          thumbnailUrl: this.data.thumbnailUrl,
          filename: this.data.originalName || this.data.filename || "Video",
          duration: this.data.duration,
          onPlay: () => this.openVideoModal(),
        })
      );

      videoWrapper.appendChild(thumbnailContainer);

      // Create modal container (appended to body)
      this.createModalContainer();
    } else {
      // External direct URL or legacy video without thumbnail - use native video element
      this.videoEl = document.createElement("video");
      this.videoEl.classList.add("video-element");

      // Check if URL is a file path that needs to be converted to asset URL
      const isFilePath = this.data.url.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(this.data.url);
      if (isFilePath && !this.data.isExternal) {
        // Convert file path to asset URL for the native video player
        import("@tauri-apps/api/core").then(({ convertFileSrc }) => {
          if (this.videoEl) {
            const assetUrl = decodeURI(convertFileSrc(this.data.url));
            this.videoEl.src = assetUrl;
          }
        });
      } else {
        this.videoEl.src = this.data.url;
      }

      this.videoEl.controls = true;
      this.videoEl.preload = "auto"; // Load the video data
      this.videoEl.playsInline = true;

      // For external/linked files, we need to handle loading differently
      if (this.data.isExternal) {
        // Set crossOrigin for external URLs (not for local asset:// URLs)
        if (!this.data.url.startsWith("asset://") && !this.data.url.startsWith("https://asset.localhost")) {
          this.videoEl.crossOrigin = "anonymous";
        }
      }

      this.videoEl.addEventListener("loadedmetadata", () => {
        if (this.videoEl) {
          this.data.duration = this.videoEl.duration;
          // Restore playback position after metadata loads
          if (this.data.currentTime > 0) {
            this.videoEl.currentTime = this.data.currentTime;
          }
        }
      });

      this.videoEl.addEventListener("timeupdate", () => {
        if (this.videoEl) {
          this.data.currentTime = this.videoEl.currentTime;
        }
      });

      // Error handling - show message if video fails to load
      this.videoEl.addEventListener("error", () => {
        const errorMsg = document.createElement("div");
        errorMsg.style.cssText = `
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          color: var(--color-error); text-align: center; padding: 1rem;
        `;
        errorMsg.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 8px;">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p style="margin: 0; font-size: 12px;">Failed to load video</p>
          <p style="margin: 4px 0 0 0; font-size: 10px; color: var(--color-text-muted); max-width: 250px; word-break: break-all;">${this.data.url}</p>
        `;
        videoWrapper.style.position = "relative";
        videoWrapper.appendChild(errorMsg);
      });

      videoWrapper.appendChild(this.videoEl);
    }

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

  /**
   * Create and mount the modal container for the video player.
   */
  private createModalContainer(): void {
    // Remove existing modal if any
    this.destroyModalContainer();

    // Create modal container and append to body
    this.modalContainer = document.createElement("div");
    this.modalContainer.id = `video-modal-${this.blockId}`;
    document.body.appendChild(this.modalContainer);

    // Mount modal (initially closed)
    this.modalRoot = createRoot(this.modalContainer);
    this.renderModal();
  }

  /**
   * Render the modal component.
   */
  private renderModal(): void {
    if (!this.modalRoot) return;

    this.modalRoot.render(
      createElement(VideoPlayerModal, {
        isOpen: this.isModalOpen,
        onClose: () => this.closeVideoModal(),
        videoPath: this.data.localPath || this.data.url,
        title: this.data.originalName || this.data.filename || "Video",
        videoData: this.data,
        blockId: this.blockId,
      })
    );
  }

  /**
   * Open the video player modal.
   */
  private openVideoModal(): void {
    this.isModalOpen = true;
    this.renderModal();
  }

  /**
   * Close the video player modal.
   */
  private closeVideoModal(): void {
    this.isModalOpen = false;
    this.renderModal();
  }

  /**
   * Destroy the modal container and cleanup.
   */
  private destroyModalContainer(): void {
    if (this.modalRoot) {
      this.modalRoot.unmount();
      this.modalRoot = null;
    }
    if (this.modalContainer) {
      this.modalContainer.remove();
      this.modalContainer = null;
    }
  }

  save(): VideoBlockData {
    return {
      filename: this.data.filename,
      url: this.data.url,
      thumbnailUrl: this.data.thumbnailUrl,
      originalName: this.data.originalName,
      caption: this.captionEl?.value || this.data.caption,
      duration: this.data.duration,
      currentTime: this.videoEl?.currentTime || this.data.currentTime,
      displayMode: this.data.displayMode,
      transcription: this.data.transcription,
      transcriptionStatus: this.data.transcriptionStatus,
      showTranscript: this.data.showTranscript,
      isExternal: this.data.isExternal,
      externalType: this.data.externalType,
      localPath: this.data.localPath,
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
        this.handleTranscribe();
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

    // Delete/Remove section
    const deleteSection = document.createElement("div");
    deleteSection.classList.add("video-settings-section");
    deleteSection.style.marginTop = "12px";
    deleteSection.style.borderTop = "1px solid var(--color-border)";
    deleteSection.style.paddingTop = "12px";

    const removeBtn = document.createElement("div");
    removeBtn.classList.add("cdx-settings-button");
    removeBtn.style.color = "var(--color-error)";
    removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg> Remove Video';
    removeBtn.title = "Remove video and show uploader";
    removeBtn.addEventListener("click", () => {
      // Reset data and show uploader
      this.data.url = "";
      this.data.thumbnailUrl = "";
      this.data.filename = "";
      this.data.originalName = "";
      this.data.isExternal = false;
      this.data.externalType = undefined;
      this.data.transcription = undefined;
      this.data.transcriptionStatus = "none";
      this.data.showTranscript = false;
      this.destroyModalContainer();
      if (this.wrapper) {
        this.wrapper.innerHTML = "";
        this.renderUploader();
      }
    });
    deleteSection.appendChild(removeBtn);

    wrapper.appendChild(deleteSection);

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

  // Handle transcription request
  private async handleTranscribe(): Promise<void> {
    // Get the actual video path
    const videoPath = this.data.localPath || this.data.url;

    if (!videoPath) {
      console.error("No video path available for transcription");
      return;
    }

    // Skip if already transcribing or external embed (YouTube/Vimeo)
    if (this.data.transcriptionStatus === "pending") {
      return;
    }
    if (this.data.isExternal && this.data.externalType !== "direct") {
      console.error("Cannot transcribe embedded videos (YouTube/Vimeo)");
      return;
    }

    // Update status to pending
    this.data.transcriptionStatus = "pending";
    if (this.wrapper) {
      this.wrapper.innerHTML = "";
      this.renderVideoPlayer();
    }

    try {
      console.log("Starting transcription for:", videoPath);
      const result = await transcribeVideo(videoPath);
      console.log("Transcription complete:", result.wordCount, "words");

      // Update with result
      this.data.transcription = result;
      this.data.transcriptionStatus = "complete";
    } catch (error) {
      console.error("Transcription failed:", error);
      this.data.transcriptionStatus = "error";
    }

    // Re-render to show result
    if (this.wrapper) {
      this.wrapper.innerHTML = "";
      this.renderVideoPlayer();
    }
  }

  // Cleanup
  destroy(): void {
    if (this.viewerRoot) {
      this.viewerRoot.unmount();
      this.viewerRoot = null;
    }
    this.destroyModalContainer();
    this.videoEl = null;
  }
}
