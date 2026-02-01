/**
 * UnlockDialog - Password entry modal for encrypted notebooks/libraries
 */

import { useState, useEffect, useRef, useId } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useEncryptionStore } from "../../stores/encryptionStore";

function IconLock({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconEye({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function IconAlertCircle({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

interface UnlockDialogProps {
  isOpen: boolean;
  type: "notebook" | "library";
  id: string;
  name: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function UnlockDialog({
  isOpen,
  type,
  id,
  name,
  onSuccess,
  onCancel,
}: UnlockDialogProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const focusTrapRef = useFocusTrap(isOpen);
  const titleId = useId();
  const descriptionId = useId();

  const {
    unlockNotebook,
    unlockLibrary,
    getNotebookPasswordHint,
    getLibraryPasswordHint,
    error: storeError,
    clearError,
  } = useEncryptionStore();

  // Load password hint
  useEffect(() => {
    if (isOpen && id) {
      const loadHint = async () => {
        const h =
          type === "notebook"
            ? await getNotebookPasswordHint(id)
            : await getLibraryPasswordHint(id);
        setHint(h);
      };
      loadHint();
    }
  }, [isOpen, id, type, getNotebookPasswordHint, getLibraryPasswordHint]);

  // Focus password input when dialog opens
  useEffect(() => {
    if (isOpen && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
    // Clear state when dialog opens
    if (isOpen) {
      setPassword("");
      setError(null);
      clearError();
    }
  }, [isOpen, clearError]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Password is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const success =
        type === "notebook"
          ? await unlockNotebook(id, password)
          : await unlockLibrary(id, password);

      if (success) {
        onSuccess();
      } else {
        setError("Invalid password");
      }
    } catch {
      setError("Failed to unlock");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <span style={{ color: "var(--color-accent)" }}>
              <IconLock size={24} />
            </span>
          </div>
          <div>
            <h2
              id={titleId}
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Unlock {type === "notebook" ? "Notebook" : "Library"}
            </h2>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {name}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <p
            id={descriptionId}
            className="mb-4 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Enter your password to access this encrypted {type}.
          </p>

          <div className="mb-4">
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Password
            </label>
            <div className="relative">
              <input
                ref={passwordInputRef}
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 pr-10 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: error ? "var(--color-error)" : "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                placeholder="Enter password"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {showPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </div>
          </div>

          {hint && (
            <div
              className="mb-4 rounded-lg p-3 text-sm"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              <span className="font-medium">Hint:</span> {hint}
            </div>
          )}

          {(error || storeError) && (
            <div
              className="mb-4 flex items-center gap-2 rounded-lg p-3 text-sm"
              style={{
                backgroundColor: "color-mix(in srgb, var(--color-error) 10%, transparent)",
                color: "var(--color-error)",
              }}
            >
              <IconAlertCircle size={16} />
              {error || storeError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
                opacity: isLoading ? 0.7 : 1,
              }}
              disabled={isLoading}
            >
              {isLoading ? "Unlocking..." : "Unlock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
