// Service worker: rende l'app disponibile offline.
// Strategia "stale-while-revalidate": risponde subito dalla cache e aggiorna in background.
// A ogni pubblicazione si alza CACHE: il nuovo service worker scarica tutti i file aggiornati
// e l'app propone di ricaricare.
const CACHE = 'tasca-v8';
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/analytics.js',
  'js/app.js',
  'js/bank-sync.js',
  'js/bank.js',
  'js/db.js',
  'js/format.js',
  'js/import/detect.js',
  'js/import/files.js',
  'js/import/plan.js',
  'js/insights.js',
  'js/rules.js',
  'js/state.js',
  'js/store.js',
  'js/sync.js',
  'js/theme.js',
  'js/ui/charts.js',
  'js/ui/components.js',
  'js/ui/icons.js',
  'js/ui/sheet.js',
  'js/ui/transaction-sheet.js',
  'js/views/altro.js',
  'js/views/banca.js',
  'js/views/budget.js',
  'js/views/conti.js',
  'js/views/grafici.js',
  'js/views/home.js',
  'js/views/importa.js',
  'js/views/movimenti.js',
  'js/views/regole.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' scavalca la cache del browser: così non salviamo per sbaglio file vecchi.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network;
    }),
  );
});
