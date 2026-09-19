export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((registration) => {
        // Install updates in the background without reloading an open page.
        // The new version is picked up naturally the next time the PWA opens,
        // so partially completed forms are never discarded by an update.
        void registration.update();
        window.setInterval(() => void registration.update(), 60 * 60 * 1000);
      })
      .catch((error) => {
        console.info("Service worker registration skipped.", error);
      });
  });
}
