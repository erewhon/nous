/**
 * WindowContext
 *
 * Provides library context for the current window.
 * Each window can display a different library based on URL parameter.
 */

import { createContext, useContext, ReactNode } from "react";
import { useWindowContext, type WindowContext } from "../hooks/useWindowContext";
import { LoadingSpinner } from "../components/Loading";

const WindowLibraryContext = createContext<WindowContext | null>(null);

interface WindowContextProviderProps {
  children: ReactNode;
}

/**
 * Provider component that wraps the app with window-specific library context.
 *
 * Shows a loading state while the library is being loaded.
 * Shows an error message if the library fails to load.
 */
export function WindowContextProvider({ children }: WindowContextProviderProps) {
  const context = useWindowContext();

  // Show loading state
  if (context.isLoading) {
    return (
      <div
        className="flex h-screen w-full items-center justify-center"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Show error state
  if (context.error || !context.library) {
    return (
      <div
        className="flex h-screen w-full flex-col items-center justify-center gap-4"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
        }}
      >
        <div className="text-4xl">:(</div>
        <div className="text-lg">Failed to load library</div>
        <div
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {context.error || "Library not found"}
        </div>
        {context.isSecondaryWindow && (
          <button
            onClick={() => window.close()}
            className="mt-4 rounded-md px-4 py-2 text-sm transition-colors"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-primary)",
            }}
          >
            Close Window
          </button>
        )}
      </div>
    );
  }

  return (
    <WindowLibraryContext.Provider value={context}>
      {children}
    </WindowLibraryContext.Provider>
  );
}

/**
 * Hook to access the window's library context.
 *
 * Must be used within a WindowContextProvider.
 */
export function useWindowLibrary(): WindowContext {
  const context = useContext(WindowLibraryContext);

  if (!context) {
    throw new Error("useWindowLibrary must be used within a WindowContextProvider");
  }

  return context;
}
