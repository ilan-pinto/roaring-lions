// @lions/render — PixiJS renderer, VFX, debug overlay.
// Subscribes to sim events; never mutates sim state (invariant 4).

export const RENDER_VERSION = 1;

// PixiRenderer is deliberately NOT re-exported here, for the same reason
// ThreeRenderer never has been (comment below): it lives behind its own
// entry point, `@lions/render/pixi` (`pixi.ts`), so that `import
// '@lions/render'` does not drag pixi.js in. Before this split, EVERY
// player -- Pixi default or `?renderer=three` -- downloaded pixi.js in the
// main chunk, because `main.ts` imported `PixiRenderer` from this barrel
// statically alongside the pixi-free things below it (`DebugOverlay`,
// `TERRAIN_DECOR`, etc.), and Rollup cannot partially execute a module: any
// import of `renderer.ts` runs its `import 'pixi.js'` too. `main.ts` now
// reaches `PixiRenderer` with a dynamic `import('@lions/render/pixi')`, the
// same shape three.js already used -- see that file and `pixi.ts`.
//
// TERRAIN_DECOR moves with it, but to `./decor` rather than `./pixi`: it is
// a plain object with no pixi dependency of its own, used unconditionally
// by `main.ts` (to cross-check `@lions/data`'s `DECOR` enum) before either
// backend is chosen, so it stays a static, pixi-free export of the barrel
// rather than joining the lazy entry point. See `decor.ts`'s own comment for
// why it is redeclared rather than imported from `renderer.ts`.
export { TERRAIN_DECOR } from './decor';
export type { RendererOptions, TerrainTones, TerrainScatter, ObjectiveZoneView } from './api';
export { DebugOverlay } from './overlay';
// ThreeRenderer is deliberately NOT re-exported here. It lives behind its own
// entry point, `@lions/render/three`, so that `import '@lions/render'` does
// not drag three.js in: while it was on this barrel, Rollup could not
// tree-shake it and every player on the Pixi default downloaded ~700 kB of a
// second renderer in the main chunk. main.ts loads it with a dynamic import,
// which only resolves when `?renderer=three` asks for it. (This reverses Task
// B1.1's brief, which specified the re-export; the brief could not anticipate
// the bundling consequence.)
// The one fog-of-war gate every unit-draw path shares. It lives under
// `three/` because that is where its third and fourth callers were written,
// but it is backend-neutral by construction -- zero imports, three.js
// included, and its own doc comment records that it matches
// `PixiRenderer`'s loop bit for bit. Re-exported here because the HUD's
// minimap (GH-153) is now a caller too: a minimap decides "may I draw this
// hostile?" for every unit on the map, and a SECOND spelling of that rule in
// `packages/app` would be x-ray vision the first time the two drifted. So the
// app calls the same function rather than agreeing with it.
export { unitIsObserved } from './three/units/observed';
export { BattleAudio, type AudioManifest, type AudioSet, type AudioVariant } from './audio';
export { type EmitterSpec } from './vfx';
export type { Renderer } from './api';

// Layout constants and the shapes the app passes around -- but deliberately
// NOT `isoX`, `isoY`, `worldToScreen` or `screenToWorldFlat`. Projection is a
// question you ask the renderer (`Renderer.worldToScreen`), because in a 3D
// backend the projection IS the camera; a second exported copy of the
// arithmetic is a source of truth that drifts. `project.ts` stays package
// -internal and is imported directly by the backend that uses it.
export { TILE_W, TILE_H, type Camera, type Viewport } from './project';
