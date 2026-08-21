const CACHE_NAME = 'blys-v6';
const ASSETS = [
  '/',
  '/index.html',
  '/chat.html?v=2026082102',
  '/daily.html',
  '/diary.html',
  '/changelog.html',
  '/notification-guide.html',
  '/assets/styles.css?v=2026082102',
  '/assets/app.js',
  '/assets/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  event.waitUntil(
    self.registration.showNotification(data.title || '白鹿原上', {
      body: data.body || '聊天室有新消息',
      icon: '/assets/favicon.png',
      badge: '/assets/favicon.png',
      tag: data.tag || 'chat-message',
      renotify: true,
      data: { url: data.url || '/chat.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const target = new URL(url || '/chat.html', self.location.origin).href;
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
