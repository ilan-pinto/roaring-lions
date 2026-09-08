/**
 * Registering (and un-registering) the service worker -- the page half of
 * `assets/sw.js`. Level load time, step 5.
 *
 * Three decisions live here rather than in the worker:
 *
 * **Production only.** In dev the worker would sit between Vite and the page
 * and fight HMR for every module it is entitled to cache. `import.meta.env.
 * PROD` is a build-time constant, so the dev bundle does not even carry the
 * registration.
 *
 * **The version rides in the URL.** `sw.js?v=<version>` -- the browser treats
 * a byte-different worker URL as a new worker, and the worker reads the same
 * `v` back out to name its cache (`lions-<version>`), dropping every other
 * `lions-` cache on activate. One string does both jobs, so a released
 * version bump cannot leave a stale cache behind and cannot leave a stale
 * worker running.
 *
 * **`?nosw` is the escape hatch, and it is why this is recoverable.** A
 * service worker that ships broken can otherwise pin a player to it with no
 * way out. `?nosw` purges every `lions-` cache and unregisters every worker
 * on this scope, and it runs BEFORE any registration so it cannot race the
 * thing it is undoing. Tell a stuck player to add it to the URL once.
 */

/** True when the page was asked to stand the worker down. Exported so
 *  `main.ts` can say so in the console rather than leaving a player who typed
 *  it wondering whether anything happened. */
export function serviceWorkerDisabled(search: string): boolean {
  return new URLSearchParams(search).has('nosw');
}

/**
 * Unregisters every worker on this scope and empties every `lions-` cache.
 * Resolves even when the browser has no support or no permission -- this is
 * the recovery path, and it must not be the thing that throws.
 */
export async function unregisterServiceWorker(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    }
    if ('caches' in globalThis) {
      for (const name of await caches.keys()) if (name.startsWith('lions-')) await caches.delete(name);
    }
  } catch (err) {
    console.warn('[lions] could not unregister the service worker:', err);
  }
}

/**
 * Registers the worker, unless this is a dev build or the page asked for
 * `?nosw`. Never rejects: a browser with the API behind a flag, a private
 * window that refuses registration, or an insecure origin all leave the game
 * working exactly as it does today, which is the whole contract -- the worker
 * is a cache, and a cache that will not start costs nothing but the speed it
 * was going to buy.
 */
export async function registerServiceWorker(base: string, search: string): Promise<void> {
  if (serviceWorkerDisabled(search)) {
    await unregisterServiceWorker();
    console.info('[lions] ?nosw — service worker unregistered and its caches purged');
    return;
  }
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(`${base}sw.js?v=${__APP_BUILD__}`, { scope: base });
  } catch (err) {
    // Warn by name rather than silently: a registration that fails on the
    // deployed site is the difference between step 5 working and not, and
    // nothing else on screen would ever show it.
    console.warn('[lions] service worker registration failed; running without it:', err);
  }
}
