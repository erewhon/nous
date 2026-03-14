import { useEffect, useState, type FormEvent } from "react";
import { useWebStore } from "../store";
import type { NotebookShareInfo } from "../api";

interface ShareDialogProps {
  notebookId: string;
  onClose: () => void;
}

export function ShareDialog({ notebookId, onClose }: ShareDialogProps) {
  const { createShare, listShares, revokeShare } = useWebStore();
  const [shares, setShares] = useState<NotebookShareInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // Password form
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [sharePassword, setSharePassword] = useState("");
  const [sharePasswordConfirm, setSharePasswordConfirm] = useState("");
  const [shareLabel, setShareLabel] = useState("");

  useEffect(() => {
    loadShares();
  }, [notebookId]);

  const loadShares = async () => {
    setLoading(true);
    try {
      const result = await listShares(notebookId);
      setShares(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shares");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePublic = async () => {
    setCreating(true);
    setError("");
    try {
      const { shareUrl } = await createShare(notebookId, "public");
      setGeneratedUrl(shareUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share");
    } finally {
      setCreating(false);
    }
  };

  const handleCreatePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (sharePassword !== sharePasswordConfirm) {
      setError("Passwords do not match");
      return;
    }
    if (sharePassword.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const { shareUrl } = await createShare(
        notebookId,
        "password",
        sharePassword,
        shareLabel || undefined,
      );
      setGeneratedUrl(shareUrl);
      setShowPasswordForm(false);
      setSharePassword("");
      setSharePasswordConfirm("");
      setShareLabel("");
      await loadShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeShare(notebookId, shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share");
    }
  };

  const handleCopy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Share Notebook</h2>
          <button className="btn btn-ghost" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="dialog-body">
          {error && <div className="error-msg">{error}</div>}

          {generatedUrl && (
            <div className="share-url-box">
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
                Share link created:
              </div>
              <div className="share-url-row">
                <input
                  type="text"
                  value={generatedUrl}
                  readOnly
                  className="share-url-input"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  className="btn btn-primary"
                  style={{ width: "auto", padding: "8px 16px", flexShrink: 0 }}
                  onClick={() => handleCopy(generatedUrl)}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              {generatedUrl.includes("#key=") && (
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
                  Anyone with this link can read this notebook. The encryption
                  key is embedded in the URL.
                </div>
              )}
              <button
                className="btn btn-ghost"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setGeneratedUrl("");
                  loadShares();
                }}
              >
                Done
              </button>
            </div>
          )}

          {!generatedUrl && !showPasswordForm && (
            <div className="share-actions">
              <button
                className="btn btn-primary"
                onClick={handleCreatePublic}
                disabled={creating}
                style={{ marginBottom: 8 }}
              >
                {creating ? "Creating..." : "Create Public Link"}
              </button>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 16 }}>
                Anyone with the link can read. Key is embedded in the URL.
              </div>

              <button
                className="btn btn-ghost"
                onClick={() => setShowPasswordForm(true)}
                style={{ border: "1px solid var(--border)" }}
              >
                Create Password-Protected Link
              </button>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
                Recipient must enter a password you choose.
              </div>
            </div>
          )}

          {!generatedUrl && showPasswordForm && (
            <form onSubmit={handleCreatePassword}>
              <div className="form-group">
                <label>Share Password</label>
                <input
                  type="password"
                  value={sharePassword}
                  onChange={(e) => setSharePassword(e.target.value)}
                  placeholder="Choose a password"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={sharePasswordConfirm}
                  onChange={(e) => setSharePasswordConfirm(e.target.value)}
                  placeholder="Confirm password"
                  required
                />
              </div>
              <div className="form-group">
                <label>Label (optional)</label>
                <input
                  type="text"
                  value={shareLabel}
                  onChange={(e) => setShareLabel(e.target.value)}
                  placeholder='e.g. "For Alice"'
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creating}
                  style={{ flex: 1 }}
                >
                  {creating ? "Creating..." : "Create Share"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowPasswordForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Existing shares */}
          {!generatedUrl && shares.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Active Shares
              </div>
              {shares.map((share) => (
                <div key={share.id} className="share-row">
                  <div>
                    <div style={{ fontSize: 13 }}>
                      {share.mode === "public" ? "Public link" : "Password-protected"}
                      {share.label && (
                        <span style={{ color: "var(--text-dim)" }}>
                          {" "}&mdash; {share.label}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      Created {formatRelative(share.createdAt)}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--danger)", fontSize: 12 }}
                    onClick={() => handleRevoke(share.id)}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div className="loading" style={{ padding: 20 }}>
              <div className="spinner" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
