// What a tile draws over its terrain -- the pixi-free half of `renderer.ts`'s
// `TERRAIN_DECOR`.
//
// Redeclared rather than imported from `renderer.ts`: `renderer.ts` imports
// pixi.js at module scope, so any static import of it -- even for a plain
// object with no pixi dependency at all -- pulls the whole Pixi runtime into
// whatever imports this file. That is the same problem `three/terrain/
// shared.ts` and `three/units/instances.ts` solved for the three.js side
// (see their own `TERRAIN_DECOR` comments); this is the barrel side of the
// same fix, needed once `PixiRenderer` itself stops being a static export of
// `@lions/render` (see `pixi.ts`) and the barrel can no longer piggyback
// TERRAIN_DECOR off an import that used to be eager anyway.
//
// `renderer.ts` is frozen for the three.js migration (byte-identical to
// `main`) and keeps its own copy at `TERRAIN_DECOR` -- this one must be kept
// byte-identical to that one by hand. `renderer.ts`'s own comment on that
// constant explains why the values are declared rather than imported from
// `@lions/data`: `@lions/render` must not depend on `@lions/data`, and
// `main.ts` is the one place importing both, holding the two to agree.
export const TERRAIN_DECOR = { none: 0, road: 1, grove: 2, knoll: 3, ridge: 4 } as const;
