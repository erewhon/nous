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

interface OpenPaneRecord {
  notebookId: string;
  pageId: string;
  paneId: string;
}

class DaemonEventBus {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private apiKey: string | null | undefined = undefined;
  // Pane registrations the editor has asked us to maintain on the daemon.
  // Keyed by `${pageId}:${paneId}`. Re-sent on reconnect so daemon's
  // auto-cleanup-on-disconnect doesn't strand the editor's panes.
  private openPanes = new Map<string, OpenPaneRecord>();

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

    console.log("[daemon-events] Connecting to", url.replace(/token=[^&]+/, "token=***"));

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
      // Re-register any open panes. The daemon auto-closes panes on WS
      // disconnect, so after a reconnect the editor needs them re-opened.
      for (const rec of this.openPanes.values()) {
        this.sendRaw({
          type: "pane_open",
          notebookId: rec.notebookId,
          pageId: rec.pageId,
          paneId: rec.paneId,
        });
      }
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

    this.socket.onclose = (evt) => {
      console.warn(`[daemon-events] Closed (code=${evt.code}, reason=${evt.reason || "(none)"})`);
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

  /// Send a raw JSON message to the daemon. Drops if the socket is not
  /// currently open — callers that need at-least-once delivery should track
  /// their state themselves (e.g. paneOpen below).
  private sendRaw(message: object): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (err) {
        console.warn("[daemon-events] send failed:", err);
      }
    } else {
      console.debug("[daemon-events] send skipped (socket not open)");
    }
  }

  /// Register a pane as having opened a page. Recorded locally so we can
  /// replay on reconnect. Idempotent — calling twice with the same key is a
  /// no-op on the daemon side (the CRDT store updates the pane base).
  paneOpen(notebookId: string, pageId: string, paneId: string): void {
    const key = `${pageId}:${paneId}`;
    this.openPanes.set(key, { notebookId, pageId, paneId });
    this.sendRaw({ type: "pane_open", notebookId, pageId, paneId });
  }

  /// Drop a pane registration. The daemon close_pane is idempotent, so a
  /// fire-and-forget here is safe even if the socket is currently down.
  paneClose(pageId: string, paneId: string): void {
    const key = `${pageId}:${paneId}`;
    this.openPanes.delete(key);
    this.sendRaw({ type: "pane_close", pageId, paneId });
  }
}

export const daemonEventBus = new DaemonEventBus();

// Convenience exports for the common pane-lifecycle pattern. Importers can
// either call these or grab the bus directly.
export function paneOpen(
  notebookId: string,
  pageId: string,
  paneId: string
): void {
  daemonEventBus.paneOpen(notebookId, pageId, paneId);
}

export function paneClose(pageId: string, paneId: string): void {
  daemonEventBus.paneClose(pageId, paneId);
}
