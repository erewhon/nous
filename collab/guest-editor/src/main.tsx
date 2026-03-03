import React from "react";
import ReactDOM from "react-dom/client";
import { GuestApp } from "./GuestApp";
import { GuestMultiPageApp } from "./GuestMultiPageApp";

function App() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";

  if (path.startsWith("/s/")) {
    // Scoped session: /s/{session_id}?token={token}
    // Deep link:      /s/{session_id}/{page_id}?token={token}
    const parts = path.replace("/s/", "").split("/");
    const sessionId = parts[0] || "";
    const initialPageId = parts[1] || undefined;

    return (
      <GuestMultiPageApp
        sessionId={sessionId}
        token={token}
        initialPageId={initialPageId}
      />
    );
  }

  // Legacy single-page: /{room_id}?token={token}
  return <GuestApp />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
