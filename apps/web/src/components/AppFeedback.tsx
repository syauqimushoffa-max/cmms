import { Component, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, WifiOff } from "lucide-react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="ux-recovery" role="alert">
      <AlertTriangle size={32} aria-hidden="true" />
      <h1>This page couldn’t open</h1>
      <p>Reload to try again. Any unsaved changes on this page may be lost.</p>
      <button className="primary-action" onClick={() => window.location.reload()}>Reload page</button>
      <a href="/">Return home</a>
    </main>;
  }
}

export function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online ? null : <div className="ux-connection" role="status"><WifiOff size={18} aria-hidden="true" />You’re offline. Displayed information may be out of date. Reconnect before saving changes.</div>;
}
