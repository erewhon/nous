import { useToastStore, type Toast, type ToastType } from "../../stores/toastStore";

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: "rgba(34, 197, 94, 0.15)",
    border: "rgba(34, 197, 94, 0.3)",
    icon: "rgb(34, 197, 94)",
  },
  error: {
    bg: "rgba(239, 68, 68, 0.15)",
    border: "rgba(239, 68, 68, 0.3)",
    icon: "rgb(239, 68, 68)",
  },
  warning: {
    bg: "rgba(245, 158, 11, 0.15)",
    border: "rgba(245, 158, 11, 0.3)",
    icon: "rgb(245, 158, 11)",
  },
  info: {
    bg: "rgba(59, 130, 246, 0.15)",
    border: "rgba(59, 130, 246, 0.3)",
    icon: "rgb(59, 130, 246)",
  },
};

function ToastIcon({ type }: { type: ToastType }) {
  const color = TOAST_STYLES[type].icon;

  switch (type) {
    case "success":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case "error":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case "warning":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "info":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((state) => state.removeToast);
  const styles = TOAST_STYLES[toast.type];

  return (
    <div
      className="flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg animate-slide-in"
      style={{
        backgroundColor: styles.bg,
        border: `1px solid ${styles.border}`,
        minWidth: "280px",
        maxWidth: "400px",
      }}
      role="alert"
      aria-live="polite"
    >
      <div className="flex-shrink-0 mt-0.5">
        <ToastIcon type={toast.type} />
      </div>
      <p
        className="flex-1 text-sm"
        style={{ color: "var(--color-text-primary)" }}
      >
        {toast.message}
      </p>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            removeToast(toast.id);
          }}
          className="flex-shrink-0 rounded px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80"
          style={{
            backgroundColor: TOAST_STYLES[toast.type].icon,
            color: "#fff",
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => removeToast(toast.id)}
        className="flex-shrink-0 p-1 rounded hover:opacity-70 transition-opacity"
        style={{ color: "var(--color-text-muted)" }}
        aria-label="Dismiss"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
