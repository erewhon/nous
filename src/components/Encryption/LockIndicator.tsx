/**
 * LockIndicator - Visual indicator for encrypted items
 */

function IconLock({ size = 14 }: { size?: number }) {
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

function IconUnlock({ size = 14 }: { size?: number }) {
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

interface LockIndicatorProps {
  isEncrypted: boolean;
  isUnlocked: boolean;
  size?: number;
  showLabel?: boolean;
  className?: string;
}

export function LockIndicator({
  isEncrypted,
  isUnlocked,
  size = 14,
  showLabel = false,
  className = "",
}: LockIndicatorProps) {
  if (!isEncrypted) return null;

  const color = isUnlocked
    ? "var(--color-success)"
    : "var(--color-warning)";
  const label = isUnlocked ? "Unlocked" : "Locked";

  return (
    <div
      className={`flex items-center gap-1 ${className}`}
      title={label}
      style={{ color }}
    >
      {isUnlocked ? <IconUnlock size={size} /> : <IconLock size={size} />}
      {showLabel && (
        <span className="text-xs">
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * EncryptedBadge - Badge showing encryption status
 */
interface EncryptedBadgeProps {
  isUnlocked: boolean;
  className?: string;
}

export function EncryptedBadge({
  isUnlocked,
  className = "",
}: EncryptedBadgeProps) {
  const color = isUnlocked ? "var(--color-success)" : "var(--color-warning)";
  const bgColor = isUnlocked
    ? "color-mix(in srgb, var(--color-success) 15%, transparent)"
    : "color-mix(in srgb, var(--color-warning) 15%, transparent)";
  const label = isUnlocked ? "Unlocked" : "Locked";

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        backgroundColor: bgColor,
        color,
      }}
    >
      {isUnlocked ? <IconUnlock size={12} /> : <IconLock size={12} />}
      {label}
    </div>
  );
}

/**
 * EncryptionOverlay - Overlay shown when notebook is locked
 */
interface EncryptionOverlayProps {
  onUnlock: () => void;
  hint?: string | null;
}

export function EncryptionOverlay({
  onUnlock,
  hint,
}: EncryptionOverlayProps) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center p-8"
      style={{
        backgroundColor: "var(--color-bg-primary)",
      }}
    >
      <div
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-warning)" }}
      >
        <IconLock size={40} />
      </div>
      <h2
        className="mb-2 text-xl font-semibold"
        style={{ color: "var(--color-text-primary)" }}
      >
        This notebook is locked
      </h2>
      <p
        className="mb-6 max-w-md text-center text-sm"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Enter your password to access the encrypted content.
      </p>
      {hint && (
        <p
          className="mb-6 max-w-md rounded-lg p-3 text-center text-sm"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span className="font-medium">Hint:</span> {hint}
        </p>
      )}
      <button
        onClick={onUnlock}
        className="flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium transition-colors"
        style={{
          backgroundColor: "var(--color-accent)",
          color: "white",
        }}
      >
        <IconUnlock size={18} />
        Unlock Notebook
      </button>
    </div>
  );
}
