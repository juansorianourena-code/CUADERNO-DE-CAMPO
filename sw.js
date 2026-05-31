const CACHE_NAME = 'campo-digital-v20';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=20',
  './app.js?v=20',
  './manifest.json',
  './icon.png',
  './icon-512.png',
  './phosphor-regular.css',
  './phosphor-fill.css',
  './Phosphor.woff2',
  './Phosphor-Fill.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Helper para limpiar las respuestas con redirecciones en Safari
function cleanResponse(response) {
  if (!response || !response.redirected) {
    return response;
  }
  // Reconstruye la respuesta para limpiar la metadata de redirección
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Intenta actualizar la caché en segundo plano
        fetch(e.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, cleanResponse(networkResponse));
            });
          }
        }).catch(() => {/* Ignorar errores de red */});
        
        return cleanResponse(cachedResponse);
      }
      
      return fetch(e.request).then((networkResponse) => {
        return cleanResponse(networkResponse);
      });
    })
  );
});
