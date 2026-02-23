import type {
  BlockTool,
  BlockToolConstructorOptions,
  ToolConfig,
} from "@editorjs/editorjs";
import { convertFileSrc } from "@tauri-apps/api/core";
import { saveAudioRecording, transcribeAudio } from "../../utils/audioApi";
import type { AudioBlockData } from "../../types/audio";

interface AudioToolConfig extends ToolConfig {
  notebookId?: string;
}

export class AudioTool implements BlockTool {
  private data: AudioBlockData;
  private config: AudioToolConfig;
  private wrapper: HTMLDivElement | null = null;
  private api: BlockToolConstructorOptions["api"];

  // Recording state (managed manually, not React)
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrame: number | null = null;
  private chunks: Blob[] = [];
  private recordingTimer: ReturnType<typeof setInterval> | null = null;
  private recordingStartTime: number = 0;

  // Player state
  private audioElement: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;

  static get toolbox() {
    return {
      title: "Audio",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  constructor({
    data,
    config,
    api,
  }: BlockToolConstructorOptions<AudioBlockData, AudioToolConfig>) {
    this.config = config || {};
    this.api = api;
    this.data = {
      filename: data.filename || "",
      url: data.url || "",
      duration: data.duration,
      caption: data.caption || "",
      transcription: data.transcription || "",
      transcriptionStatus: data.transcriptionStatus || "idle",
      showTranscript: data.showTranscript || false,
      recordedAt: data.recordedAt || "",
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("audio-block");

    if (this.data.url) {
      this.renderPlayer();
    } else {
      this.renderRecorder();
    }

    return this.wrapper;
  }

  private renderRecorder(): void {
    if (!this.wrapper) return;
    this.wrapper.innerHTML = "";

    const recorder = document.createElement("div");
    recorder.classList.add("audio-recorder");

    const micBtn = document.createElement("button");
    micBtn.classList.add("audio-recorder__mic-btn");
    micBtn.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
    micBtn.title = "Click to record";

    const levelMeter = document.createElement("div");
    levelMeter.classList.add("audio-level-meter");
    const levelBar = document.createElement("div");
    levelBar.classList.add("audio-level-meter__bar");
    levelMeter.appendChild(levelBar);

    const timerEl = document.createElement("span");
    timerEl.classList.add("audio-recorder__timer");
    timerEl.textContent = "0:00";

    const stopBtn = document.createElement("button");
    stopBtn.classList.add("audio-recorder__stop-btn");
    stopBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    stopBtn.title = "Stop recording";
    stopBtn.style.display = "none";

    const hint = document.createElement("span");
    hint.classList.add("audio-recorder__hint");
    hint.textContent = "Click mic to start recording";

    recorder.appendChild(micBtn);
    recorder.appendChild(levelMeter);
    recorder.appendChild(timerEl);
    recorder.appendChild(stopBtn);
    recorder.appendChild(hint);

    micBtn.addEventListener("click", () => {
      this.startRecording(levelBar, timerEl, micBtn, stopBtn, hint);
    });

    stopBtn.addEventListener("click", () => {
      this.stopRecording();
    });

    this.wrapper!.appendChild(recorder);
  }

  private async startRecording(
    levelBar: HTMLDivElement,
    timerEl: HTMLSpanElement,
    micBtn: HTMLButtonElement,
    stopBtn: HTMLButtonElement,
    hint: HTMLSpanElement
  ): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      hint.textContent = "Microphone access denied";
      hint.style.color = "var(--color-error, #f44)";
      return;
    }

    // Set up AudioContext for level metering
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    const updateLevel = () => {
      if (!this.analyser) return;
      const data = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 3);
      levelBar.style.width = `${level * 100}%`;
      this.animFrame = requestAnimationFrame(updateLevel);
    };
    this.animFrame = requestAnimationFrame(updateLevel);

    // Determine supported MIME type
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];
    let mimeType = "";
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) {
        mimeType = t;
        break;
      }
    }

    this.mediaRecorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType })
      : new MediaRecorder(this.stream);
    this.chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      this.handleRecordingComplete();
    };

    this.mediaRecorder.start(100);
    this.recordingStartTime = Date.now();

    // Update UI
    micBtn.style.display = "none";
    stopBtn.style.display = "flex";
    hint.textContent = "Recording...";
    hint.style.color = "";
    levelBar.parentElement!.style.display = "flex";

    // Timer
    this.recordingTimer = setInterval(() => {
      const elapsed = (Date.now() - this.recordingStartTime) / 1000;
      const mins = Math.floor(elapsed / 60);
      const secs = Math.floor(elapsed % 60);
      timerEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
    }, 200);
  }

  private stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.cleanupRecording();
  }

  private cleanupRecording(): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    if (this.recordingTimer !== null) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.analyser = null;
  }

  private async handleRecordingComplete(): Promise<void> {
    if (this.chunks.length === 0) return;

    const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    this.chunks = [];
    this.mediaRecorder = null;

    const format = mimeType.includes("ogg") ? "ogg" : "webm";
    const notebookId = this.config.notebookId;
    if (!notebookId) {
      console.error("AudioTool: no notebookId configured");
      return;
    }

    // Convert blob to base64
    const reader = new FileReader();
    const base64Data = await new Promise<string>((resolve) => {
      reader.onloadend = () => {
        const result = reader.result as string;
        // Strip data URL prefix
        const base64 = result.split(",")[1] || result;
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });

    try {
      const result = await saveAudioRecording(notebookId, base64Data, format);
      this.data.url = result.path;
      this.data.filename = result.filename;
      this.data.recordedAt = new Date().toISOString();
      this.data.duration = (Date.now() - this.recordingStartTime) / 1000;
      this.data.transcriptionStatus = "idle";
      this.renderPlayer();
    } catch (err) {
      console.error("Failed to save audio recording:", err);
    }
  }

  private async renderPlayer(): Promise<void> {
    if (!this.wrapper) return;
    this.wrapper.innerHTML = "";

    const player = document.createElement("div");
    player.classList.add("audio-player");

    // Header row
    const header = document.createElement("div");
    header.classList.add("audio-player__header");

    const icon = document.createElement("span");
    icon.classList.add("audio-player__icon");
    icon.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>';

    const title = document.createElement("span");
    title.classList.add("audio-player__title");
    title.textContent = this.data.caption || this.data.filename || "Audio Recording";

    const durationEl = document.createElement("span");
    durationEl.classList.add("audio-player__duration");
    if (this.data.duration) {
      durationEl.textContent = this.formatDuration(this.data.duration);
    }

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(durationEl);

    // Audio element
    const audioContainer = document.createElement("div");
    audioContainer.classList.add("audio-player__controls");

    const audioEl = document.createElement("audio");
    audioEl.controls = true;
    audioEl.preload = "metadata";

    // Load audio via fetch → blob URL (same pattern as AudioGenerateDialog)
    try {
      const assetUrl = convertFileSrc(this.data.url);
      const response = await fetch(assetUrl);
      if (response.ok) {
        const blob = await response.blob();
        if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = URL.createObjectURL(blob);
        audioEl.src = this.blobUrl;
      } else {
        audioEl.src = assetUrl;
      }
    } catch {
      // Fallback: try direct asset URL
      audioEl.src = convertFileSrc(this.data.url);
    }

    audioEl.addEventListener("loadedmetadata", () => {
      if (audioEl.duration && isFinite(audioEl.duration)) {
        this.data.duration = audioEl.duration;
        durationEl.textContent = this.formatDuration(audioEl.duration);
      }
    });

    this.audioElement = audioEl;
    audioContainer.appendChild(audioEl);

    // Caption input
    const captionInput = document.createElement("input");
    captionInput.classList.add("audio-player__caption");
    captionInput.type = "text";
    captionInput.placeholder = "Add a caption...";
    captionInput.value = this.data.caption || "";
    captionInput.addEventListener("input", () => {
      this.data.caption = captionInput.value;
    });

    // Transcription section
    const transcriptSection = document.createElement("div");
    transcriptSection.classList.add("audio-player__transcript");

    if (this.data.transcription && this.data.showTranscript) {
      const transcriptText = document.createElement("div");
      transcriptText.classList.add("audio-player__transcript-text");
      transcriptText.textContent = this.data.transcription;
      transcriptSection.appendChild(transcriptText);
    }

    player.appendChild(header);
    player.appendChild(audioContainer);
    player.appendChild(captionInput);
    player.appendChild(transcriptSection);

    this.wrapper!.appendChild(player);
  }

  renderSettings(): HTMLElement {
    const settingsWrapper = document.createElement("div");

    // Transcribe button
    const transcribeBtn = document.createElement("div");
    transcribeBtn.classList.add("ce-popover-item");
    transcribeBtn.innerHTML = `
      <div class="ce-popover-item__icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
        </svg>
      </div>
      <div class="ce-popover-item__title">${this.data.transcriptionStatus === "transcribing" ? "Transcribing..." : "Transcribe"}</div>
    `;
    if (this.data.transcriptionStatus !== "transcribing") {
      transcribeBtn.addEventListener("click", () => this.handleTranscribe());
    }

    // Toggle transcript visibility
    if (this.data.transcription) {
      const toggleBtn = document.createElement("div");
      toggleBtn.classList.add("ce-popover-item");
      toggleBtn.innerHTML = `
        <div class="ce-popover-item__icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <div class="ce-popover-item__title">${this.data.showTranscript ? "Hide Transcript" : "Show Transcript"}</div>
      `;
      toggleBtn.addEventListener("click", () => {
        this.data.showTranscript = !this.data.showTranscript;
        this.renderPlayer();
      });
      settingsWrapper.appendChild(toggleBtn);
    }

    settingsWrapper.appendChild(transcribeBtn);

    // Delete button
    const deleteBtn = document.createElement("div");
    deleteBtn.classList.add("ce-popover-item", "ce-popover-item--destructive");
    deleteBtn.innerHTML = `
      <div class="ce-popover-item__icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </div>
      <div class="ce-popover-item__title">Delete</div>
    `;
    deleteBtn.addEventListener("click", () => {
      this.api.blocks.delete(this.api.blocks.getCurrentBlockIndex());
    });
    settingsWrapper.appendChild(deleteBtn);

    return settingsWrapper;
  }

  private async handleTranscribe(): Promise<void> {
    if (!this.data.url) return;

    this.data.transcriptionStatus = "transcribing";

    try {
      const result = await transcribeAudio(this.data.url);
      const text = result.segments.map((s) => s.text).join(" ");
      this.data.transcription = text;
      this.data.transcriptionStatus = "done";
      this.data.showTranscript = true;
      this.renderPlayer();
    } catch (err) {
      console.error("Transcription failed:", err);
      this.data.transcriptionStatus = "error";
    }
  }

  save(): AudioBlockData {
    return { ...this.data };
  }

  validate(savedData: AudioBlockData): boolean {
    // Valid if we have a URL (saved recording) or empty (just inserted, not yet recorded)
    return true;
    // Allow empty blocks so users can record later
    void savedData;
  }

  destroy(): void {
    this.cleanupRecording();
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = "";
      this.audioElement = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
}
