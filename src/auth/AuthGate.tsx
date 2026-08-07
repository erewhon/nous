// Cookie-session gate for the browser build, plus the /auth/callback
// completion screen. The Tauri shell never renders any of this — main.tsx
// short-circuits on isTauri().
//
// Gate decision on boot:
// - a localStorage daemon API key is the legacy/dev path → straight into
//   the app, untouched;
// - fetchMe() → user: session live, enter the app;
// - fetchMe() → "unavailable": no multi-user daemon behind this origin
//   (legacy daemon or vite dev) → enter the app;
// - fetchMe() → null: the daemon wants a session → sign-in screen.
//
// While the app runs, a 401 from the daemon client dispatches
// SESSION_EXPIRED_EVENT (daemon.ts) and the gate swaps back to sign-in
// instead of leaving a broken app on screen.

import { useEffect, useState } from "react";
import {
  beginLogin,
  completeLogin,
  fetchMe,
  markSessionAuth,
  SESSION_EXPIRED_EVENT,
  type SessionUser,
} from "./authWeb";
import { getStoredDaemonApiKey } from "../utils/daemonConfig";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary,#faf8f5)] text-[var(--text-primary,#2c2a26)]">
      {children}
    </div>
  );
}

/** /auth/callback lives outside the /app base path; finish the code
 *  exchange here, then enter the app. */
export function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    completeLogin()
      .then(() => window.location.replace("/app"))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <Shell>
      {error ? (
        <div className="max-w-md space-y-4 rounded-lg border border-neutral-300 p-8 text-center">
          <h1 className="text-lg font-semibold">Sign-in failed</h1>
          <p className="text-sm opacity-70">{error}</p>
          <a className="inline-block text-sm underline" href="/app">
            Back to sign-in
          </a>
        </div>
      ) : (
        <p className="text-sm opacity-70">Completing sign-in…</p>
      )}
    </Shell>
  );
}

export function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Shell>
      <div className="max-w-md space-y-6 rounded-xl border border-neutral-300 bg-white/60 p-10 text-center shadow-sm">
        <div className="space-y-1">
          <h1 className="font-serif text-4xl">Nous</h1>
          <p className="text-sm opacity-70">Your notebook, signed in</p>
        </div>
        <button
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            beginLogin().catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            });
          }}
        >
          {busy ? "Redirecting…" : "Sign in"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Shell>
  );
}

type GateState = "loading" | "open" | "sign-in";

/** Cookie-session gate for the browser build. */
export function WebAuthGate({ children }: { children: React.ReactNode }) {
  // A stored API key is the legacy/dev path — bypass the gate entirely
  // (decided synchronously so the app doesn't flash a loading screen).
  const [state, setState] = useState<GateState>(() =>
    getStoredDaemonApiKey() ? "open" : "loading"
  );

  useEffect(() => {
    if (state !== "loading") return;
    let cancelled = false;
    fetchMe()
      .then((me: SessionUser | null | "unavailable") => {
        if (cancelled) return;
        if (me === null) {
          setState("sign-in");
        } else {
          if (me !== "unavailable") markSessionAuth(true);
          setState("open");
        }
      })
      .catch(() => {
        if (!cancelled) setState("open");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An expired/killed session mid-use: swap to sign-in, don't strand a
  // broken app.
  useEffect(() => {
    const onExpired = () => {
      markSessionAuth(false);
      setState("sign-in");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  if (state === "loading") {
    return (
      <Shell>
        <p className="text-sm opacity-70">Loading…</p>
      </Shell>
    );
  }
  if (state === "sign-in") return <SignIn />;
  return <>{children}</>;
}
