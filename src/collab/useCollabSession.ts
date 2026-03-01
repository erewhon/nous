/**
 * React hook wrapping the collab session lifecycle.
 *
 * - startSession() → creates session via Tauri, instantiates CollabBridge
 * - stopSession() → destroys bridge, stops session via Tauri
 * - Exposes: isActive, status, shareUrl, participants, bridge
 */

import { useState, useRef, useCallback } from "react";
import { CollabBridge } from "./CollabBridge";
import * as api from "./api";
import type { EditorData } from "../types/page";

export type CollabStatus = "idle" | "starting" | "connected" | "connecting" | "disconnected" | "error";

export interface CollabSessionState {
  isActive: boolean;
  status: CollabStatus;
  shareUrl: string | null;
  sessionId: string | null;
  participants: number;
  error: string | null;
  bridge: CollabBridge | null;
  startSession: (
    notebookId: string,
    pageId: string,
    initialData: EditorData,
    onRemoteChange: (data: EditorData) => void,
    expiry?: string
  ) => Promise<void>;
  stopSession: () => Promise<void>;
}

export function useCollabSession(): CollabSessionState {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<CollabStatus>("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const bridgeRef = useRef<CollabBridge | null>(null);

  const startSession = useCallback(
    async (
      notebookId: string,
      pageId: string,
      initialData: EditorData,
      onRemoteChange: (data: EditorData) => void,
      expiry: string = "8h"
    ) => {
      try {
        setStatus("starting");
        setError(null);

        // Create session via Tauri backend
        const response = await api.startCollabSession(notebookId, pageId, expiry);

        // Create the CollabBridge
        const bridge = new CollabBridge({
          host: response.partykitHost,
          roomId: response.roomId,
          token: response.token,
          initialData,
          onRemoteChange,
          onStatusChange: (s) => {
            setStatus(s);
          },
          onParticipantsChange: (count) => {
            setParticipants(count);
          },
        });

        bridgeRef.current = bridge;
        setSessionId(response.session.id);
        setShareUrl(response.session.shareUrl);
        setIsActive(true);
        setStatus("connecting");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    []
  );

  const stopSession = useCallback(async () => {
    // Destroy bridge
    if (bridgeRef.current) {
      bridgeRef.current.destroy();
      bridgeRef.current = null;
    }

    // Stop session on backend
    if (sessionId) {
      try {
        await api.stopCollabSession(sessionId);
      } catch (err) {
        console.warn("Failed to stop collab session:", err);
      }
    }

    setIsActive(false);
    setStatus("idle");
    setShareUrl(null);
    setSessionId(null);
    setParticipants(0);
    setError(null);
  }, [sessionId]);

  return {
    isActive,
    status,
    shareUrl,
    sessionId,
    participants,
    error,
    bridge: bridgeRef.current,
    startSession,
    stopSession,
  };
}
