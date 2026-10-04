// What a tile draws over its terrain, as the numbers the decor array holds.
//
// Declared rather than imported from `@lions/data`: `@lions/render` must not
// depend on `@lions/data`, and `main.ts` is the one place importing both,
// holding the two to agree (its divergence guard covers the whole enum).
// `three/terrain/shared.ts` and `three/units/instances.ts` carry their own
// copies for the bundle reason their comments give.
//
// This file was the pixi-free half of `renderer.ts`'s copy, split out so the
// barrel never dragged pixi.js in; `renderer.ts` went with the Pixi backend
// (WP-A3.3), and this is now the barrel's only copy.
export const TERRAIN_DECOR = {
  none: 0,
  road: 1,
  grove: 2,
  knoll: 3,
  ridge: 4,
  /** An anti-tank ditch tile (`d`). */
  ditch: 5,
} as const;
