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
// `main`) and keeps its own copy at `TERRAIN_DECOR`. This one used to be kept
// byte-identical to that one by hand; as of `ditch` it is deliberately a
// SUPERSET, and that is the whole divergence.
//
// Why that is safe rather than the drift the old rule guarded against: the
// two copies still agree on every value Pixi can act on (0-4), and the Pixi
// backend never receives `TERRAIN_DECOR.ditch` by name -- it reads raw
// numbers out of the decor array through `if (kind === TERRAIN_DECOR.road)`
// style chains, so a 5 falls through all of them and a `d` tile draws as
// plain ground there. Pixi has no decor-mesh path at all (a permanent
// property of that backend, not a gap), so there is nothing for it to draw
// and nothing for a matching constant to unlock. Adding the value here
// instead of to the frozen file is what lets `main.ts`'s divergence guard
// keep covering the whole enum rather than silently stopping at `ridge`.
//
// `renderer.ts`'s own comment on that constant explains why the values are
// declared rather than imported from `@lions/data`: `@lions/render` must not
// depend on `@lions/data`, and `main.ts` is the one place importing both,
// holding the two to agree.
export const TERRAIN_DECOR = {
  none: 0,
  road: 1,
  grove: 2,
  knoll: 3,
  ridge: 4,
  /** Three-only: an anti-tank ditch tile. See the note above on why this is
   *  absent from `renderer.ts`'s frozen copy rather than added to it. */
  ditch: 5,
} as const;
