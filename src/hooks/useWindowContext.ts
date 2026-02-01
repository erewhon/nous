/**
 * useWindowContext hook
 *
 * Reads library ID from URL query parameter (?library=<id>).
 * Used for multi-window support where each window can display a different library.
 */

import { useState, useEffect, useMemo } from "react";
import type { Library } from "../types/library";
import * as api from "../utils/api";

export interface WindowContext {
  /** Library ID from URL, or null if using current library */
  libraryId: string | null;
  /** The library object (loaded from ID) */
  library: Library | null;
  /** Whether the library is being loaded */
  isLoading: boolean;
  /** Any error that occurred during loading */
  error: string | null;
  /** Whether this window is a secondary library window (has library in URL) */
  isSecondaryWindow: boolean;
}

/**
 * Parse the library ID from the current URL query parameters
 */
function getLibraryIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  return params.get("library");
}

/**
 * Hook to get the window's library context.
 *
 * - If ?library=<id> is in URL, switches the backend to that library and loads it
 * - Otherwise, uses the current library from backend
 */
export function useWindowContext(): WindowContext {
  const [library, setLibrary] = useState<Library | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get library ID from URL - this is stable across renders
  const libraryId = useMemo(() => getLibraryIdFromUrl(), []);
  const isSecondaryWindow = libraryId !== null;

  useEffect(() => {
    async function loadLibrary() {
      setIsLoading(true);
      setError(null);

      try {
        if (libraryId) {
          // For secondary windows, switch the backend to use this library
          // This ensures all subsequent API calls use the correct library
          const lib = await api.switchLibrary(libraryId);
          setLibrary(lib);
        } else {
          // Load current library (for main window)
          const lib = await api.getCurrentLibrary();
          setLibrary(lib);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load library";
        setError(message);
        console.error("Failed to load library:", e);
      } finally {
        setIsLoading(false);
      }
    }

    loadLibrary();
  }, [libraryId]);

  return {
    libraryId,
    library,
    isLoading,
    error,
    isSecondaryWindow,
  };
}
