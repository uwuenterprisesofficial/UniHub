/* UniHub service worker: lets the app start and work offline.
   - the page itself: network first, cached copy when offline
   - built assets, OCR/ONNX runtime files and fonts: cache first, refreshed in the background
   - /api/* (accounts, sync) is never cached */
const CACHE = 'unihub-v1';
const SCOPE = self.registration.scope;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([SCOPE, SCOPE + 'index.html', SCOPE + 'manifest.webmanifest', SCOPE + 'icon.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || req.headers.has('range')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(SCOPE, copy)); return res; })
      .catch(() => caches.match(SCOPE).then(r => r || caches.match(SCOPE + 'index.html'))));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req);
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
