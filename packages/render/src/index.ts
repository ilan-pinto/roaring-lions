// @lions/render — PixiJS renderer, VFX, debug overlay.
// Subscribes to sim events; never mutates sim state (invariant 4).

export const RENDER_VERSION = 1;

export {
  PixiRenderer,
  TILE_W,
  TILE_H,
  TERRAIN_DECOR,
  isoX,
  isoY,
  type RendererOptions,
  type TerrainTones,
  type TerrainScatter,
} from './renderer';
export { DebugOverlay } from './overlay';
export { BattleAudio, type AudioManifest, type AudioSet, type AudioVariant } from './audio';
export { type EmitterSpec } from './vfx';
export type { Renderer } from './api';
export { worldToScreen, screenToWorldFlat, type Camera, type Viewport } from './project';
