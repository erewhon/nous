/**
 * CollabProvider — simplified collaboration provider using BlockNote's native
 * Yjs collaboration via y-prosemirror.
 *
 * Replaces the old CollabBridge which manually diffed Editor.js blocks.
 * BlockNote handles character-level CRDT, cursor awareness, and undo/redo
 * natively through its CollaborationExtension.
 *
 * The Yjs doc uses a Y.XmlFragment("document-store") for ProseMirror state,
 * plus a Y.Map("attribution") for tracking per-block edit attribution.
 */

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import type { BlockNoteEditorOptions } from "@blocknote/core";

/** Extract CollaborationOptions from BlockNoteEditorOptions (not directly exported) */
export type CollaborationOptions = NonNullable<BlockNoteEditorOptions<any, any, any>["collaboration"]>;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  reconnectAttempts: number;
  isReconnecting: boolean;
  /** True if disconnected due to token expiry (close code 4003) */
  isExpired: boolean;
}

export interface CollabProviderOptions {
  /** PartyKit host (e.g., "party.nous.page") */
  host: string;
  /** Room ID for this collaboration session */
  roomId: string;
  /** Authentication token */
  token: string;
  /** User info for awareness */
  user: { name: string; color: string };
  /** Called when connection status changes */
  onStatusChange?: (state: ConnectionState) => void;
  /** Called when participant count changes */
  onParticipantsChange?: (count: number) => void;
  /** Called when initial Yjs sync with server completes */
  onSynced?: () => void;
}

export class CollabProvider {
  readonly doc: Y.Doc;
  readonly provider: YPartyKitProvider;
  readonly fragment: Y.XmlFragment;
  readonly attributionMap: Y.Map<{ name: string; color: string; timestamp: number }>;

  private disposed = false;
  private _isSynced = false;
  private connectionState: ConnectionState = {
    status: "connecting",
    reconnectAttempts: 0,
    isReconnecting: false,
    isExpired: false,
  };
  private onStatusChange?: (state: ConnectionState) => void;
  private onParticipantsChange?: (count: number) => void;

  constructor(options: CollabProviderOptions) {
    this.onStatusChange = options.onStatusChange;
    this.onParticipantsChange = options.onParticipantsChange;

    // Create Yjs doc with XmlFragment for ProseMirror (BlockNote native)
    this.doc = new Y.Doc();
    this.fragment = this.doc.getXmlFragment("document-store");
    this.attributionMap = this.doc.getMap("attribution");

    // Connect to PartyKit
    this.provider = new YPartyKitProvider(
      options.host,
      options.roomId,
      this.doc,
      {
        party: "collab-server",
        params: { token: options.token },
        connect: true,
      }
    );

    // Status events
    this.provider.on("status", (event: { status: string }) => {
      if (this.disposed) return;
      const status = event.status as ConnectionStatus;

      if (status === "connected") {
        this.connectionState = {
          status: "connected",
          reconnectAttempts: 0,
          isReconnecting: false,
          isExpired: false,
        };
      } else if (status === "disconnected") {
        // Don't increment reconnect attempts if expired
        if (!this.connectionState.isExpired) {
          this.connectionState = {
            ...this.connectionState,
            status: "disconnected",
            reconnectAttempts: this.connectionState.reconnectAttempts + 1,
            isReconnecting: true,
          };
        }
      } else {
        this.connectionState = {
          ...this.connectionState,
          status,
        };
      }
      this.onStatusChange?.(this.connectionState);
    });

    // Detect token expiry via WebSocket close code
    this.provider.on("connection-close", (event: CloseEvent) => {
      if (this.disposed) return;
      if (event.code === 4003) {
        this.connectionState = {
          status: "disconnected",
          reconnectAttempts: 0,
          isReconnecting: false,
          isExpired: true,
        };
        this.onStatusChange?.(this.connectionState);
        // Stop auto-reconnect for expired tokens
        this.provider.disconnect();
      }
    });

    // Awareness (participant tracking)
    this.provider.awareness.on("change", () => {
      if (this.disposed) return;
      const states = this.provider.awareness.getStates();
      this.onParticipantsChange?.(states.size);
    });

    // Set local awareness state
    this.provider.awareness.setLocalState({
      user: options.user,
    });

    // Track initial sync completion
    const handleSynced = () => {
      if (this.disposed || this._isSynced) return;
      this._isSynced = true;
      options.onSynced?.();
    };
    this.provider.on("sync", handleSynced);
    // Fallback: if already synced by the time we check
    if (this.provider.synced) {
      handleSynced();
    }
  }

  /**
   * Build CollaborationOptions for BlockNote's useCreateBlockNote.
   */
  getCollaborationOptions(): CollaborationOptions {
    return {
      fragment: this.fragment,
      user: this.provider.awareness.getLocalState()?.user ?? {
        name: "Unknown",
        color: "#888888",
      },
      provider: { awareness: this.provider.awareness },
      showCursorLabels: "activity",
    };
  }

  /**
   * Whether initial Yjs sync with server has completed.
   */
  get isSynced(): boolean {
    return this._isSynced;
  }

  /**
   * Get current connection state.
   */
  get connectionInfo(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get simple connection status.
   */
  get status(): ConnectionStatus {
    if (this.provider.wsconnected) return "connected";
    if (this.provider.wsconnecting) return "connecting";
    return "disconnected";
  }

  /**
   * Get current participant count.
   */
  get participantCount(): number {
    return this.provider.awareness.getStates().size;
  }

  /**
   * Get participant list from awareness states.
   */
  getParticipants(): Array<{ name: string; color: string; clientId: number }> {
    const participants: Array<{ name: string; color: string; clientId: number }> = [];
    this.provider.awareness.getStates().forEach((state, clientId) => {
      if (state.user) {
        participants.push({
          name: state.user.name,
          color: state.user.color,
          clientId,
        });
      }
    });
    return participants;
  }

  /**
   * Manually reconnect (useful after multiple failed attempts).
   */
  reconnect(): void {
    if (this.connectionState.isExpired) return;
    this.connectionState = {
      ...this.connectionState,
      reconnectAttempts: 0,
      isReconnecting: true,
    };
    this.provider.connect();
    this.onStatusChange?.(this.connectionState);
  }

  /**
   * Update attribution for a block.
   */
  setBlockAttribution(blockId: string, user: { name: string; color: string }): void {
    this.attributionMap.set(blockId, {
      name: user.name,
      color: user.color,
      timestamp: Date.now(),
    });
  }

  /**
   * Get attribution for a block.
   */
  getBlockAttribution(blockId: string): { name: string; color: string; timestamp: number } | undefined {
    return this.attributionMap.get(blockId);
  }

  /**
   * Clean up: disconnect provider, destroy doc.
   */
  destroy(): void {
    this.disposed = true;
    this.provider.awareness.setLocalState(null);
    this.provider.disconnect();
    this.provider.destroy();
    this.doc.destroy();
  }
}
