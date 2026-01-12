const CACHE_NAME = 'planer-posilkow-v1';
const urlsToCache = [
  './',
  './index.html',
  './1486505264-food-fork-kitchen-knife-meanns-restaurant_81404.svg',
  './1486505264-food-fork-kitchen-knife-meanns-restaurant_81404.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
