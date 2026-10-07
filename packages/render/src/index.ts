// @lions/render -- the three.js renderer's static surface, VFX types, audio,
// the debug overlay. Subscribes to sim events; never mutates sim state
// (invariant 4).

export const RENDER_VERSION = 1;

// The renderer itself is NOT exported here: `ThreeRenderer` lives behind its
// own entry point, `@lions/render/three`, so `import '@lions/render'` never
// drags three.js into the main chunk (comment below). Until WP-A3.3 a second
// backend, `PixiRenderer`, had its own door too (`@lions/render/pixi`); it is
// deleted.
//
// TERRAIN_DECOR is a plain object, used unconditionally by `main.ts` (to
// cross-check `@lions/data`'s `DECOR` enum) before the renderer is built, so
// it stays a static export of the barrel -- see `decor.ts`.
export { TERRAIN_DECOR } from './decor';
export type { RendererOptions, TerrainTones, TerrainScatter, OpenScatter, GroveFamily, ObjectiveZoneView, TimeOfDay, BuildingFit } from './api';
// Backend-neutral by construction (no three import -- see the file's own
// header), so it stays a static export of the barrel like `TERRAIN_DECOR`
// rather than joining a lazy entry point. `main.ts` reads `QUALITY_PRESETS`
// to translate `Settings.video.quality` into `RendererOptions.quality`
// before the renderer's chunk has loaded.
export { QUALITY_PRESETS, type RenderQuality } from './quality';
export { DebugOverlay } from './overlay';
// ThreeRenderer is deliberately NOT re-exported here. It lives behind its own
// entry point, `@lions/render/three`, so that `import '@lions/render'` does
// not drag three.js in: while it was on this barrel, Rollup could not
// tree-shake it and every player then on the Pixi default downloaded ~700 kB
// of a second renderer in the main chunk. main.ts loads it with a dynamic
// import. (This reverses Task B1.1's brief, which specified the re-export;
// the brief could not anticipate the bundling consequence.)
// The one fog-of-war gate every unit-draw path shares. It lives under
// `three/` because that is where its third and fourth callers were written,
// but it is backend-neutral by construction -- zero imports, three.js
// included. Re-exported here because the HUD's
// minimap (GH-153) is now a caller too: a minimap decides "may I draw this
// hostile?" for every unit on the map, and a SECOND spelling of that rule in
// `packages/app` would be x-ray vision the first time the two drifted. So the
// app calls the same function rather than agreeing with it.
export { unitIsObserved } from './three/units/observed';
export {
  BattleAudio,
  PLACEHOLDER_HZ,
  VOICE_DECODE_BUDGET_BYTES,
  type AudioGains,
  type AudioManifest,
  type AudioSet,
  type AudioVariant,
  type CueEntry,
  type CueResult,
  type MusicScene,
  type VoiceManifest,
  type AnnouncementDef,
  type AnnouncementManifest,
  type VoicePlay,
  type VoicePriority,
  type VoiceResult,
  type VoiceStats,
  type VoiceStatus,
  type VoiceVariant,
} from './audio';
export { type EmitterSpec } from './vfx';
export type { Renderer } from './api';

// Layout constants and the shapes the app passes around -- but deliberately
// NOT `isoX`, `isoY`, `worldToScreen` or `screenToWorldFlat`. Projection is a
// question you ask the renderer (`Renderer.worldToScreen`), because in a 3D
// backend the projection IS the camera; a second exported copy of the
// arithmetic is a source of truth that drifts. `project.ts` stays package
// -internal and is imported directly by the backend that uses it.
export { TILE_W, TILE_H, type Camera, type Viewport } from './project';
