/* LabIQ Kontrol — service worker: push bildirimleri */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch {
    m = { title: "LabIQ Kontrol", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(m.title || "LabIQ Kontrol", {
      body: m.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: m.tag,
      renotify: !!m.tag,
      requireInteraction: m.level === "alert",
      data: { url: m.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
