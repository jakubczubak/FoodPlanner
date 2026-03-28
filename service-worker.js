const CACHE_NAME = 'planer-posilkow-v2';
const urlsToCache = [
  './',
  './index.html',
  './1486505264-food-fork-kitchen-knife-meanns-restaurant_81404.svg',
  './1486505264-food-fork-kitchen-knife-meanns-restaurant_81404.png'
];

// Instalacja — od razu przejmij kontrolę (skipWaiting)
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Aktywacja — usuń stare cache'e i przejmij klientów
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — network-first z cache fallback
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
