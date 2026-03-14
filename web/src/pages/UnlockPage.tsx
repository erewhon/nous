import { useState, type FormEvent } from "react";
import { useWebStore } from "../store";

export function UnlockPage() {
  const [masterPassword, setMasterPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const { unlockEncryption, logout, email, hasEncryptionSetup } = useWebStore();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setUnlockError("");
    setUnlocking(true);

    try {
      const ok = await unlockEncryption(masterPassword);
      if (!ok) {
        setUnlockError("Incorrect master password.");
      }
    } catch {
      setUnlockError("Failed to unlock encryption.");
    } finally {
      setUnlocking(false);
    }
  };

  if (!hasEncryptionSetup) {
    return (
      <div className="center-page">
        <div className="center-card">
          <h1>Encryption Not Set Up</h1>
          <p>
            Set up encryption in the Nous desktop app first, then return here to
            view your notebooks.
          </p>
          <button className="btn btn-ghost" onClick={logout}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="center-page">
      <div className="center-card">
        <h1>Unlock</h1>
        <p>
          Enter your master password to decrypt your notebooks.
          {email && (
            <span style={{ display: "block", marginTop: 4 }}>
              Signed in as {email}
            </span>
          )}
        </p>

        {unlockError && <div className="error-msg">{unlockError}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Master Password</label>
            <input
              type="password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="Your master password"
              required
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={unlocking}
          >
            {unlocking ? "Unlocking..." : "Unlock"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={logout}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
