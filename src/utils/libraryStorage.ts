/**
 * Library-scoped localStorage helpers.
 *
 * Reads the persisted library ID from the Zustand "nous-library" key
 * and produces scoped storage keys like "nous-ai-settings:abc123".
 *
 * Also handles one-time migration: if a scoped key doesn't exist but the
 * old global key does, the global value is copied to the scoped key.
 */

const LIBRARY_STORE_KEY = "nous-library";

/**
 * Synchronously read the current library ID from localStorage.
 * Returns "default" if nothing is persisted yet.
 */
export function getPersistedLibraryId(): string {
  try {
    const raw = localStorage.getItem(LIBRARY_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const id = parsed?.state?.currentLibraryId;
      if (typeof id === "string" && id.length > 0) {
        return id;
      }
    }
  } catch {
    // Corrupt or missing — fall through
  }
  return "default";
}

/**
 * Return a library-scoped localStorage key.
 *
 * On first call (scoped key absent), migrates from the global key so
 * existing settings are preserved.
 */
export function libraryScopedKey(baseKey: string): string {
  const libraryId = getPersistedLibraryId();
  const scopedKey = `${baseKey}:${libraryId}`;

  // One-time migration: copy global → scoped if scoped doesn't exist yet
  if (localStorage.getItem(scopedKey) === null) {
    const globalValue = localStorage.getItem(baseKey);
    if (globalValue !== null) {
      localStorage.setItem(scopedKey, globalValue);
    }
  }

  return scopedKey;
}
