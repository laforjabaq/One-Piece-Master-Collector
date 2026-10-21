// Service worker: guarda la app, el motor de OCR y el de embeddings (el modelo
// lo guarda el propio worker en la caché opmc-models-v1, que aquí no se borra) para que abra rápido y sin conexión.
const VERSION = "opmc-v3";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const IMAGES = `${VERSION}-images`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll(["/", "/escanear", "/buscar"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION) && !k.startsWith("opmc-models")).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Índice de embeddings del catálogo: se sirve de la caché al instante y se
// actualiza en segundo plano (se regenera cada semana en GitHub Actions).
const staleWhileRevalidate = async (req, name) => {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
};

const cacheFirst = async (req, name) => {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") (await caches.open(name)).put(req, res.clone());
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/api/")) return; // datos siempre frescos
    if (url.pathname.startsWith("/embeddings/")) {
      e.respondWith(staleWhileRevalidate(req, `${VERSION}-embeddings`));
      return;
    }
    if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/tesseract/") || url.pathname.startsWith("/ort/") || url.pathname.startsWith("/embed/") || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
      e.respondWith(cacheFirst(req, STATIC));
      return;
    }
    if (req.mode === "navigate") {
      e.respondWith(
        fetch(req)
          .then((res) => {
            caches.open(PAGES).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(async () => (await caches.match(req)) || caches.match("/")),
      );
    }
    return;
  }

  if (req.destination === "image") e.respondWith(cacheFirst(req, IMAGES).catch(() => fetch(req)));
});
