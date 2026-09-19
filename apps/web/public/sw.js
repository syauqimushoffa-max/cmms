const CACHE_NAME = "pbs-cmms-shell-v11";
const APP_SHELL_URL = "/";
const SHELL_ASSETS = [APP_SHELL_URL, "/manifest.webmanifest", "/requester.webmanifest", "/icons/cmms-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/uploads")) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(APP_SHELL_URL)));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "A CMMS update is available." };
  }

  event.waitUntil(self.registration.showNotification(payload.title || "PBS CMMS", {
    body: payload.body || "A CMMS update is available.",
    icon: payload.icon || "/icons/cmms-icon.svg",
    badge: payload.badge || "/icons/cmms-icon.svg",
    tag: payload.tag || "pbs-cmms",
    data: { url: payload.url || "/" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      if ("navigate" in client) await client.navigate(targetUrl);
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
  }));
});
