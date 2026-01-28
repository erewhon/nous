/**
 * ChangePasswordDialog - Dialog for changing encryption password
 */

import { useState, useEffect, useRef, useId } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useEncryptionStore } from "../../stores/encryptionStore";

function IconKey({ size = 24 }: { size?: number }) {
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

function IconCheckCircle({ size = 18 }: { size?: number }) {
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
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

interface ChangePasswordDialogProps {
  isOpen: boolean;
  type: "notebook" | "library";
  id: string;
  name: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ChangePasswordDialog({
  isOpen,
  type,
  id,
  name,
  onSuccess,
  onCancel,
}: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hint, setHint] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const focusTrapRef = useFocusTrap(isOpen);
  const titleId = useId();
  const descriptionId = useId();

  const { changeNotebookPassword } = useEncryptionStore();

  // Focus current password input when dialog opens
  useEffect(() => {
    if (isOpen && currentPasswordRef.current) {
      currentPasswordRef.current.focus();
    }
    // Clear state when dialog opens
    if (isOpen) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setHint("");
      setError(null);
    }
  }, [isOpen]);

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

  const validateForm = (): boolean => {
    if (!currentPassword.trim()) {
      setError("Current password is required");
      return false;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return false;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return false;
    }
    if (currentPassword === newPassword) {
      setError("New password must be different from current password");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);
    setError(null);

    try {
      // For now, only notebook password change is implemented
      if (type === "notebook") {
        await changeNotebookPassword(
          id,
          currentPassword,
          newPassword,
          hint || undefined
        );
      }
      // TODO: Add library password change when needed

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  // Password strength indicator
  const getPasswordStrength = (pwd: string): { label: string; color: string } => {
    if (pwd.length === 0) return { label: "", color: "" };
    if (pwd.length < 8) return { label: "Too short", color: "var(--color-error)" };
    if (pwd.length < 12)
      return { label: "Medium", color: "var(--color-warning)" };
    if (pwd.length >= 12 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd))
      return { label: "Strong", color: "var(--color-success)" };
    return { label: "Good", color: "var(--color-success)" };
  };

  const passwordStrength = getPasswordStrength(newPassword);

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
            <span style={{ color: "var(--color-accent)" }}><IconKey size={24} /></span>
          </div>
          <div>
            <h2
              id={titleId}
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Change Password
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
            Enter your current password and choose a new one. All content will be re-encrypted with the new password.
          </p>

          {/* Current Password */}
          <div className="mb-4">
            <label
              htmlFor="current-password"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Current Password
            </label>
            <div className="relative">
              <input
                ref={currentPasswordRef}
                id="current-password"
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 pr-10 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                placeholder="Enter current password"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {showCurrentPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="mb-4">
            <label
              htmlFor="new-password"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              New Password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 pr-10 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                placeholder="Enter new password (min 8 characters)"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {showNewPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </div>
            {passwordStrength.label && (
              <p
                className="mt-1 text-xs"
                style={{ color: passwordStrength.color }}
              >
                {passwordStrength.label}
              </p>
            )}
          </div>

          {/* Confirm New Password */}
          <div className="mb-4">
            <label
              htmlFor="confirm-new-password"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Confirm New Password
            </label>
            <div className="relative">
              <input
                id="confirm-new-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 pr-10 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                placeholder="Confirm new password"
                disabled={isLoading}
              />
              {confirmPassword && newPassword === confirmPassword && (
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--color-success)" }}
                >
                  <IconCheckCircle size={18} />
                </span>
              )}
            </div>
          </div>

          {/* New Password Hint */}
          <div className="mb-4">
            <label
              htmlFor="new-hint"
              className="mb-1 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              New Password Hint (optional)
            </label>
            <input
              id="new-hint"
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              placeholder="A hint to help you remember"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div
              className="mb-4 flex items-center gap-2 rounded-lg p-3 text-sm"
              style={{
                backgroundColor: "color-mix(in srgb, var(--color-error) 10%, transparent)",
                color: "var(--color-error)",
              }}
            >
              <IconAlertCircle size={16} />
              {error}
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
              {isLoading ? "Changing..." : "Change Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
