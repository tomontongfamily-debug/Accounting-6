self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data?.json() || {};
  } catch {
    message = { body: event.data?.text() || "A new correction request needs review." };
  }

  event.waitUntil(self.registration.showNotification(message.title || "FuelTech Admin", {
    body: message.body || "A new correction request needs review.",
    icon: "/fueltech-icon-192-v3.png",
    badge: "/fueltech-icon-192-v3.png",
    tag: message.tag || "fueltech-correction-request",
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: message.url || "/admin?view=corrections" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/admin?view=corrections", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus().then(() => existing.navigate(targetUrl));
    return clients.openWindow(targetUrl);
  }));
});
