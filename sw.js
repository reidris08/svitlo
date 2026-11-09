// Офлайн-режим: оболонка застосунку з кешу, дані — спершу з мережі.
const CACHE = "svitlo-v7";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-180.png", "icon-512.png", "search.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  if (url.pathname.includes("/data/")) return; // дані завжди свіжі; офлайн-копія — у localStorage
  e.respondWith(
    // cache: "no-cache" — щоразу звіряємося з сервером, щоб нова версія застосунку з'являлася одразу
    fetch(new Request(e.request.url, { cache: "no-cache" })).then((r) => {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
