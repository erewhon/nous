// WebSocket client for daemon event stream.
//
// Connects to ws://localhost:7667/api/events and dispatches events to registered
// listeners. Handles reconnection with exponential backoff.

import { invoke } from "@tauri-apps/api/core";

const DAEMON_WS_URL = "ws://localhost:7667/api/events";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export interface DaemonEvent {
  event: string;
  data: Record<string, unknown>;
}

type Listener = (event: DaemonEvent) => void;

class DaemonEventBus {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private apiKey: string | null | undefined = undefined;

  async start() {
    if (this.socket || this.stopped) return;

    // Load API key if we haven't yet
    if (this.apiKey === undefined) {
      try {
        this.apiKey = await invoke<string | null>("get_daemon_api_key");
      } catch {
        this.apiKey = null;
      }
    }

    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private connect() {
    if (this.stopped) return;

    const url = this.apiKey
      ? `${DAEMON_WS_URL}?token=${encodeURIComponent(this.apiKey)}`
      : DAEMON_WS_URL;

    try {
      this.socket = new WebSocket(url);
    } catch (err) {
      console.warn("[daemon-events] WebSocket creation failed:", err);
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      console.log("[daemon-events] Connected");
      this.reconnectAttempts = 0;
    };

    this.socket.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as DaemonEvent;
        for (const listener of this.listeners) {
          try {
            listener(evt);
          } catch (err) {
            console.warn("[daemon-events] Listener error:", err);
          }
        }
      } catch (err) {
        console.warn("[daemon-events] Failed to parse event:", err);
      }
    };

    this.socket.onerror = (err) => {
      console.warn("[daemon-events] WebSocket error:", err);
    };

    this.socket.onclose = () => {
      this.socket = null;
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;

    console.log(`[daemon-events] Reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export const daemonEventBus = new DaemonEventBus();
