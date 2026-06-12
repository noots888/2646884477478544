// myMap service worker · mymap-v3-1-170_address_pin_remove
// Simple shell controller: no heavy install pre-cache. Shell files are cached only after they load successfully.
const MYMAP_SW_VERSION = 'mymap-v3-1-170_address_pin_remove';
const SHELL_CACHE = 'app-shell-' + MYMAP_SW_VERSION;
const OLD_CACHE_PATTERNS = [/^field-map-/i, /^fieldMap/i, /^myMap/i, /^mymap/i, /^app-shell-(?!mymap-v3-1-170_address_pin_remove$)/i];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => {
        if (key === SHELL_CACHE) return Promise.resolve(false);
        if (OLD_CACHE_PATTERNS.some(re => re.test(key))) return caches.delete(key);
        return Promise.resolve(false);
      }));
    } catch (e) {}
    await self.clients.claim();
  })());
});

function isShellRequest(url) {
  if (url.origin !== location.origin) return false;
  if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) return true;
  return /\.(css|js|png|json|webmanifest)$/i.test(url.pathname);
}

async function cacheShellResponse(request, response) {
  try {
    if (!response || response.status !== 200 || response.type === 'opaque') return;
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());
    const url = new URL(request.url);
    if (url.origin === location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
      await cache.put(new Request(new URL('./index.html', self.registration.scope).toString()), response.clone());
    }
  } catch (e) {}
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  let url;
  try { url = new URL(event.request.url); } catch (e) { return; }

  if (!isShellRequest(url)) return;

  event.respondWith((async () => {
    try {
      const live = await fetch(event.request);
      cacheShellResponse(event.request, live);
      return live;
    } catch (e) {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      if (url.origin === location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
        const cachedIndex = await cache.match(new Request(new URL('./index.html', self.registration.scope).toString()), { ignoreSearch: true })
          || await caches.match('./index.html', { ignoreSearch: true });
        if (cachedIndex) return cachedIndex;
      }
      throw new Error('myMap offline and requested shell file is not cached');
    }
  })());
});
