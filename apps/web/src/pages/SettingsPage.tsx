import { BellRing, Database, Factory, HardDrive, QrCode, RadioTower, RefreshCw, Save, Settings2, Smartphone, Tv, Wrench } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { AirLeakSyncSettings, WorkOrderSyncSettings } from "@pbs-cmms/shared";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { PwaInstallButton } from "../components/PwaInstallButton";
import { PlantSelector } from "../components/PlantSelector";
import { PushNotificationControl } from "../components/PushNotificationControl";
import { useCurrentUser } from "../state/UserContext";

const notificationRows = [
  ["Work order opened", "Maintenance team + executive"],
  ["Repair started", "Requester"],
  ["Pending material", "Requester + executive"],
  ["Repair resolved", "Requester"],
  ["Requester returned", "Assigned technician + executive"]
];

const emptySync: WorkOrderSyncSettings = {
  scriptUrl: "", hasToken: false, sheetName: "WorkOrders", webhookUrl: "", configured: false,
  pendingCount: 0, failedCount: 0, lastSyncAt: null, lastError: null
};
const emptyAirLeakSync: AirLeakSyncSettings = {
  hasInboundToken: false, scriptUrl: "", hasScriptToken: false, sheetName: "Main", configured: false,
  pendingCount: 0, failedCount: 0, lastSyncAt: null, lastError: null
};

export function SettingsPage() {
  const { currentUser } = useCurrentUser();
  const [sync, setSync] = useState(emptySync);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncReady, setSyncReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [airLeakSync, setAirLeakSync] = useState(emptyAirLeakSync);
  const [airLeakInboundToken, setAirLeakInboundToken] = useState("");
  const [airLeakScriptToken, setAirLeakScriptToken] = useState("");
  const [airLeakMessage, setAirLeakMessage] = useState("");
  const [airLeakError, setAirLeakError] = useState("");
  const [airLeakBusy, setAirLeakBusy] = useState(false);
  const canAdmin = Boolean(currentUser && ["executive", "admin", "developer"].includes(currentUser.role));

  async function loadSync() {
    try { setSync(await api.workOrderSyncSettings()); setSyncReady(true); setError(""); }
    catch { setError("Couldn’t load integration settings. Reload before making changes."); }
  }
  useEffect(() => {
    if (!canAdmin) return;
    void Promise.all([loadSync(), api.airLeakSyncSettings().then(setAirLeakSync)]).catch(console.error);
  }, [canAdmin]);

  async function saveSync(event: FormEvent) {
    event.preventDefault();
    if (!currentUser) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const updated = await api.updateWorkOrderSyncSettings({
        actorId: currentUser.id, scriptUrl: sync.scriptUrl, token: token || undefined,
        sheetName: sync.sheetName, webhookUrl: sync.webhookUrl
      });
      setSync(updated); setToken(""); setMessage("Work order integration settings saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save integration settings.");
    } finally { setBusy(false); }
  }

  async function retrySync() {
    if (!currentUser) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.retryWorkOrderSync(currentUser.id);
      setSync(result.settings); setMessage(result.message);
      if (!result.ok && result.errors.length) setError(result.errors.slice(0, 3).join(" "));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to run sync.");
    } finally { setBusy(false); }
  }

  async function saveAirLeakSync(event: FormEvent) {
    event.preventDefault();
    if (!currentUser) return;
    setAirLeakBusy(true); setAirLeakError(""); setAirLeakMessage("");
    try {
      const updated = await api.updateAirLeakSyncSettings({
        actorId: currentUser.id,
        inboundToken: airLeakInboundToken || undefined,
        scriptUrl: airLeakSync.scriptUrl,
        scriptToken: airLeakScriptToken || undefined,
        sheetName: airLeakSync.sheetName
      });
      setAirLeakSync(updated); setAirLeakInboundToken(""); setAirLeakScriptToken("");
      setAirLeakMessage("AppSheet Air Leak integration settings saved.");
    } catch (nextError) {
      setAirLeakError(nextError instanceof Error ? nextError.message : "Unable to save the Air Leak integration.");
    } finally { setAirLeakBusy(false); }
  }

  async function retryAirLeakSync() {
    if (!currentUser) return;
    setAirLeakBusy(true); setAirLeakError(""); setAirLeakMessage("");
    try {
      const result = await api.retryAirLeakSync(currentUser.id);
      setAirLeakSync(result.settings); setAirLeakMessage(result.message);
      if (!result.ok && result.errors.length) setAirLeakError(result.errors.slice(0, 3).join(" "));
    } catch (nextError) {
      setAirLeakError(nextError instanceof Error ? nextError.message : "Unable to run the Air Leak sync.");
    } finally { setAirLeakBusy(false); }
  }

  return (
    <section className="page-stack settings-page">
      <div className="page-title-row page-title-clean">
        <div><p className="eyebrow">System preferences</p><h1>Settings</h1></div>
        <span className="role-chip"><Settings2 size={17} aria-hidden="true" />{canAdmin ? "Administrator" : "Plant preferences"}</span>
      </div>

      <section className="section-panel plant-settings-card">
        <div className="section-header">
          <div><h2>Plant view</h2><span>Choose which plant's operational records you want to work with.</span></div>
          <Factory size={22} aria-hidden="true" />
        </div>
        <PlantSelector />
      </section>

      {canAdmin ? <form className="section-panel work-order-sync-card" onSubmit={saveSync}>
        <div className="section-header">
          <div><h2>Work Order → Google Sheets</h2><span>SQLite remains primary; queued updates retry automatically every minute.</span></div>
          <Database size={22} aria-hidden="true" />
        </div>
        <div className="form-grid two-columns">
          <label>Apps Script web app URL<input type="url" value={sync.scriptUrl} onChange={(event) => setSync({ ...sync, scriptUrl: event.target.value })} placeholder="https://script.google.com/macros/s/.../exec" /></label>
          <label>Sheet tab<input value={sync.sheetName} onChange={(event) => setSync({ ...sync, sheetName: event.target.value })} placeholder="WorkOrders" /></label>
          <label>Shared token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={sync.hasToken ? "Configured — leave blank to keep" : "Required"} /></label>
          <label>Node-RED / Telegram webhook (optional)<input type="url" value={sync.webhookUrl} onChange={(event) => setSync({ ...sync, webhookUrl: event.target.value })} placeholder="http://server:1880/workorderpk" /></label>
        </div>
        <div className="sync-status-row">
          <span className={sync.configured ? "sync-ready" : "sync-off"}>{sync.configured ? "Google sync configured" : "Google sync not configured"}</span>
          <span>{sync.pendingCount} pending</span><span>{sync.failedCount} failed</span>
          {sync.lastSyncAt ? <span>Last sync {new Date(sync.lastSyncAt).toLocaleString()}</span> : null}
        </div>
        {sync.lastError ? <p className="error-line" role="alert">Last error: {sync.lastError}</p> : null}
        {error ? <p className="error-line" role="alert">{error}</p> : null}
        {message ? <p role="status" className="success-line">{message}</p> : null}
        <div className="form-actions">
          <button className="secondary-action" type="button" disabled={busy || !sync.configured} onClick={retrySync}><RefreshCw size={16} />Sync now</button>
          <button className="primary-action" type="submit" disabled={busy || !sync.scriptUrl.trim() || (!sync.hasToken && !token.trim())}><Save size={16} />Save integration</button>
        </div>
      </form> : null}

      {canAdmin ? <form className="section-panel work-order-sync-card" onSubmit={saveAirLeakSync}>
        <div className="section-header">
          <div><h2>AppSheet Air Leak Integration</h2><span>Creates SHE work orders and returns closure details to the Air Leak sheet.</span></div>
          <RadioTower size={22} aria-hidden="true" />
        </div>
        <div className="form-grid two-columns">
          <label>AppSheet inbound token<input type="password" value={airLeakInboundToken} onChange={(event) => setAirLeakInboundToken(event.target.value)} placeholder={airLeakSync.hasInboundToken ? "Configured — leave blank to keep" : "Required for the AppSheet webhook"} /></label>
          <label>Apps Script web app URL<input type="url" value={airLeakSync.scriptUrl} onChange={(event) => setAirLeakSync({ ...airLeakSync, scriptUrl: event.target.value })} placeholder="https://script.google.com/macros/s/.../exec" /></label>
          <label>Apps Script shared token<input type="password" value={airLeakScriptToken} onChange={(event) => setAirLeakScriptToken(event.target.value)} placeholder={airLeakSync.hasScriptToken ? "Configured — leave blank to keep" : "Required for return updates"} /></label>
          <label>Air Leak sheet tab<input value={airLeakSync.sheetName} onChange={(event) => setAirLeakSync({ ...airLeakSync, sheetName: event.target.value })} placeholder="Main" /></label>
        </div>
        <div className="sync-status-row">
          <span className={airLeakSync.hasInboundToken ? "sync-ready" : "sync-off"}>{airLeakSync.hasInboundToken ? "Inbound webhook secured" : "Inbound token missing"}</span>
          <span className={airLeakSync.configured ? "sync-ready" : "sync-off"}>{airLeakSync.configured ? "Return sync configured" : "Return sync not configured"}</span>
          <span>{airLeakSync.pendingCount} pending</span><span>{airLeakSync.failedCount} failed</span>
          {airLeakSync.lastSyncAt ? <span>Last sync {new Date(airLeakSync.lastSyncAt).toLocaleString()}</span> : null}
        </div>
        {airLeakSync.lastError ? <p className="error-line" role="alert">Last error: {airLeakSync.lastError}</p> : null}
        {airLeakError ? <p className="error-line" role="alert">{airLeakError}</p> : null}
        {airLeakMessage ? <p role="status" className="success-line">{airLeakMessage}</p> : null}
        <div className="form-actions">
          <button className="secondary-action" type="button" disabled={airLeakBusy || !airLeakSync.configured} onClick={retryAirLeakSync}><RefreshCw size={16} />Sync now</button>
          <button className="primary-action" type="submit" disabled={airLeakBusy || (!airLeakSync.hasInboundToken && !airLeakInboundToken.trim())}><Save size={16} />Save Air Leak integration</button>
        </div>
      </form> : null}

      {canAdmin ? <div className="settings-grid">
        <section className="section-panel settings-card"><QrCode size={22} aria-hidden="true" /><h2>Requester QR Poster</h2><p>The live requester URL is inserted automatically into a branded, print-ready A4 PDF.</p><Link className="secondary-action" to="/users?tab=qr">Generate print-ready PDF</Link></section>
        <section className="section-panel settings-card"><Wrench size={22} aria-hidden="true" /><h2>Work Order Master Data</h2><p>Manage department-specific sections, areas, machines and issue categories.</p><Link className="secondary-action" to="/users?tab=machines">Manage machines</Link></section>
        <section className="section-panel settings-card"><BellRing size={22} aria-hidden="true" /><h2>Notification Rules</h2><div className="settings-list">{notificationRows.map(([event, receiver]) => <div key={event}><span>{event}</span><strong>{receiver}</strong></div>)}</div><PushNotificationControl /></section>
        <section className="section-panel settings-card"><HardDrive size={22} aria-hidden="true" /><h2>Upload Storage</h2><div className="settings-list"><div><span>Mode</span><strong>Local server</strong></div><div><span>Folder</span><strong>apps/api/uploads</strong></div><div><span>Max file</span><strong>8 MB</strong></div></div></section>
        <section className="section-panel settings-card"><Smartphone size={22} aria-hidden="true" /><h2>PWA Mobile</h2><div className="toggle-list"><label><input type="checkbox" checked readOnly />Installable app shell</label><label><input type="checkbox" checked readOnly />Service worker registered</label></div><PwaInstallButton /></section>
        <section className="section-panel settings-card"><Tv size={22} aria-hidden="true" /><h2>TV Dashboard</h2><div className="settings-list"><div><span>Refresh</span><strong>30 seconds</strong></div><div><span>Board</span><strong>New, In Progress, Pending, Verify</strong></div></div></section>
        <section className="section-panel settings-card"><Database size={22} aria-hidden="true" /><h2>Database</h2><div className="settings-list"><div><span>Primary</span><strong>SQLite server database</strong></div><div><span>Secondary</span><strong>Google Sheet outbox sync</strong></div></div></section>
        <section className="section-panel settings-card"><RadioTower size={22} aria-hidden="true" /><h2>Factory Display</h2><div className="toggle-list"><label><input type="checkbox" checked readOnly />Auto-refresh board</label><label><input type="checkbox" checked readOnly />High contrast status colors</label></div></section>
      </div> : null}
    </section>
  );
}
