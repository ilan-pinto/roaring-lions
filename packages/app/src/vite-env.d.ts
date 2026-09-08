/// <reference types="vite/client" />

/** major.minor, injected by vite from root package.json. See vite.config.ts. */
declare const __GAME_VERSION__: string;

/** The FULL version, injected the same way -- the service worker's cache name
 *  and the `?v=` on its own URL (`service-worker.ts`). Separate from
 *  `__GAME_VERSION__` because a patch release must bust the cache and must
 *  not change the version the HUD shows. */
declare const __APP_BUILD__: string;
