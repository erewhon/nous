/**
 * WebCollabProvider — Yjs collaboration provider for the web viewer.
 *
 * Simplified port of the desktop CollabProvider.ts.
 * Creates Y.Doc with Y.XmlFragment("document-store") for BlockNote native
 * collaboration, connects to party.nous.page via YPartyKitProvider.
 */

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import type { BlockNoteEditorOptions } from "@blocknote/core";

/** Extract CollaborationOptions from BlockNoteEditorOptions */
export type CollaborationOptions = NonNullable<
  BlockNoteEditorOptions<any, any, any>["collaboration"]
>;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  reconnectAttempts: number;
  isReconnecting: boolean;
  isExpired: boolean;
}

export interface WebCollabProviderOptions {
  host: string;
  roomId: string;
  token: string;
  party: string;
  user: { name: string; color: string };
  onStatusChange?: (state: ConnectionState) => void;
  onParticipantsChange?: (count: number) => void;
  onSynced?: () => void;
}

export class WebCollabProvider {
  readonly doc: Y.Doc;
  readonly provider: YPartyKitProvider;
  readonly fragment: Y.XmlFragment;

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

  constructor(options: WebCollabProviderOptions) {
    this.onStatusChange = options.onStatusChange;
    this.onParticipantsChange = options.onParticipantsChange;

    this.doc = new Y.Doc();
    this.fragment = this.doc.getXmlFragment("document-store");

    this.provider = new YPartyKitProvider(
      options.host,
      options.roomId,
      this.doc,
      {
        party: options.party,
        params: { token: options.token },
        connect: true,
        maxBackoffTime: 30000,
      },
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
        if (!this.connectionState.isExpired) {
          this.connectionState = {
            ...this.connectionState,
            status: "disconnected",
            reconnectAttempts: this.connectionState.reconnectAttempts + 1,
            isReconnecting: true,
          };
        }
      } else {
        this.connectionState = { ...this.connectionState, status };
      }
      this.onStatusChange?.(this.connectionState);
    });

    // Token expiry detection
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
        this.provider.disconnect();
      }
    });

    // Participant tracking
    this.provider.awareness.on("change", () => {
      if (this.disposed) return;
      const states = this.provider.awareness.getStates();
      this.onParticipantsChange?.(states.size);
    });

    // Set local awareness
    this.provider.awareness.setLocalState({ user: options.user });

    // Track initial sync
    const handleSynced = () => {
      if (this.disposed || this._isSynced) return;
      this._isSynced = true;
      options.onSynced?.();
    };
    this.provider.on("sync", handleSynced);
    if (this.provider.synced) handleSynced();
  }

  getCollaborationOptions(): CollaborationOptions {
    return {
      fragment: this.fragment,
      user: this.provider.awareness.getLocalState()?.user ?? {
        name: "Web User",
        color: "#3b82f6",
      },
      provider: { awareness: this.provider.awareness },
      showCursorLabels: "activity",
    };
  }

  get isSynced(): boolean {
    return this._isSynced;
  }

  get status(): ConnectionStatus {
    if (this.provider.wsconnected) return "connected";
    if (this.provider.wsconnecting) return "connecting";
    return "disconnected";
  }

  get participantCount(): number {
    return this.provider.awareness.getStates().size;
  }

  getParticipants(): Array<{ name: string; color: string; clientId: number }> {
    const participants: Array<{
      name: string;
      color: string;
      clientId: number;
    }> = [];
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

  destroy(): void {
    this.disposed = true;
    this.provider.awareness.setLocalState(null);
    this.provider.disconnect();
    this.provider.destroy();
    this.doc.destroy();
  }
}
