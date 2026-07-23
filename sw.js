/**
 * Service Worker "Scout Manager" — rende l'app disponibile anche a
 * pagina "fredda" senza internet (es. se il tablet scarica la pagina
 * dalla memoria durante un volo e la ricarica offline).
 *
 * IMPORTANTE — quando aggiorno l'app (nuovo scout-manager.html):
 * cambia il numero qui sotto (es. da "v1" a "v2") prima di ripubblicare
 * su GitHub, altrimenti i dispositivi che hanno già l'app in cache
 * potrebbero continuare a vedere la versione vecchia finché non la
 * aprono con internet attivo (il Service Worker aggiorna comunque la
 * cache in background a ogni apertura online, ma cambiare il numero
 * forza un aggiornamento più deciso e pulito).
 */
const CACHE_NAME = "scout-manager-v1";

// Percorsi relativi alla cartella dove si trova QUESTO file (sw.js) —
// deve stare nella stessa cartella di scout-manager.html.
const APP_SHELL = [
  "./scout-manager.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// Risorse esterne (CDN) usate dall'app, cache "best effort": se non
// sono raggiungibili durante l'installazione non blocchiamo tutto.
const RISORSE_ESTERNE = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await Promise.all(RISORSE_ESTERNE.map(url =>
      cache.add(new Request(url, { mode: "no-cors" })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return; // non intercettare i salvataggi (POST) verso Dropbox/Google/ecc.

  // La pagina stessa: rete prima (per avere sempre l'ultima versione
  // quando c'è internet), con la copia salvata come riserva se offline.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const risposta = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put("./scout-manager.html", risposta.clone());
        return risposta;
      } catch (e) {
        const cache = await caches.open(CACHE_NAME);
        const salvata = await cache.match("./scout-manager.html");
        if (salvata) return salvata;
        return new Response(
          "Sei offline e questa pagina non è ancora salvata su questo dispositivo. Aprila almeno una volta con internet attivo prima di andare offline.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  // Le altre risorse dell'app (icone, manifest, script da CDN): copia
  // salvata prima (veloce, funziona offline), aggiornata in background
  // quando c'è rete. Tutto il resto (chiamate a Dropbox, Google
  // Calendar, matchcenter, ecc.) NON viene toccato: passa dritto alla
  // rete come se questo Service Worker non ci fosse.
  const faParteDellApp = APP_SHELL.some(p => req.url.endsWith(p.replace("./", "/")))
    || RISORSE_ESTERNE.includes(req.url);
  if (!faParteDellApp) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const salvata = await cache.match(req);
    const aggiornamento = fetch(req).then(risposta => {
      if (risposta && (risposta.ok || risposta.type === "opaque")) cache.put(req, risposta.clone());
      return risposta;
    }).catch(() => null);
    return salvata || (await aggiornamento) || Response.error();
  })());
});
