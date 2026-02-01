import { useState, useEffect, useCallback, useRef } from "react";
import type { Page } from "../types/page";
import * as api from "../utils/api";

interface UseLinkedFileSyncOptions {
  /** Check interval in milliseconds (default: 5000) */
  checkInterval?: number;
  /** Whether to check on window focus (default: true) */
  checkOnFocus?: boolean;
  /** Whether sync checking is enabled (default: true) */
  enabled?: boolean;
}

interface UseLinkedFileSyncResult {
  /** Whether the linked file has been modified externally */
  isModified: boolean;
  /** Whether we're currently checking for modifications */
  isChecking: boolean;
  /** Error message if check failed */
  error: string | null;
  /** Manually trigger a check */
  checkNow: () => Promise<void>;
  /** Dismiss the modification notification */
  dismiss: () => void;
  /** Mark as synced (after reload) */
  markSynced: () => void;
}

/**
 * Hook to detect when a linked file has been modified externally.
 * Only active for pages with storageMode === "linked".
 */
export function useLinkedFileSync(
  page: Page | null | undefined,
  notebookId: string | null,
  options: UseLinkedFileSyncOptions = {}
): UseLinkedFileSyncResult {
  const {
    checkInterval = 5000,
    checkOnFocus = true,
    enabled = true,
  } = options;

  const [isModified, setIsModified] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissedRef = useRef(false);
  const lastCheckRef = useRef<number>(0);

  const isLinkedFile = page?.storageMode === "linked";

  const checkNow = useCallback(async () => {
    if (!page || !notebookId || !isLinkedFile || !enabled) {
      return;
    }

    // Throttle checks to avoid excessive API calls
    const now = Date.now();
    if (now - lastCheckRef.current < 1000) {
      return;
    }
    lastCheckRef.current = now;

    setIsChecking(true);
    setError(null);

    try {
      const modified = await api.checkLinkedFileModified(notebookId, page.id);
      if (modified && !dismissedRef.current) {
        setIsModified(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check file";
      setError(message);
      console.warn("Failed to check linked file:", message);
    } finally {
      setIsChecking(false);
    }
  }, [page, notebookId, isLinkedFile, enabled]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setIsModified(false);
  }, []);

  const markSynced = useCallback(() => {
    dismissedRef.current = false;
    setIsModified(false);
  }, []);

  // Reset state when page changes
  useEffect(() => {
    dismissedRef.current = false;
    setIsModified(false);
    setError(null);
  }, [page?.id]);

  // Periodic check
  useEffect(() => {
    if (!isLinkedFile || !enabled) {
      return;
    }

    // Initial check
    checkNow();

    // Set up interval
    const intervalId = setInterval(checkNow, checkInterval);

    return () => clearInterval(intervalId);
  }, [isLinkedFile, enabled, checkInterval, checkNow]);

  // Check on window focus
  useEffect(() => {
    if (!isLinkedFile || !enabled || !checkOnFocus) {
      return;
    }

    const handleFocus = () => {
      checkNow();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [isLinkedFile, enabled, checkOnFocus, checkNow]);

  return {
    isModified,
    isChecking,
    error,
    checkNow,
    dismiss,
    markSynced,
  };
}
