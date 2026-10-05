import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PilotGate from "./PilotGate.jsx";
import LiloanLaunchNotice from './LiloanLaunchNotice.jsx';
import StationEntryGate from './station-entry-gate.jsx';
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.location.pathname.startsWith('/pilot/') || import.meta.env.VITE_PILOT_PREVIEW==='1' ? <PilotGate /> : <StationEntryGate><LiloanLaunchNotice/><App /></StationEntryGate>}
  </React.StrictMode>
);
