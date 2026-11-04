import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PilotGate from "./PilotGate.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.location.pathname.startsWith('/pilot/') || ['/admin','/approver','/manager','/cashier'].includes(window.location.pathname) || import.meta.env.VITE_PILOT_PREVIEW==='1' ? <PilotGate /> : <App />}
  </React.StrictMode>
);
