/*
 * El service worker de la versión web (el iPhone): guarda la app entera la primera vez, así abre
 * y graba sin señal (en Colinas Verdes puede no haber). En el APK no se usa: ahí la app viene
 * adentro.
 *
 * scripts/armar-web.mjs le pone la versión y la lista de archivos. Una versión nueva se instala
 * al lado y espera: la página ofrece «Actualizar» y recién ahí pasa (nunca en medio de un viaje).
 */
const CACHE = 'dikra-__VERSION__';
const ARCHIVOS = __ARCHIVOS__;

// `reload`: directo del servidor. Si no, la caché del navegador podía dar el archivo de la
// versión anterior y la nueva quedaba armada con pedazos viejos.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('dikra-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'actualizar') self.skipWaiting();
});

// Primero lo guardado; lo que no está (los viajes de prueba, por ejemplo) se pide a la red.
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(r, { ignoreSearch: true }).then((g) => g || fetch(r)),
  );
});
