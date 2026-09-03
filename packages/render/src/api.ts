/**
 * What `packages/app` is allowed to know about a renderer.
 *
 * Extracted so a second backend is possible. The surface is small for a
 * 5,000-line implementation -- eighteen methods (one of them optional) and
 * eleven properties -- and
 * that smallness is the whole reason replacing the backend is tractable.
 *
 * Types only. No implementation, no imports from Pixi or three.
 */
import type { MissionEvent, SimEvent } from '@lions/sim';
import type { Camera } from './project';
import type { EmitterSpec } from './vfx';

/** How open ground is grained. Tones are data; mark shape is drawing code. */
export type TerrainScatter = 'stone' | 'sward';

/**
 * Every tone `drawTerrain` needs, already resolved to hex by the app.
 *
 * These used to be twelve `resolveColor('dust.3')` calls scattered through
 * `drawTerrain` and `drawCanopy`, which put "what does this region look like"
 * inside the engine. The app owns the palette; the renderer owns the marks.
 */
export interface TerrainTones {
  open: string;
  cover: [string, string, string];
  blocked: string;
  underBuilding: string;
  road: string;
  rut: string;
  rock: string;
  rockLit: string;
  earth: string;
  /** The sparse low plant on open ground: dry bush, or tussock. */
  low: string;
  trunk: string;
  trunkLit: string;
  leafDark: string;
  leafMid: string;
  leafLit: string;
  /** The blade tick used by the `sward` scatter — distinct from canopy tones. */
  bladeLit: string;
  bladeShade: string;
  /** Freshly turned earth: the tunnel dig's surface spoil trail. */
  spoil: string;
  /** Crown aspect: olive is wide and squat (0.52), poplar is tall (0.95). */
  crownRatio: number;
  scatter: TerrainScatter;
}

export interface RendererOptions {
  background: string;
  /** Team marker colours by side index (0 player, 1 hostile, 2 neutral). */
  teamColors: [string, string, string];
  /** Vehicle hull colours by side index. */
  hullColors: [string, string, string];
  /** Infantry/soft-unit colours by side index — a lighter tone of the same
   *  faction ramp, so foot troops read apart from armour at gameplay zoom. */
  infantryColors: [string, string, string];
  /** Control-group colours, indexed by slot 1-9 minus one. Colours the group
   *  badge and the selection ring, so a group reads as a group on the field
   *  and not merely as "something is selected". */
  groupColors: string[];
  /** Terrain tones and grain for this map's theme. */
  terrainTones: TerrainTones;
  tracerColors: [string, string];
  /**
   * The ARCING round's own pair, by side -- a mortar bomb or a Grad rocket
   * in flight (GH-149).
   *
   * Separate from `tracerColors` because a bomb is not a bullet and the
   * project lead asked for it explicitly: the round used to be drawn from
   * `tracerColors` and so came out `vfx.tracer` green for the player, which
   * reads as a very slow tracer rather than as ordnance. `vfx.fire` /
   * `vfx.ember` is the pair. Note the HOSTILE entry is `vfx.ember` in both
   * pairs, so only the player's own indirect fire changes colour; the two
   * pairs are still distinguishable per side, which is the property that
   * matters on screen.
   *
   * Read only by the three.js backend's `ShellBatch`. `renderer.ts` (Pixi)
   * ignores it, like every other three-only VFX field -- VFX owe Pixi no
   * parity since 2026-08-30.
   */
  shellColors: [string, string];
  flashColor: string;
  nearMissColor: string;
  interceptColor: string;
  /** Resolve a palette key from structure data (e.g. "limestone.4") to hex. */
  resolveColor?: (paletteKey: string) => string;
  /**
   * URL of the ground albedo tile -- `assets/textures/desert_sand_tile.png`.
   *
   * Read only by the three.js backend, and only by the INTERPOLATED open
   * ground (`terrain/mesh.ts`'s `groundSurfaceMaterial`). `renderer.ts`
   * (Pixi) ignores it, like every other three-only field here -- see
   * `shellColors` above for the same shape and the same reason. Optional and
   * fail-soft: if it is absent, or the fetch fails, the ground draws as the
   * flat palette tone it always did and warns by name. A missing texture
   * must not cost the player a map.
   */
  groundTextureUrl?: string;
  /**
   * URL of the `^` rock-ridge albedo tile --
   * `assets/textures/rock_ground_tile.png`. Same contract as
   * `groundTextureUrl` above in every respect: three-only, read only by
   * `groundSurfaceMaterial`, optional, and fail-soft.
   */
  rockTextureUrl?: string;
}

export interface Renderer {
  // --- lifecycle
  init(host: HTMLElement): Promise<void>;
  /**
   * Draw one frame and present it.
   *
   * `alpha` is the 0..1 interpolation between sim ticks. `dtMs` is wall-clock
   * milliseconds since the previous frame, driving presentation-only animation
   * -- recoil decay, particles, death fades. The caller owns the clock and
   * passes it in: a backend that reads its own would make a frame depend on
   * when it happened to be drawn, which the Phase B golden-image diff cannot
   * work with.
   */
  frame(alpha: number, dtMs: number): void;
  /** Latch current sim positions as the previous frame's, before the next tick. */
  snapshot(): void;
  onEvents(events: SimEvent[]): void;
  /**
   * The other half of "events out": what the MISSION runtime concluded this
   * tick, as opposed to what the sim did.
   *
   * Needed because some sim state is ambiguous on its own and only the
   * runtime holds the disambiguation. The case that forced it:
   * `MissionRuntime` clears `alive` for a civilian who reaches the evacuation
   * zone, using the identical write a casualty gets -- so a renderer reading
   * only `alive` drew the crawl-and-fade death pose for a woman the player
   * had just walked to safety. The runtime's `evacuated` event is the fact
   * that distinguishes them, and invariant 4 permits exactly this shape:
   * events out, never the renderer inferring a sim conclusion from geometry.
   *
   * OPTIONAL, unlike `onEvents`, and that is deliberate rather than lazy. A
   * backend is free to have nothing that mission events could change -- Pixi
   * draws no civilians at all (no mesh path, and `civilians` is absent from
   * `SPRITE_MAP`), so an implementation there would be dead code in a file
   * that is under a freeze. `main.ts` calls it as `?.()`, so the compiler,
   * not a grep, keeps the app honest about that.
   */
  onMissionEvents?(events: readonly MissionEvent[]): void;

  // --- the surface itself
  /** The element to attach input listeners to. Callers must not ask which
   *  graphics library made it. */
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;

  // --- projection. Both directions belong to the renderer because in a 3D
  //     backend the projection IS the camera, and a caller that recomputes it
  //     becomes a second source of truth that drifts.
  //
  //     Deliberately no `lift` parameter. "Unscaled screen pixels of terrain
  //     raise" is a 2D-sprite idea; in three.js elevation is world-space, and
  //     honouring it would force every backend to reproduce Pixi's
  //     PX_PER_LEVEL convention. A backend may keep its own `lift` argument
  //     for internal use -- PixiRenderer does -- but the seam does not name it.
  worldToScreen(wx: number, wy: number): { x: number; y: number };
  screenToWorld(px: number, py: number): { x: number; y: number };

  // --- queries
  pickUnit(wx: number, wy: number, radiusTiles?: number): number;
  isVisible(wx: number, wy: number): boolean;
  /** Living units whose screen position falls inside a screen-space rect.
   *  Box-select is a projection question, so only the renderer can answer it. */
  unitsInScreenRect(x0: number, y0: number, x1: number, y1: number): number[];

  // --- world data pushed in
  setElevation(elevation: Uint8Array): void;
  setDecor(decor: Uint8Array): void;
  useEmitters(list: EmitterSpec[], resolve: (key: string) => string): void;

  // --- art. Paths and ids only: what a sheet becomes -- textures, materials,
  //     meshes -- is the backend's business, and the app never sees it.
  loadSprites(unitTypeId: string, basePath: string, opts?: { turretPath?: string }): Promise<void>;
  loadStructureSprite(structureId: string, basePath: string): Promise<void>;

  // --- presentation state the app drives
  readonly camera: Camera;
  selection: number[];
  readonly unitGroup: Uint8Array;
  hoverEntity: number;
  hoverStructure: number;
  hoverCanGarrison: boolean;
  objectiveZone: readonly number[] | null;
  objectiveZoneState: 'held' | 'unheld' | 'contested';

  addOrderMarker(x: number, y: number): void;
  setTutorialFocus(x: number, y: number, radius: number): void;
  clearTutorialFocus(): void;
}
