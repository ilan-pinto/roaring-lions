/**
 * The service worker, and the only reason it exists: GitHub Pages serves
 * `Cache-Control: max-age=600` and those headers cannot be changed.
 *
 * Every `?mission=` is a full page load, so a level started eleven minutes
 * after the last one re-validates ~160 URLs before the deploy screen -- 16.6
 * MiB of meshes, textures and sheets the browser already has on disk and is
 * no longer willing to trust. This is level load time step 5
 * (`docs/superpowers/specs/2026-09-07-level-load-time-design.md`), and it is
 * the only step that helps a RETURNING player more than a new one.
 *
 * ## Read this before changing anything below
 *
 * A service worker is the one thing in this repository that can brick the
 * deployed site for a player with no way for them to recover. The rules that
 * keep that from happening, each of which is load-bearing:
 *
 *  1. **A navigation is NETWORK-FIRST, always.** `index.html` is not
 *     content-hashed, so caching it first would pin every returning player to
 *     whatever build they saw first and no deploy would ever reach them
 *     again. The cache is only a fallback, for offline.
 *  2. **The cache name carries the build version**, and `activate` deletes
 *     every cache that is not the current one. A worker that accumulated
 *     caches would grow without bound; one that reused a name across builds
 *     would serve yesterday's `publicDir` asset under today's URL forever.
 *  3. **`?nosw` in the page URL unregisters everything** (handled in
 *     `packages/app/src/service-worker.ts`, not here). That is the escape
 *     hatch a player can be told over a support channel, and the reason a bad
 *     worker is recoverable rather than permanent.
 *  4. **Range requests and `/video/` are never touched.** A 206 partial
 *     response stored in the Cache API and replayed as though it were a 200
 *     is a classic way to serve a broken media file, and the briefing videos
 *     are 6.1 MiB played once. Streaming them past the worker costs nothing.
 *  5. **Only same-origin GET.** Nothing else is inspected, let alone stored.
 *
 * ## The three strategies, and why each URL gets the one it does
 *
 *  - **`assets/` (Vite's own output)** -- CACHE-FIRST. These filenames carry
 *    a content hash, so a given URL's bytes can never change. Revalidating an
 *    immutable file is pure latency.
 *  - **The `publicDir` binaries** (`meshes/`, `textures/`, `sprites/`,
 *    `fonts/`, `audio/`, `ui/`, `campaign/`, `draco/`) -- STALE-WHILE-
 *    REVALIDATE. These are NOT hashed: re-exporting a mesh changes the bytes
 *    under the same URL. The player gets the cached copy at once and the
 *    fresh one lands in the cache for next time, which is the right trade for
 *    art that changes between releases and never mid-session.
 *  - **Everything else** -- passthrough, untouched.
 *
 * `strategyFor` below is a pure function of the URL and is where all of that
 * is decided. `sw-policy.test.ts` evaluates THIS FILE in a sandbox and drives
 * that function directly, so the thing under test is the artifact that ships
 * rather than a copy of its logic.
 */

/** Serves as both the cache name and the "is this build current" key. Comes
 *  from the `?v=` the registration appends, so a released version bump is a
 *  new cache and the old one is dropped on activate. */
const VERSION = new URL(self.location.href).searchParams.get('v') ?? 'dev';
const CACHE = `lions-${VERSION}`;

/** The app's own root, derived from where this file was served rather than
 *  hardcoded: `/` locally and `/roaring-lions/` on Pages. */
const BASE = new URL('./', self.location.href).pathname;

/** Directories under `BASE` whose contents are large, unhashed, and worth
 *  keeping. `video/` is deliberately ABSENT -- see rule 4 above. */
const PUBLIC_DIRS = ['meshes/', 'textures/', 'sprites/', 'fonts/', 'audio/', 'ui/', 'campaign/', 'draco/'];

/**
 * Which strategy a request gets: `'network-first'`, `'cache-first'`,
 * `'swr'`, or `'passthrough'`.
 *
 * `url` is a `URL`; `request` supplies `method`, `mode` and `headers`. Pure,
 * and deliberately total -- an unrecognised URL returns `'passthrough'`
 * rather than falling through to a default that stores it.
 */
function strategyFor(url, request) {
  if (request.method !== 'GET') return 'passthrough';
  if (url.origin !== self.location.origin) return 'passthrough';
  // A ranged fetch must reach the network: a 206 in the Cache API replayed as
  // a 200 is a corrupt file, and this is how the briefing videos are read.
  if (request.headers && request.headers.get && request.headers.get('range')) return 'passthrough';
  if (!url.pathname.startsWith(BASE)) return 'passthrough';

  const rest = url.pathname.slice(BASE.length);
  if (rest.startsWith('video/')) return 'passthrough';
  // `mode: 'navigate'` is the document request itself; the `index.html`
  // fallback the SPA serves for a deep link lands here too.
  if (request.mode === 'navigate') return 'network-first';
  if (rest.startsWith('assets/')) return 'cache-first';
  for (const dir of PUBLIC_DIRS) if (rest.startsWith(dir)) return 'swr';
  return 'passthrough';
}

/** Only a real, complete, same-origin 200 is worth storing. A redirect or an
 *  opaque response replayed later is how a cache starts serving something
 *  that was never the asset. */
function isCacheable(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

self.addEventListener('install', (event) => {
  // Nothing is precached -- deliberately. `publicDir` is 112 MiB and a level
  // touches ~16.6 of it, so a precache manifest would download the whole
  // game's art on a first visit to save a second visit that may never come.
  // Everything here fills on demand.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('lions-') && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  // The kill switch's second half: the page asks, the worker empties its own
  // caches and stands down. Paired with `unregister()` on the page side.
  if (event.data === 'lions:purge') {
    event.waitUntil(
      (async () => {
        for (const name of await caches.keys()) {
          if (name.startsWith('lions-')) await caches.delete(name);
        }
      })()
    );
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const strategy = strategyFor(url, event.request);
  if (strategy === 'passthrough') return;

  if (strategy === 'network-first') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(event.request);
          if (isCacheable(fresh)) (await caches.open(CACHE)).put(event.request, fresh.clone());
          return fresh;
        } catch (err) {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(event.request);
      if (cached && strategy === 'cache-first') return cached;

      const network = fetch(event.request)
        .then((fresh) => {
          if (isCacheable(fresh)) cache.put(event.request, fresh.clone());
          return fresh;
        })
        .catch((err) => {
          if (cached) return cached;
          throw err;
        });

      // Stale-while-revalidate: hand back what we have and let the refresh
      // finish on its own. `waitUntil` keeps the worker alive for it.
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    })()
  );
});
