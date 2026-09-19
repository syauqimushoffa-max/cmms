import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import { selectedPlant } from "./api/client";
import { AppErrorBoundary, ConnectionStatus } from "./components/AppFeedback";
import { App } from "./App";
import { UserProvider } from "./state/UserContext";
import { initInstallPromptListener } from "./pwa/installPrompt";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import "./styles.css";

initInstallPromptListener();

function PlantScopedApp() {
  const location = useLocation();
  // Leaving combined reports or the cross-plant user directory must discard
  // cached work orders/users before the next operational screen can render.
  const scope = `${selectedPlant()}:${location.pathname === "/users" ? "users" : "operations"}`;
  return <UserProvider key={scope}><App /></UserProvider>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ConnectionStatus />
    <BrowserRouter>
      <PlantScopedApp />
    </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);

registerServiceWorker();
