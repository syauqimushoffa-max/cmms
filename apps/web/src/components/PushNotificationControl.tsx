import { BellRing, BellOff, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushAvailability,
  type PushAvailability
} from "../pwa/pushNotifications";
import { useCurrentUser } from "../state/UserContext";

const statusText: Record<PushAvailability, string> = {
  checking: "Checking push support…",
  "insecure-origin": "Push requires HTTPS. A raw http://IP address cannot receive browser notifications.",
  unsupported: "Push alerts are not supported by this browser.",
  "install-required": "On iPhone or iPad, add this PWA to the Home Screen first.",
  "server-disabled": "Push alerts need VAPID keys on the server.",
  denied: "Push alerts are blocked in this device's notification settings.",
  "refresh-required": "The notification security key changed. Re-enable alerts on this device.",
  disabled: "Receive work-order alerts when the app is closed.",
  enabled: "Push alerts are enabled on this device."
};

export function PushNotificationControl({ compact = false }: { compact?: boolean }) {
  const { currentUser } = useCurrentUser();
  const [state, setState] = useState<PushAvailability>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      const availability = await getPushAvailability();
      setState(availability.state);
      setPublicKey(availability.publicKey);
    } catch (error) {
      setState("server-disabled");
      setMessage(error instanceof Error ? error.message : "Unable to check push notifications.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMessage("");
    try {
      await enablePushNotifications(publicKey);
      setState("enabled");
      setMessage("Push alerts enabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to enable push alerts.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      await disablePushNotifications();
      setState("disabled");
      setMessage("Push alerts disabled on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to disable push alerts.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api.testPushNotification();
      setMessage(result.sent > 0
        ? `Test alert sent to ${result.sent} registered ${result.sent === 1 ? "device" : "devices"}${result.failed ? `; ${result.failed} failed and must re-enable alerts` : ""}.`
        : result.failed > 0
          ? `Test failed for ${result.failed} registered ${result.failed === 1 ? "device" : "devices"}. Re-enable push alerts on those devices.`
          : "No device is registered yet. Enable push alerts on a device first.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send a test alert.");
    } finally {
      setBusy(false);
    }
  }

  const actionable = state === "enabled" || state === "disabled" || state === "refresh-required";
  const canSendAdminTest = Boolean(currentUser && ["executive", "admin", "developer"].includes(currentUser.role));

  return (
    <div className={`push-control ${compact ? "compact" : ""}`}>
      <div className="push-control-status">
        {state === "enabled" ? <BellRing size={18} aria-hidden="true" /> : <BellOff size={18} aria-hidden="true" />}
        <span>{message || statusText[state]}</span>
      </div>
      {actionable || canSendAdminTest ? (
        <div className="push-control-actions">
          {state === "disabled" || state === "refresh-required" ? (
            <button type="button" onClick={enable} disabled={busy}>
              <BellRing size={16} aria-hidden="true" />
              {busy ? "Enabling…" : state === "refresh-required" ? "Re-enable push alerts" : "Enable push alerts"}
            </button>
          ) : state === "enabled" ? (
            <button className="push-control-disable" type="button" onClick={disable} disabled={busy}>
              Turn off on this device
            </button>
          ) : null}
          {canSendAdminTest ? (
            <button className="push-control-test" type="button" onClick={sendTest} disabled={busy}>
              <Send size={15} aria-hidden="true" />
              {busy ? "Sending…" : "Send test notification"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
