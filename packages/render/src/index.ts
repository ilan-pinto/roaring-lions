// @lions/render — PixiJS renderer, VFX, debug overlay.
// Subscribes to sim events; never mutates sim state (invariant 4).

export const RENDER_VERSION = 1;

export {
  PixiRenderer,
  TERRAIN_DECOR,
  type RendererOptions,
  type TerrainTones,
  type TerrainScatter,
} from './renderer';
export { DebugOverlay } from './overlay';
// ThreeRenderer is deliberately NOT re-exported here. It lives behind its own
// entry point, `@lions/render/three`, so that `import '@lions/render'` does
// not drag three.js in: while it was on this barrel, Rollup could not
// tree-shake it and every player on the Pixi default downloaded ~700 kB of a
// second renderer in the main chunk. main.ts loads it with a dynamic import,
// which only resolves when `?renderer=three` asks for it. (This reverses Task
// B1.1's brief, which specified the re-export; the brief could not anticipate
// the bundling consequence.)
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
