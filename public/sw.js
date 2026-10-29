// Service worker de EnQuéGasté: permite instalar la app en el celular y abrirla aunque no haya conexión.
// Pide siempre la versión nueva a la red; si no hay internet, usa la última guardada. La API nunca se guarda.
'use strict';
const CACHE = 'enquegaste-v1';
const BASE = ['/', '/app.js', '/styles.css', '/icono.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const clave = req.mode === 'navigate' ? '/' : url.pathname; // la app es de una sola página
  e.respondWith(fetch(req)
    .then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(clave, copia)); }
      return res;
    })
    .catch(() => caches.match(clave).then((r) => r || Response.error())));
});
