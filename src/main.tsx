import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WindowContextProvider } from "./contexts/WindowContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WindowContextProvider>
      <App />
    </WindowContextProvider>
  </React.StrictMode>
);
