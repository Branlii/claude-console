// Service worker commun (script classique, chargé par importScripts('/_claude/sw-core.js') depuis le sw.js de l'app).
// Réseau d'abord pour la page, le code et l'API (copie gardée en cache) ; cache d'abord pour les préfixes `cacheFirst`.
// Jamais en cache : la console Claude (/api/run…), la connexion, les envois et les lectures partielles (Range).
//
//   importScripts('/_claude/sw-core.js');
//   claudeServiceWorker({ version: 'v1', shell: ['/', '/app.js', '/style.css'], cacheFirst: ['/vendor/', '/icons/'] });

/**
 * @param {{ version?: string, prefix?: string, shell?: string[], cacheFirst?: string[], skip?: string[], maxFile?: number }} [o]
 */
function claudeServiceWorker(o = {}) {
  const sw = /** @type {any} */ (self);
  const prefix = o.prefix || 'app';
  const STATIC = `${prefix}-static-${o.version || 'v1'}`;
  const DATA = `${prefix}-data-${o.version || 'v1'}`;
  const SHELL = o.shell || ['/'];
  const CACHE_FIRST = ['/_claude/vendor/', ...(o.cacheFirst || [])];
  const SKIP = ['/api/run', '/api/tts', '/login', '/healthz', '/sw.js', ...(o.skip || [])];
  const MAX_FILE = o.maxFile || 8 * 1024 * 1024;

  sw.addEventListener('install', (/** @type {any} */ e) => {
    e.waitUntil(caches.open(DATA).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => sw.skipWaiting()));
  });

  sw.addEventListener('activate', (/** @type {any} */ e) => {
    e.waitUntil(caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== DATA).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()));
  });

  sw.addEventListener('fetch', (/** @type {any} */ e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
    const p = url.pathname;
    if (SKIP.some((s) => p.startsWith(s))) return;
    if (CACHE_FIRST.some((s) => p.startsWith(s))) return e.respondWith(cacheFirst(req));
    e.respondWith(networkFirst(req));
  });

  const cacheable = (/** @type {Response} */ res) => res.ok && res.status === 200 && !res.redirected
    && Number(res.headers.get('content-length') || 0) <= MAX_FILE;

  /** @param {Request} req */
  async function cacheFirst(req) {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (cacheable(res)) (await caches.open(STATIC)).put(req, res.clone());
    return res;
  }

  /** @param {Request} req */
  async function networkFirst(req) {
    try {
      const res = await fetch(req);
      if (cacheable(res)) (await caches.open(DATA)).put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreVary: true }) || (req.mode === 'navigate' && await caches.match('/'));
      if (hit) return hit;
      if (new URL(req.url).pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'hors connexion' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }
      throw err;
    }
  }
}
