// @lions/render/pixi -- the Pixi backend's own entry point, mirroring
// `@lions/render/three` (`three/ThreeRenderer.ts`).
//
// `PixiRenderer` used to be a static export of the package barrel
// (`index.ts`), which was fine only as long as Pixi was the sole backend
// that ever ran eagerly. Once three.js arrived behind its own lazy entry
// point (Task B1.1, see `index.ts`'s comment), the barrel's static
// `PixiRenderer` export became the mirror-image bug: every player, on
// EITHER backend, downloaded pixi.js in the main chunk merely because
// `main.ts` imported the barrel at all (for pixi-free things like
// `DebugOverlay`, `BattleAudio`, `TERRAIN_DECOR`'s type siblings). Splitting
// `PixiRenderer` out to its own entry point lets `main.ts` reach it with a
// dynamic `import('@lions/render/pixi')`, the same shape as the three.js
// branch, so the choice of backend is symmetric: whichever one a player
// does not request is never fetched.
//
// `renderer.ts` itself is untouched -- this file only changes how
// `PixiRenderer` is REACHED, not what it contains.
export { PixiRenderer } from './renderer';
