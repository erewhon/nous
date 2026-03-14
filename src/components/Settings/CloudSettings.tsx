import { useState, useEffect } from "react";
import { useCloudStore } from "../../cloud";

type View = "login" | "register" | "account";

export function CloudSettings() {
  const {
    isAuthenticated,
    email,
    hasEncryptionSetup,
    isLoading,
    error,
    notebooks,
    syncStatus,
    lastSyncAt,
    login,
    register,
    logout,
    setupEncryption,
    unlockEncryption,
    lockEncryption,
    isEncryptionUnlocked,
    loadNotebooks,
    clearError,
  } = useCloudStore();

  const [view, setView] = useState<View>(isAuthenticated ? "account" : "login");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setView(isAuthenticated ? "account" : "login");
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      loadNotebooks();
    }
  }, [isAuthenticated, loadNotebooks]);

  useEffect(() => {
    clearError();
    setLocalError(null);
  }, [view, clearError]);

  const handleLogin = async () => {
    if (!formEmail || !formPassword) {
      setLocalError("Email and password are required");
      return;
    }
    try {
      await login(formEmail, formPassword);
      setFormPassword("");
    } catch {
      // error is set in store
    }
  };

  const handleRegister = async () => {
    if (!formEmail || !formPassword) {
      setLocalError("Email and password are required");
      return;
    }
    if (formPassword.length < 8) {
      setLocalError("Password must be at least 8 characters");
      return;
    }
    try {
      await register(formEmail, formPassword);
      setFormPassword("");
    } catch {
      // error is set in store
    }
  };

  const handleSetupEncryption = async () => {
    if (!masterPassword) {
      setLocalError("Master password is required");
      return;
    }
    if (masterPassword !== confirmMasterPassword) {
      setLocalError("Passwords do not match");
      return;
    }
    if (masterPassword.length < 8) {
      setLocalError("Master password must be at least 8 characters");
      return;
    }
    try {
      await setupEncryption(masterPassword);
      setMasterPassword("");
      setConfirmMasterPassword("");
    } catch {
      // error is set in store
    }
  };

  const handleUnlock = async () => {
    if (!masterPassword) {
      setLocalError("Master password is required");
      return;
    }
    const ok = await unlockEncryption(masterPassword);
    if (ok) {
      setMasterPassword("");
    } else {
      setLocalError("Failed to unlock — check your master password");
    }
  };

  const displayError = localError || error;
  const unlocked = isEncryptionUnlocked();

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text-primary)",
    fontSize: "0.85rem",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 500,
    color: "var(--color-text-secondary)",
    marginBottom: 4,
  };

  const fieldStyle: React.CSSProperties = {
    marginBottom: "0.75rem",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "0.5rem 1rem",
    borderRadius: 6,
    border: "none",
    background: "var(--color-accent)",
    color: "#fff",
    fontSize: "0.85rem",
    fontWeight: 500,
    cursor: "pointer",
    opacity: isLoading ? 0.6 : 1,
  };

  const btnSecondary: React.CSSProperties = {
    padding: "0.5rem 1rem",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text-primary)",
    fontSize: "0.85rem",
    cursor: "pointer",
  };

  const btnDanger: React.CSSProperties = {
    ...btnSecondary,
    borderColor: "var(--color-danger-border)",
    color: "var(--color-danger-text)",
  };

  const cardStyle: React.CSSProperties = {
    padding: "1rem",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-secondary)",
  };

  // ─── Login / Register ──────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <p
          style={{
            fontSize: "0.85rem",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          Sign in to Nous Cloud for encrypted cloud sync across devices.
          Your data is end-to-end encrypted — the server never sees your content.
        </p>

        {displayError && (
          <div
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: 6,
              background: "var(--color-danger-bg)",
              border: "1px solid var(--color-danger-border)",
              color: "var(--color-danger-text)",
              fontSize: "0.8rem",
            }}
          >
            {displayError}
          </div>
        )}

        <div style={fieldStyle}>
          <label style={labelStyle}>Email</label>
          <input
            style={inputStyle}
            type="email"
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={(e) => e.key === "Enter" && (view === "login" ? handleLogin() : handleRegister())}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Password</label>
          <div style={{ position: "relative" }}>
            <input
              style={inputStyle}
              type={showPassword ? "text" : "password"}
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
              placeholder={view === "register" ? "At least 8 characters" : "Your password"}
              onKeyDown={(e) => e.key === "Enter" && (view === "login" ? handleLogin() : handleRegister())}
            />
            <button
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                fontSize: "0.75rem",
              }}
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {view === "login" ? (
            <>
              <button style={btnPrimary} onClick={handleLogin} disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign In"}
              </button>
              <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                No account?{" "}
                <button
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-accent)",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                  onClick={() => setView("register")}
                >
                  Create one
                </button>
              </span>
            </>
          ) : (
            <>
              <button style={btnPrimary} onClick={handleRegister} disabled={isLoading}>
                {isLoading ? "Creating account..." : "Create Account"}
              </button>
              <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                Already have one?{" "}
                <button
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-accent)",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                  onClick={() => setView("login")}
                >
                  Sign in
                </button>
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Account View ──────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Account info */}
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              {email}
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
                marginTop: 2,
              }}
            >
              Nous Cloud
            </div>
          </div>
          <button style={btnDanger} onClick={() => logout()}>
            Sign Out
          </button>
        </div>
      </div>

      {displayError && (
        <div
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: 6,
            background: "var(--color-danger-bg)",
            border: "1px solid var(--color-danger-border)",
            color: "var(--color-danger-text)",
            fontSize: "0.8rem",
          }}
        >
          {displayError}
        </div>
      )}

      {/* Encryption setup / unlock */}
      {!hasEncryptionSetup ? (
        <div style={cardStyle}>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: "var(--color-text-primary)",
              marginBottom: 8,
            }}
          >
            Set Up Encryption
          </div>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--color-text-secondary)",
              margin: "0 0 12px 0",
            }}
          >
            Choose a master password to encrypt your notebooks. This password
            never leaves your device. If you lose it, your cloud data cannot be
            recovered.
          </p>
          <div style={fieldStyle}>
            <label style={labelStyle}>Master Password</label>
            <input
              style={inputStyle}
              type="password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Confirm Master Password</label>
            <input
              style={inputStyle}
              type="password"
              value={confirmMasterPassword}
              onChange={(e) => setConfirmMasterPassword(e.target.value)}
              placeholder="Type it again"
              onKeyDown={(e) => e.key === "Enter" && handleSetupEncryption()}
            />
          </div>
          <button
            style={btnPrimary}
            onClick={handleSetupEncryption}
            disabled={isLoading}
          >
            {isLoading ? "Setting up..." : "Set Up Encryption"}
          </button>
        </div>
      ) : !unlocked ? (
        <div style={cardStyle}>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: "var(--color-text-primary)",
              marginBottom: 8,
            }}
          >
            Unlock Encryption
          </div>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--color-text-secondary)",
              margin: "0 0 12px 0",
            }}
          >
            Enter your master password to unlock cloud sync.
          </p>
          <div style={fieldStyle}>
            <label style={labelStyle}>Master Password</label>
            <input
              style={inputStyle}
              type="password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="Your master password"
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            />
          </div>
          <button style={btnPrimary} onClick={handleUnlock} disabled={isLoading}>
            {isLoading ? "Unlocking..." : "Unlock"}
          </button>
        </div>
      ) : (
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#22c55e",
                }}
              />
              <span
                style={{
                  fontSize: "0.85rem",
                  color: "var(--color-text-primary)",
                }}
              >
                Encryption unlocked
              </span>
            </div>
            <button style={btnSecondary} onClick={lockEncryption}>
              Lock
            </button>
          </div>
        </div>
      )}

      {/* Cloud notebooks */}
      {unlocked && (
        <div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: "var(--color-text-primary)",
              marginBottom: 8,
            }}
          >
            Cloud Notebooks
          </div>
          {notebooks.length === 0 ? (
            <p
              style={{
                fontSize: "0.8rem",
                color: "var(--color-text-muted)",
                margin: 0,
              }}
            >
              No notebooks synced to the cloud yet. Enable cloud sync on a
              notebook to get started.
            </p>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
            >
              {notebooks.map((nb) => {
                const status = syncStatus[nb.id] ?? "idle";
                const lastSync = lastSyncAt[nb.id] ?? nb.lastSyncAt;
                return (
                  <div key={nb.id} style={cardStyle}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "0.85rem",
                            color: "var(--color-text-primary)",
                          }}
                        >
                          {nb.name}
                        </div>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "var(--color-text-muted)",
                            marginTop: 2,
                          }}
                        >
                          {status === "syncing"
                            ? "Syncing..."
                            : status === "error"
                              ? "Sync error"
                              : lastSync
                                ? `Last synced ${formatRelative(lastSync)}`
                                : "Never synced"}
                        </div>
                      </div>
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background:
                            status === "syncing"
                              ? "#f59e0b"
                              : status === "error"
                                ? "#ef4444"
                                : "#22c55e",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
