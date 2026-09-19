import { api } from "../api/client";

export type PushAvailability =
  | "checking"
  | "insecure-origin"
  | "unsupported"
  | "install-required"
  | "server-disabled"
  | "denied"
  | "refresh-required"
  | "disabled"
  | "enabled";

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function browserSupportsPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function subscriptionUsesPublicKey(subscription: PushSubscription, publicKey: string) {
  const currentKey = subscription.options.applicationServerKey;
  if (!currentKey) return false;
  const currentBytes = new Uint8Array(currentKey);
  const expectedBytes = urlBase64ToUint8Array(publicKey);
  return currentBytes.length === expectedBytes.length && currentBytes.every((byte, index) => byte === expectedBytes[index]);
}

export async function getPushAvailability(): Promise<{
  state: PushAvailability;
  publicKey: string | null;
}> {
  if (!window.isSecureContext) return { state: "insecure-origin", publicKey: null };
  if (!browserSupportsPush()) return { state: "unsupported", publicKey: null };
  if (isIos() && !isStandalone()) return { state: "install-required", publicKey: null };

  const config = await api.pushConfig();
  if (!config.enabled || !config.publicKey) return { state: "server-disabled", publicKey: null };
  if (Notification.permission === "denied") return { state: "denied", publicKey: config.publicKey };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription && !subscriptionUsesPublicKey(subscription, config.publicKey)) {
    return { state: "refresh-required", publicKey: config.publicKey };
  }
  if (subscription) await api.savePushSubscription(subscription.toJSON());
  return { state: subscription ? "enabled" : "disabled", publicKey: config.publicKey };
}

export async function enablePushNotifications(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked in this device's settings."
      : "Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.ready;
  let existing = await registration.pushManager.getSubscription();
  if (existing && !subscriptionUsesPublicKey(existing, publicKey)) {
    try { await api.removePushSubscription(existing.endpoint); }
    catch (error) { console.warn("Unable to remove the old server push subscription.", error); }
    await existing.unsubscribe();
    existing = null;
  }
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });
  await api.savePushSubscription(subscription.toJSON());
}

export async function disablePushNotifications() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await api.removePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}
