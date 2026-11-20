/// <reference types="vite/client" />

/** major.minor, injected by vite from root package.json. See vite.config.ts. */
declare const __GAME_VERSION__: string;

/** The FULL version, injected the same way -- the service worker's cache name
 *  and the `?v=` on its own URL (`service-worker.ts`). Separate from
 *  `__GAME_VERSION__` because a patch release must bust the cache and must
 *  not change the version the HUD shows. */
declare const __APP_BUILD__: string;

/** The commit this build was made from (hex), or '' when unknown -- a
 *  feedback note's `commit` (GH-464). See vite.config.ts. */
declare const __APP_COMMIT__: string;

/** GH-1418: the desktop demo's content cut, the mission ids it plays, or null (every build but the demo's). Baked by
 *  `vite-plugin-demo-cut.ts` from `RL_DEMO_MISSIONS`; read ONLY through `src/shell/demo-cut.ts`. */
declare const __DEMO_MISSIONS__: readonly string[] | null;
