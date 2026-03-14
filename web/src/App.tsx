import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useParams,
} from "react-router-dom";
import { useWebStore } from "./store";
import { LoginPage } from "./pages/LoginPage";
import { UnlockPage } from "./pages/UnlockPage";
import { NotebookPage } from "./pages/NotebookPage";
import { SharePage } from "./pages/SharePage";

function NotebookSidebar() {
  const { notebooks, loadNotebooks, isLoading, email, logout, lockEncryption } =
    useWebStore();
  const { notebookId } = useParams<{ notebookId?: string }>();

  useEffect(() => {
    loadNotebooks();
  }, [loadNotebooks]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>Nous</h1>
        <button
          className="btn btn-ghost"
          onClick={() => {
            lockEncryption();
            logout();
          }}
          title="Sign out"
        >
          Sign Out
        </button>
      </div>

      <div className="sidebar-content">
        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : notebooks.length === 0 ? (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 13 }}>
            No notebooks synced yet. Sync a notebook from the Nous desktop app.
          </div>
        ) : (
          notebooks.map((nb) => (
            <Link
              key={nb.id}
              to={`/notebook/${nb.id}`}
              className={`notebook-item ${nb.id === notebookId ? "active" : ""}`}
              style={{ textDecoration: "none" }}
            >
              <span className="icon">📓</span>
              <div>
                <div className="name">{nb.name}</div>
                {nb.lastSyncAt && (
                  <div className="meta">
                    Synced {formatRelative(nb.lastSyncAt)}
                  </div>
                )}
              </div>
            </Link>
          ))
        )}
      </div>

      <div className="user-menu">
        <span className="email">{email}</span>
      </div>
    </div>
  );
}

function MainLayout() {
  return (
    <div className="app-layout">
      <NotebookSidebar />
      <Routes>
        <Route
          index
          element={
            <div className="main-content">
              <div className="empty-state">
                <div className="icon">📓</div>
                <h3>Select a notebook</h3>
                <p>Choose a notebook from the sidebar to view its pages.</p>
              </div>
            </div>
          }
        />
        <Route path="notebook/:notebookId" element={<NotebookPage />} />
        <Route
          path="notebook/:notebookId/page/:pageId"
          element={<NotebookPage />}
        />
      </Routes>
    </div>
  );
}

function AuthenticatedRoutes() {
  const { isUnlocked, hasEncryptionSetup } = useWebStore();

  if (!hasEncryptionSetup || !isUnlocked) {
    return <UnlockPage />;
  }

  return <MainLayout />;
}

export function App() {
  const { isAuthenticated } = useWebStore();

  return (
    <BrowserRouter>
      <Routes>
        {/* Public share routes — no auth needed */}
        <Route path="/s/:shareId" element={<SharePage />} />
        <Route path="/s/:shareId/page/:pageId" element={<SharePage />} />

        {/* Authenticated routes */}
        <Route
          path="/*"
          element={
            isAuthenticated ? <AuthenticatedRoutes /> : <LoginPage />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
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
