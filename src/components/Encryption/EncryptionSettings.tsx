/**
 * EncryptionSettings - Component for managing encryption settings in a notebook or library
 */

import { useState } from "react";
import { useEncryptionStore } from "../../stores/encryptionStore";
import type { EncryptionConfig } from "../../types/encryption";

function IconLock({ size = 16 }: { size?: number }) {
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

function IconUnlock({ size = 16 }: { size?: number }) {
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
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function IconKey({ size = 16 }: { size?: number }) {
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
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

function IconShieldCheck({ size = 24 }: { size?: number }) {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconShieldAlert({ size = 24 }: { size?: number }) {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

interface EncryptionSettingsProps {
  type: "notebook" | "library";
  id: string;
  name: string;
  encryptionConfig?: EncryptionConfig;
  onConfigChange?: () => void;
}

export function EncryptionSettings({
  type,
  id,
  name: _name,
  encryptionConfig,
  onConfigChange,
}: EncryptionSettingsProps) {
  const [isEnabling, setIsEnabling] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    enableNotebookEncryption,
    disableNotebookEncryption,
    enableLibraryEncryption,
    disableLibraryEncryption,
    isNotebookUnlocked,
    isLibraryUnlocked,
  } = useEncryptionStore();

  const isEncrypted = encryptionConfig?.enabled ?? false;
  const isUnlocked =
    type === "notebook" ? isNotebookUnlocked(id) : isLibraryUnlocked(id);

  const handleEnableEncryption = async () => {
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (type === "notebook") {
        await enableNotebookEncryption(id, password, hint || undefined);
      } else {
        await enableLibraryEncryption(id, password, hint || undefined);
      }
      setIsEnabling(false);
      setPassword("");
      setConfirmPassword("");
      setHint("");
      onConfigChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable encryption");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisableEncryption = async () => {
    if (!password.trim()) {
      setError("Password is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (type === "notebook") {
        await disableNotebookEncryption(id, password);
      } else {
        await disableLibraryEncryption(id, password);
      }
      setIsDisabling(false);
      setPassword("");
      onConfigChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable encryption");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setIsEnabling(false);
    setIsDisabling(false);
    setPassword("");
    setConfirmPassword("");
    setHint("");
    setError(null);
  };

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        backgroundColor: "var(--color-bg-tertiary)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="mb-4 flex items-center gap-3">
        {isEncrypted ? (
          <span style={{ color: "var(--color-success)" }}><IconShieldCheck size={24} /></span>
        ) : (
          <span style={{ color: "var(--color-text-tertiary)" }}><IconShieldAlert size={24} /></span>
        )}
        <div>
          <h3
            className="font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Encryption
          </h3>
          <p
            className="text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isEncrypted
              ? `This ${type} is encrypted${isUnlocked ? " (unlocked)" : " (locked)"}`
              : `This ${type} is not encrypted`}
          </p>
        </div>
      </div>

      {!isEnabling && !isDisabling && (
        <div className="flex gap-2">
          {isEncrypted ? (
            <button
              onClick={() => setIsDisabling(true)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-error)",
              }}
            >
              <IconUnlock size={16} />
              Disable Encryption
            </button>
          ) : (
            <button
              onClick={() => setIsEnabling(true)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              <IconLock size={16} />
              Enable Encryption
            </button>
          )}
        </div>
      )}

      {isEnabling && (
        <div className="space-y-4">
          <p
            className="text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            All content in this {type} will be encrypted with a password. Make sure to remember your password - there is no way to recover it.
          </p>

          <div>
            <label
              htmlFor="new-password"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Password
            </label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              placeholder="Enter password (min 8 characters)"
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Confirm Password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              placeholder="Confirm password"
            />
          </div>

          <div>
            <label
              htmlFor="password-hint"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Password Hint (optional)
            </label>
            <input
              id="password-hint"
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              placeholder="A hint to help you remember"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--color-error)" }}>
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleEnableEncryption}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              <IconKey size={16} />
              {isLoading ? "Encrypting..." : "Enable Encryption"}
            </button>
            <button
              onClick={resetForm}
              disabled={isLoading}
              className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isDisabling && (
        <div className="space-y-4">
          <p
            className="text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Enter your password to disable encryption. All content will be decrypted and stored in plain text.
          </p>

          <div>
            <label
              htmlFor="current-password"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Current Password
            </label>
            <input
              id="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              placeholder="Enter current password"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--color-error)" }}>
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleDisableEncryption}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-error)",
                color: "white",
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              <IconUnlock size={16} />
              {isLoading ? "Decrypting..." : "Disable Encryption"}
            </button>
            <button
              onClick={resetForm}
              disabled={isLoading}
              className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
