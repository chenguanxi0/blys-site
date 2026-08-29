const CACHE_NAME = 'blys-v29';
const ASSETS = [
  '/',
  '/index.html',
  '/chat.html?v=2026082704',
  '/daily.html',
  '/diary.html?v=2026082102',
  '/changelog.html',
  '/notification-guide.html?v=2026082105',
  '/member-discipline.html',
  '/assets/styles.css?v=2026082503',
  '/assets/app.js?v=2026082704',
  '/assets/mobile-app.js?v=2026082445',
  '/assets/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 预缓存中个别页面可能尚未部署；不能因此让整个 Service Worker 安装失败，
      // 否则 Chrome 会一直卡在 “SW ready timeout”，浏览器提醒只能退回页内提醒。
      await Promise.all(ASSETS.map(async (url) => {
        try {
          const response = await fetch(url, { cache: 'no-cache' });
          if (response.ok) await cache.put(url, response);
        } catch (e) {
          // 离线或单个资源缺失时跳过，Worker 仍可正常激活并接收推送。
        }
      }));
    })
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
