// @lions/render — PixiJS renderer, VFX, debug overlay.
// Subscribes to sim events; never mutates sim state (invariant 4).

export const RENDER_VERSION = 1;

export { PixiRenderer, TILE_W, TILE_H, isoX, isoY, type RendererOptions } from './renderer';
export { DebugOverlay, type MissionView } from './overlay';
export { BattleAudio, type AudioManifest, type AudioSet, type AudioVariant } from './audio';
