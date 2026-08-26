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
