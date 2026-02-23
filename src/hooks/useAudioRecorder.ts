import { useState, useRef, useCallback, useEffect } from "react";

interface UseAudioRecorderReturn {
  isRecording: boolean;
  duration: number;
  audioLevel: number;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
}

function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

export function getFormatFromMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resolveStopRef = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    analyserRef.current = null;
    setAudioLevel(0);
    setDuration(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const updateLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.fftSize);
    analyserRef.current.getByteTimeDomainData(data);
    // RMS level
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    setAudioLevel(Math.min(1, rms * 3)); // Amplify for visual feedback
    animFrameRef.current = requestAnimationFrame(updateLevel);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up audio analysis
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start level metering
      animFrameRef.current = requestAnimationFrame(updateLevel);

      // Set up MediaRecorder
      const mimeType = getSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (resolveStopRef.current) {
          resolveStopRef.current(blob);
          resolveStopRef.current = null;
        }
        cleanup();
        setIsRecording(false);
      };

      recorder.onerror = () => {
        setError("Recording failed");
        if (resolveStopRef.current) {
          resolveStopRef.current(null);
          resolveStopRef.current = null;
        }
        cleanup();
        setIsRecording(false);
      };

      recorder.start(100); // Collect data every 100ms
      setIsRecording(true);

      // Duration timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setDuration((Date.now() - startTime) / 1000);
      }, 100);
    } catch (err) {
      cleanup();
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied"
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "No microphone found"
            : "Failed to start recording";
      setError(msg);
    }
  }, [cleanup, updateLevel]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return null;
    }
    return new Promise<Blob | null>((resolve) => {
      resolveStopRef.current = resolve;
      mediaRecorderRef.current!.stop();
    });
  }, []);

  return {
    isRecording,
    duration,
    audioLevel,
    error,
    startRecording,
    stopRecording,
  };
}
