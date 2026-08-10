// Minimal PixiJS renderer for the M0 sandbox. Placeholder coloured shapes on
// a 2:1 dimetric grid. Reads sim state and subscribes to events; never writes
// back (invariant 4). The renderer interpolates 20 Hz sim states to the
// display rate — it never advances the simulation itself (invariant 1).

import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { fx, WEAPON_CLASS, type Sim, type SimEvent } from '@lions/sim';
import { SIM_HZ, advancePhase, phaseOffset, walkFps, ambientCue } from './anim';
import {
  clipOrFallback,
  frameFileName,
  parseManifest,
  parseStructureManifest,
  turretAxisOffset,
  type ClipName,
  type SheetSpec,
} from './sheet';
import { cadenceScale, resolveClip, type UnitAnimInput } from './clip';
import { EmitterLibrary, ParticleSystem, firePower, type EmitterSpec } from './vfx';

export interface RendererOptions {
  background: string;
  /** Team marker colours by side index (0 player, 1 hostile, 2 neutral). */
  teamColors: [string, string, string];
  /** Vehicle hull colours by side index. */
  hullColors: [string, string, string];
  /** Infantry/soft-unit colours by side index — a lighter tone of the same
   *  faction ramp, so foot troops read apart from armour at gameplay zoom. */
  infantryColors: [string, string, string];
  terrainOpen: string;
  terrainCover: [string, string, string];
  terrainBlocked: string;
  tracerColors: [string, string];
  flashColor: string;
  nearMissColor: string;
  interceptColor: string;
  /** Resolve a palette key from structure data (e.g. "limestone.4") to hex. */
  resolveColor?: (paletteKey: string) => string;
}

export const TILE_W = 64;
export const TILE_H = 32;

/** How long a shot's recoil takes to ease back. */
const RECOIL_SECONDS = 0.15;
/** How long a penetrating hit's flinch takes to settle. */
const FLINCH_SECONDS = 0.18;
/** Recoil travel in screen px: a main gun shoves, a rifle barely nudges. */
const RECOIL_PX_VEHICLE = 3;
const RECOIL_PX_SOFT = 1;
/** Flinch travel in screen px. */
const FLINCH_PX = 2.5;
/** Tremble amplitude in px while pinned, backing the `down` posture. */
const TREMBLE_PX = 0.5;
/** Vertical bob at the top of an infantry stride. */
const BOB_PX = 1.2;
/** Turret traverse spring: stiffness and damping, in turns/s². Tuned so a
 *  full traverse overshoots slightly and settles rather than snapping. */
const TURRET_STIFFNESS = 90;
const TURRET_DAMPING = 13;

/** Particle draw layers, indexing which Graphics a spawned particle lands
 *  on: below unit sprites (fxG) or above them (fxAboveG). */
const FX_LAYER_BELOW = 0;
const FX_LAYER_ABOVE = 1;

/** Maps an emitter's declared `layer` (schema enum: ground_decal,
 *  below_units, above_units, sky) to a draw-layer index. Unknown or absent
 *  values default to below, matching the pre-emitter puff behaviour. */
function fxLayerIndex(layer: string | undefined): number {
  return layer === 'above_units' || layer === 'sky' ? FX_LAYER_ABOVE : FX_LAYER_BELOW;
}

interface Tracer {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  ttl: number;
  side: number;
}

interface Puff {
  x: number;
  y: number;
  ttl: number;
  color: string;
  r: number;
}

/**
 * What a tile draws over its terrain.
 *
 * Declared here rather than imported: `@lions/render` must not depend on
 * `@lions/data` (the direction is app -> render -> sim, with data a leaf), and
 * this is presentation vocabulary, which is the renderer's own business.
 * `@lions/data` declares the same values for the map loader, and `main.ts` -- the
 * one place importing both -- holds the two to agree.
 */
export const TERRAIN_DECOR = { none: 0, road: 1, grove: 2, knoll: 3 } as const;

/**
 * Depth along the dimetric view axis, as an integer zIndex.
 *
 * (x + y) increases toward the viewer, so a unit standing behind a building has
 * the smaller sum, sorts first, and the building draws over it. A unit in front
 * has the larger sum and covers the building. Scaled and rounded because Pixi
 * sorts on a numeric field and float noise would make ties flicker.
 */
/** How many of a building's occupants are drawn on its roof. The pips carry the
 *  true count; more than two figures on one roof is mush. */
const ROOF_SLOTS = 2;
/** Lateral spacing between roof figures, in screen px. */
const ROOF_SPREAD_PX = 13;

function depthZ(x: number, y: number): number {
  return Math.round((x + y) * 64);
}

/** World (tile) coords → dimetric screen coords. */
export function isoX(x: number, y: number): number {
  return ((x - y) * TILE_W) / 2;
}
export function isoY(x: number, y: number): number {
  return ((x + y) * TILE_H) / 2;
}

export class PixiRenderer {
  readonly app = new Application();
  readonly camera = { x: 24, y: 24, zoom: 1 };
  selection: number[] = [];
  /** Control-group number per entity (0 = ungrouped), owned by the app. */
  readonly unitGroup: Uint8Array;
  private readonly groupLabels: Text[] = [];

  private readonly world = new Container();
  private readonly terrainG = new Graphics();
  private readonly fogG = new Graphics();
  private readonly unitsG = new Graphics();
  /** Per-tile visibility: 0 unseen, 1 explored, 2 in sight. */
  private fog!: Uint8Array;
  private fogDirty = true;
  private fogTick = 0;
  private readonly fxG = new Graphics();
  /** Wreckage sits under the living, so troops always draw over the dead. */
  private readonly wreckLayer = new Container();
  /** Buildings and units share this container so they can be depth-sorted
   *  against each other. Ground stays in terrainG below: it is flat and
   *  nothing needs to occlude it. */
  private readonly spriteLayer = new Container();
  /** One Graphics per blocked tile, rebuilt only when terrain goes dirty. */
  private buildingTiles: Graphics[] = [];
  /** Presentation-only terrain kinds, straight from the map. Never from the sim. */
  private decor: Uint8Array | null = null;
  /** Olive canopies: depth-sorted, so a soldier behind a tree is occluded by it. */
  private decorSprites: Graphics[] = [];
  /** Sprites for structures that have art; also rebuilt on terrain dirty. */
  private buildingSprites: Sprite[] = [];
  /** structure type id -> its single sprite. A building does not turn, so
   *  there are no facings: one texture is the whole sheet. */
  private structureAtlas = new Map<
    string,
    { texture: Texture; scale: number; badgeTopPx: number | null; roofTopPx: number | null }
  >();
  /** Structures already drawn this rebuild -- a footprint spans many tiles. */
  private drawnStructures = new Set<number>();
  /** above_units/sky particle layer: drawn over unit sprites (so a main-gun
   *  muzzle flash isn't hidden behind the hull that fired it) but under
   *  unitsG, so HP bars, suppression bars and selection rings stay on top. */
  private readonly fxAboveG = new Graphics();
  private sim: Sim;
  private opts: RendererOptions;

  private prevX: Float64Array;
  private prevY: Float64Array;
  private curX: Float64Array;
  private curY: Float64Array;

  /** unit type id → parsed sheet plus its textures, indexed clip → facing → frame. */
  private spriteAtlas = new Map<
    string,
    {
      sheet: SheetSpec;
      textures: Partial<Record<ClipName, Texture[][]>>;
      turretSheet?: SheetSpec;
      turretTextures?: Texture[][];
    }
  >();

  /** Spawn a named ambient emitter at a unit, seeded off the presentation PRNG. */
  private spawnAmbient(id: string, sx: number, sy: number): void {
    if (!this.particles) return;
    const em = this.emitters.byName(id);
    if (!em) return;
    const prio = em.budget_priority ?? 1;
    const fxLayer = fxLayerIndex(em.layer);
    // At the head, not the feet: a cigarette is held at face height, and the
    // anchor is the unit's ground contact point.
    const hy = sy - 26;
    for (const layer of em.particles) {
      // Upward and slightly across, which is where exhaled smoke goes. The
      // presentation PRNG inside spawn() scatters it per particle, so two squads
      // idling side by side do not puff in unison.
      this.particles.spawn(layer, sx, hy, 0.3, 0.25, prio, fxLayer);
    }
  }

  /**
   * Where a garrisoned unit draws, and whether it draws at all.
   *
   * The sim parks occupants at the structure's footprint centre
   * (`sim.ts:2237`), and a structure sprite sorts at its *far* corner, so an
   * occupant at the centre sorts underneath its own building and is invisible.
   * A held house therefore looked identical whatever was inside it, and whether
   * the garrison was shooting could not be read at all.
   *
   * Lifting them onto the roof fixes both. `badgeTopPx` is the roof line and is
   * already in every building manifest for the badge, so no new data is needed.
   *
   * Only the first `ROOF_SLOTS` occupants draw: five overlapping sprites on one
   * roof is mush, and the pips beside them stay authoritative for the count.
   */
  private static roofPlacement(
    slot: number,
    roofPx: number,
  ): { dx: number; dy: number } | null {
    if (slot < 0 || slot >= ROOF_SLOTS) return null;
    // Spread about the centre so two figures read as two.
    const spread = (slot - (ROOF_SLOTS - 1) / 2) * ROOF_SPREAD_PX;
    return { dx: spread, dy: -roofPx };
  }

  /** Facing (turns) → sprite index, in the sheet's own convention. */
  private static spriteIndex(facingNorm: number, sheet: SheetSpec): number {
    const n = sheet.facings;
    const k = Math.round(facingNorm * n) % n;
    const dir = sheet.facingReverse ? -k : k;
    return (((dir + sheet.facingOffset) % n) + n) % n;
  }
  /** Roof slot per entity, or -1: which figure this occupant is on its building's
   *  roof this frame. Presentation only; nothing in the sim knows about it. */
  private roofSlot = new Int8Array(0);
  /** Per-entity Sprite child in spriteLayer; created on demand. */
  private entitySprites: (Sprite | null)[] = [];
  /** Per-entity turret Sprite, layered above the hull sprite. */
  private turretSprites: (Sprite | null)[] = [];
  /** Per-entity fractional walk-cycle phase, in frames. Persists while
   *  stopped so gait resumes mid-stride rather than restarting on frame 1. */
  private entityAnimFrame: Float64Array;
  /** Per-entity measured ground speed in tiles/s, from the last tick's
   *  position delta. Measured rather than read off the unit type, so cover
   *  slowdowns and mobility kills pace the gait for free. */
  private entitySpeed: Float64Array;
  /** Whether an entity's phase has been given its de-sync offset yet. */
  private animSeeded: Uint8Array;
  /** Seconds left on the one-shot fire clip. Latched by the `fire` event and
   *  drained each frame; the sheet's own frames/fps sets how long it holds. */
  private firingTimer: Float64Array;
  /** Recoil: 1 at the moment of the shot, easing to 0. Direction in turns. */
  private recoilT: Float64Array;
  private recoilDir: Float64Array;
  /** Power of the shot that caused the current recoil, 0..1. */
  private recoilPower: Float64Array;
  /** Hit flinch, same shape as recoil but driven by incoming rounds. */
  private flinchT: Float64Array;
  private flinchDir: Float64Array;
  /** Turret angular velocity in turns/s, so traverse settles instead of
   *  snapping — a turret has mass, it is not a servo. */
  private turretVel: Float64Array;
  /** Per-entity turret facing (renderer-only, 0–1 normalized). */
  private turretFacing: Float64Array;

  /** Objective zone to outline: [x, y, w, h] in tiles, or null. */
  objectiveZone: readonly number[] | null = null;
  /** Zone outline colour cue: the hold is running, unheld, or contested. */
  objectiveZoneState: 'held' | 'unheld' | 'contested' = 'held';

  /** Where the tutorial is pointing, in tiles, or null. Presentation only —
   *  nothing here reads or writes sim state. */
  tutorialFocus: { x: number; y: number; radius: number } | null = null;

  setTutorialFocus(x: number, y: number, radius: number): void {
    this.tutorialFocus = { x, y, radius };
  }

  clearTutorialFocus(): void {
    this.tutorialFocus = null;
  }

  /** Structure under the cursor, -1 when none. Set by the app. */
  hoverStructure = -1;
  /** True when the current selection could garrison the hovered building. */
  hoverCanGarrison = false;
  /** Entity under the cursor, -1 when none. Set by the app. */
  hoverEntity = -1;

  private frameN = 0;
  private terrainDirty = false;
  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private readonly emitters = new EmitterLibrary();
  private particles: ParticleSystem | null = null;
  /** Units mid-collapse: still live sprites, on their way to being wreckage. */
  private dying: { x: number; y: number; facing: number; typeId: string; t: number }[] = [];
  /** Wreckage. Static sprites in wreckLayer, never touched again after the
   *  fog first reveals them; `shown` latches because explored is monotonic. */
  private wrecks: { x: number; y: number; spr: Sprite | null; shown: boolean }[] = [];
  private orderMarkers: { x: number; y: number; ttl: number }[] = [];

  /** Drop a fading move/attack order crosshair at a world point. */
  addOrderMarker(x: number, y: number): void {
    this.orderMarkers.push({ x, y, ttl: 80 });
  }

  constructor(sim: Sim, opts: RendererOptions) {
    this.sim = sim;
    this.opts = opts;
    const n = sim.capacity;
    this.prevX = new Float64Array(n);
    this.prevY = new Float64Array(n);
    this.curX = new Float64Array(n);
    this.curY = new Float64Array(n);
    this.unitGroup = new Uint8Array(n);
    this.roofSlot = new Int8Array(n);
    this.entityAnimFrame = new Float64Array(n);
    this.entitySpeed = new Float64Array(n);
    this.animSeeded = new Uint8Array(n);
    this.firingTimer = new Float64Array(n);
    this.recoilT = new Float64Array(n);
    this.recoilDir = new Float64Array(n);
    this.recoilPower = new Float64Array(n);
    this.flinchT = new Float64Array(n);
    this.flinchDir = new Float64Array(n);
    this.turretVel = new Float64Array(n);
    this.turretFacing = new Float64Array(n);
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ background: this.opts.background, resizeTo: host, antialias: true });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.terrainG);
    this.world.addChild(this.fxG);
    this.world.addChild(this.wreckLayer);
    // Depth sorting: a unit behind a building must be drawn before it, so the
    // building covers it. Without this, buildings live in terrainG below
    // everything and units render straight through tall walls.
    this.spriteLayer.sortableChildren = true;
    this.world.addChild(this.spriteLayer);
    this.world.addChild(this.fxAboveG);
    this.world.addChild(this.unitsG);
    // Fog sits above terrain and units, so unobserved ground and anything
    // standing on it are hidden together.
    this.world.addChild(this.fogG);
    this.app.stage.addChild(this.world);
    this.fog = new Uint8Array(this.sim.width * this.sim.height);
    this.drawTerrain();
    this.updateFog();
    this.drawFog();
    this.snapshot();
    this.snapshot(); // prev == cur on the first frame
  }

  /** Fetch and parse a sheet's manifest. */
  private static async loadSheet(basePath: string): Promise<SheetSpec> {
    const res = await fetch(`${basePath}manifest.json`);
    if (!res.ok) throw new Error(`sheet manifest ${res.status} at ${basePath}`);
    return parseManifest(await res.json());
  }

  /**
   * Load a unit type's sprite sheet. The sheet's manifest supplies its own
   * facing convention, draw scale and clip list, so adding a unit needs no
   * engine change — the rig that produced the files is what reports how they
   * are laid out.
   *
   * `turretPath` loads a second sheet for independent turret rotation.
   */
  async loadSprites(
    unitTypeId: string,
    basePath: string,
    opts: { turretPath?: string } = {}
  ): Promise<void> {
    const sheet = await PixiRenderer.loadSheet(basePath);
    const textures: Partial<Record<ClipName, Texture[][]>> = {};
    for (const clip of Object.keys(sheet.clips) as ClipName[]) {
      const spec = sheet.clips[clip];
      if (!spec) continue;
      // Facings load in parallel; a five-clip sheet is hundreds of files and
      // loading them one at a time is a visible stall on first mission load.
      textures[clip] = await Promise.all(
        Array.from({ length: sheet.facings }, (_, f) =>
          Promise.all(
            Array.from({ length: spec.frames }, (_, n) =>
              Assets.load<Texture>(`${basePath}${frameFileName(sheet, clip, f, n)}`)
            )
          )
        )
      );
    }

    let turretSheet: SheetSpec | undefined;
    let turretTextures: Texture[][] | undefined;
    if (opts.turretPath) {
      const tp = opts.turretPath;
      turretSheet = await PixiRenderer.loadSheet(tp);
      turretTextures = await Promise.all(
        Array.from({ length: turretSheet.facings }, (_, f) =>
          Promise.all([Assets.load<Texture>(`${tp}${frameFileName(turretSheet as SheetSpec, 'idle', f, 0)}`)])
        )
      );
    }

    this.spriteAtlas.set(unitTypeId, { sheet, textures, turretSheet, turretTextures });
  }

  /**
   * Register weapon-fire emitters. The app loads the JSON and resolves
   * palette keys, because @lions/render must not depend on @lions/data.
   */
  useEmitters(list: EmitterSpec[], resolve: (key: string) => string): void {
    this.emitters.useEmitters(list);
    this.particles = new ParticleSystem(2048, resolve);
  }

  /**
   * Load the sprite for a structure type. One frame, because a building is
   * placed with a fixed orientation under a fixed camera and never turns.
   *
   * A structure type without a sheet keeps the procedural extrusion, so art can
   * land one building at a time.
   */
  async loadStructureSprite(structureId: string, basePath: string): Promise<void> {
    const spec = parseStructureManifest(await Assets.load(`${basePath}manifest.json`));
    const texture = await Assets.load<Texture>(`${basePath}${spec.file}`);
    this.structureAtlas.set(structureId, {
      texture,
      scale: spec.scale,
      badgeTopPx: spec.badgeTopPx,
      roofTopPx: spec.roofTopPx,
    });
    this.terrainDirty = true;
  }

  /**
   * Hand the renderer the map's decor layer.
   *
   * This deliberately does not travel through `Sim`. Whether a tile draws a tree
   * or a rock changes no outcome, so a sim field would widen the state the
   * determinism hash covers for nothing, and invariant 4 exists to stop exactly
   * that kind of presentation data leaking into simulation state. The mechanical
   * half of the same tile -- its cover level -- does go through the sim, and the
   * renderer reads it from there.
   */
  setDecor(decor: Uint8Array): void {
    this.decor = decor;
    this.terrainDirty = true;
  }

  /** Copy positions after every sim tick; frame() lerps between the copies. */
  snapshot(): void {
    // Fog only needs to keep up with movement, not the tick rate.
    if (this.fog && this.fogTick++ % 4 === 0) this.updateFog();
    this.prevX.set(this.curX);
    this.prevY.set(this.curY);
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      this.curX[i] = fx.toNumber(st.posX[i]);
      this.curY[i] = fx.toNumber(st.posY[i]);
      // Ground speed measured from the tick delta rather than read off the
      // unit type, so cover slowdowns, pinning and mobility kills pace the
      // gait for free.
      const dx = this.curX[i] - this.prevX[i];
      const dy = this.curY[i] - this.prevY[i];
      this.entitySpeed[i] = Math.hypot(dx, dy) * SIM_HZ;
      // Seed turret facing to hull facing on first snapshot.
      if (this.turretFacing[i] === 0 && this.frameN === 0) {
        this.turretFacing[i] = fx.toNumber(st.facing[i]);
      }
    }
  }

  /** Feed each tick's events for transient visuals. */
  onEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.kind === 'fire') {
        // Shots at buildings carry target -1: aim the tracer at the building.
        const atStruct = e.target < 0 && e.structure !== undefined;
        const tx = atStruct ? fx.toNumber(this.sim.structures.cx[e.structure as number]) : this.curX[e.target];
        const ty = atStruct ? fx.toNumber(this.sim.structures.cy[e.structure as number]) : this.curY[e.target];
        this.tracers.push({
          sx: this.curX[e.shooter],
          sy: this.curY[e.shooter],
          tx,
          ty,
          ttl: 9,
          side: this.sim.state.side[e.shooter],
        });
        const type = this.sim.unitTypes[this.sim.state.typeIdx[e.shooter]];
        // Latch the fire clip for its own declared duration, so a sheet
        // controls how long its muzzle pose holds rather than the renderer.
        const fireClip = this.spriteAtlas.get(type.id)?.sheet.clips.fire;
        if (fireClip && fireClip.fps > 0) {
          this.firingTimer[e.shooter] = fireClip.frames / fireClip.fps;
        }
        const usesTurret = !type.isSoft && this.turretFacing.length > e.shooter;
        const facingRad = usesTurret
          ? this.turretFacing[e.shooter] * Math.PI * 2
          : fx.toNumber(this.sim.state.facing[e.shooter]) * Math.PI * 2;
        const barrelLen = type.isSoft ? 0.4 : 0.8;
        const mzX = this.curX[e.shooter] + Math.cos(facingRad) * barrelLen;
        const mzY = this.curY[e.shooter] + Math.sin(facingRad) * barrelLen;
        // Which weapon fired decides the signature — not whether the shooter
        // is soft. A tank's coax and its 120mm are the same unit and must not
        // look the same. Lookup mirrors AudioManager's.
        const wp = type.weapons.find((x) => x.id === e.weaponId);
        const cls = wp?.cls ?? WEAPON_CLASS.small_arms;
        const emitter = this.emitters.fireEmitterFor(cls);
        const power = wp ? firePower(wp) : 0;
        // Kick the shooter back along its own bearing. Without this a firing
        // tank puts muzzle smoke next to a completely inert vehicle, and the
        // shot never reads as having come from it. Demolition charges are
        // placed, not fired — a satchel charge must not make the squad lurch.
        if (cls !== WEAPON_CLASS.demolition) {
          this.recoilT[e.shooter] = 1;
          this.recoilDir[e.shooter] = facingRad / (Math.PI * 2);
          this.recoilPower[e.shooter] = power;
        }
        if (emitter && this.particles) {
          const dirTurns = facingRad / (Math.PI * 2);
          const prio = emitter.budget_priority ?? 5;
          const fxLayer = fxLayerIndex(emitter.layer);
          for (const layer of emitter.particles) {
            // direction_offset_deg rotates a layer off the firing bearing;
            // 180 is the backblast behind an RPG or ATGM.
            const offset = (layer.direction_offset_deg ?? 0) / 360;
            this.particles.spawn(layer, mzX, mzY, dirTurns + offset, power, prio, fxLayer);
          }
        } else if (type.isSoft) {
          // No emitter for this class yet: the original puffs still stand in.
          this.puffs.push({ x: mzX, y: mzY, ttl: 7, color: this.opts.flashColor, r: 5 });
        } else {
          this.puffs.push({ x: mzX, y: mzY, ttl: 4, color: this.opts.flashColor, r: 14 });
          this.puffs.push({ x: mzX, y: mzY, ttl: 8, color: this.opts.flashColor, r: 10 });
          this.puffs.push({ x: mzX, y: mzY, ttl: 18, color: '#6B6355', r: 7 });
        }
      } else if (e.kind === 'nearMiss') {
        this.puffs.push({ x: fx.toNumber(e.x), y: fx.toNumber(e.y), ttl: 14, color: this.opts.nearMissColor, r: 7 });
      } else if (e.kind === 'aps' && e.intercepted) {
        this.puffs.push({ x: this.curX[e.target], y: this.curY[e.target], ttl: 12, color: this.opts.interceptColor, r: 10 });
      } else if (e.kind === 'impact' && e.penetrated) {
        this.puffs.push({ x: this.curX[e.target], y: this.curY[e.target], ttl: 10, color: this.opts.flashColor, r: 8 });
        // Jolt the target away from the shooter, so a penetrating hit lands
        // on the unit rather than only in the roll feed.
        const dx = this.curX[e.target] - this.curX[e.shooter];
        const dy = this.curY[e.target] - this.curY[e.shooter];
        if (dx !== 0 || dy !== 0) {
          this.flinchT[e.target] = 1;
          this.flinchDir[e.target] = ((Math.atan2(dy, dx) / (Math.PI * 2)) % 1 + 1) % 1;
        }
      } else if (e.kind === 'strike') {
        const sx = fx.toNumber(e.x);
        const sy = fx.toNumber(e.y);
        for (let k = 0; k < 18; k++) {
          const a = PixiRenderer.h2(k * 11 + e.tick, k * 17 + e.tick);
          const b = PixiRenderer.h2(k * 23 + e.tick, k * 5 + e.tick);
          this.puffs.push({
            x: sx + (a - 0.5) * 4,
            y: sy + (b - 0.5) * 4,
            ttl: 20 + Math.floor(a * 20),
            color: k % 3 === 0 ? this.opts.flashColor : this.opts.nearMissColor,
            r: 10 + a * 14,
          });
        }
      } else if (e.kind === 'structureHit') {
        this.terrainDirty = true;
        const s = e.structure;
        this.puffs.push({
          x: fx.toNumber(this.sim.structures.cx[s]),
          y: fx.toNumber(this.sim.structures.cy[s]),
          ttl: 12,
          color: this.opts.nearMissColor,
          r: 9,
        });
      } else if (e.kind === 'structureDestroyed') {
        this.terrainDirty = true;
        const s = e.structure;
        const bx = fx.toNumber(this.sim.structures.cx[s]);
        const by = fx.toNumber(this.sim.structures.cy[s]);
        // A collapse throws a lot of dust.
        for (let k = 0; k < 14; k++) {
          const a = PixiRenderer.h2(k * 7 + s, k * 13 + s);
          const b = PixiRenderer.h2(k * 31 + s, k * 3 + s);
          this.puffs.push({
            x: bx + (a - 0.5) * 3,
            y: by + (b - 0.5) * 3,
            ttl: 26 + Math.floor(a * 16),
            color: this.opts.nearMissColor,
            r: 10 + a * 10,
          });
        }
      } else if (e.kind === 'destroyed') {
        // Death is a sequence, not a state: collapse first, wreckage after.
        // Facing and type are captured now because the entity slot may be
        // reused by a later spawn before the collapse finishes.
        this.dying.push({
          x: this.curX[e.entity],
          y: this.curY[e.entity],
          facing: fx.toNumber(this.sim.state.facing[e.entity]),
          typeId: this.sim.unitTypes[this.sim.state.typeIdx[e.entity]].id,
          t: 0,
        });
      }
    }
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    const cx = this.app.renderer.width / 2;
    const cy = this.app.renderer.height / 2;
    const z = this.camera.zoom;
    const sx = (px - cx) / z + isoX(this.camera.x, this.camera.y);
    const sy = (py - cy) / z + isoY(this.camera.x, this.camera.y);
    return { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W };
  }

  /** Living units whose screen position falls inside a screen-space rect. */
  unitsInScreenRect(x0: number, y0: number, x1: number, y1: number): number[] {
    const cx = this.app.renderer.width / 2;
    const cy = this.app.renderer.height / 2;
    const z = this.camera.zoom;
    const ox = cx - isoX(this.camera.x, this.camera.y) * z;
    const oy = cy - isoY(this.camera.x, this.camera.y) * z;
    const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
    const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
    const out: number[] = [];
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (this.sim.state.alive[i] === 0) continue;
      const sx = isoX(this.curX[i], this.curY[i]) * z + ox;
      const sy = isoY(this.curX[i], this.curY[i]) * z + oy;
      if (sx >= lo.x && sx <= hi.x && sy >= lo.y && sy <= hi.y) out.push(i);
    }
    return out;
  }

  /** Nearest living unit within `radiusTiles` of a world point, or -1. */
  pickUnit(wx: number, wy: number, radiusTiles = 1.2): number {
    let best = -1;
    let bestD = radiusTiles * radiusTiles;
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (this.sim.state.alive[i] === 0) continue;
      const dx = this.curX[i] - wx;
      const dy = this.curY[i] - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Fog of war (presentation only — the sim always knows everything; this is
   * what the *player* is allowed to see). Per tile: 0 never seen, 1 explored
   * but not currently observed, 2 in sight right now.
   */
  private updateFog(): void {
    const w = this.sim.width;
    const h = this.sim.height;
    const st = this.sim.state;
    const fog = this.fog;
    // Anything currently visible decays to "explored" before we re-reveal.
    for (let t = 0; t < fog.length; t++) if (fog[t] === 2) fog[t] = 1;

    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0 || st.side[i] !== 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const sight = fx.toNumber(type.sight);
      const ux = st.posX[i] / 65536;
      const uy = st.posY[i] / 65536;
      const tx = ux | 0;
      const ty = uy | 0;
      const r = Math.ceil(sight);
      for (let y = ty - r; y <= ty + r; y++) {
        if (y < 0 || y >= h) continue;
        for (let x = tx - r; x <= tx + r; x++) {
          if (x < 0 || x >= w) continue;
          const t = y * w + x;
          if (fog[t] === 2) continue;
          const dx = x + 0.5 - ux;
          const dy = y + 0.5 - uy;
          if (dx * dx + dy * dy > sight * sight) continue;
          if (this.hasSight(tx, ty, x, y)) fog[t] = 2;
        }
      }
    }
    this.fogDirty = true;
  }

  /** Bresenham LOS over the blocked grid — walls cast shadows. The wall tile
   *  itself is visible (you can see the building you're standing next to). */
  private hasSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const w = this.sim.width;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      if (x === x1 && y === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x1 && y === y1) return true;
      if (this.sim.blocked[y * w + x] !== 0) return false;
    }
  }

  /** Dark overlay for everything not currently in sight. */
  private drawFog(): void {
    const g = this.fogG;
    g.clear();
    const w = this.sim.width;
    const h = this.sim.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = this.fog[y * w + x];
        if (v === 2) continue;
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        g.poly([
          cx, cy - TILE_H / 2 - 1,
          cx + TILE_W / 2 + 1, cy,
          cx, cy + TILE_H / 2 + 1,
          cx - TILE_W / 2 - 1, cy,
        ]).fill({ color: '#0A0A08', alpha: v === 0 ? 1 : 0.55 });
      }
    }
    this.fogDirty = false;
  }

  /** True when the player can currently see this world position. */
  isVisible(wx: number, wy: number): boolean {
    const x = wx | 0;
    const y = wy | 0;
    if (x < 0 || y < 0 || x >= this.sim.width || y >= this.sim.height) return false;
    return this.fog[y * this.sim.width + x] === 2;
  }

  /** True when this position has ever been seen. Never goes back to false. */
  private isExplored(wx: number, wy: number): boolean {
    const x = wx | 0;
    const y = wy | 0;
    if (x < 0 || y < 0 || x >= this.sim.width || y >= this.sim.height) return false;
    return this.fog[y * this.sim.width + x] >= 1;
  }

  /** Seconds a unit spends collapsing before it becomes wreckage. */
  private static readonly DEATH_SECONDS = 0.4;
  /** Wreckage is permanent, so it needs a ceiling. Oldest is evicted. */
  private static readonly MAX_WRECKS = 256;
  /** Pool for the collapse animation; lives above wreckage, with the living. */
  private dyingSprites: Sprite[] = [];

  /** Sprite scale for a sheet, from its declared draw width in tiles. */
  private static sheetScale(atlas: { sheet: SheetSpec; textures: Partial<Record<ClipName, Texture[][]>> }): number {
    const idle = atlas.textures.idle as Texture[][];
    return (atlas.sheet.scale * TILE_W) / idle[0][0].width;
  }

  /**
   * Advance deaths: collapse first, then hand off to permanent wreckage.
   *
   * Wreckage is remembered terrain — it is drawn wherever the ground has ever
   * been seen, not only where the player can currently see. So you never
   * witness a kill you did not observe, but a burnt-out position you *have*
   * seen stays on the map after the fog closes over it, and a route's history
   * is readable.
   */
  private stepDeaths(dt: number, g: Graphics): void {
    for (const wk of this.wrecks) {
      if (!wk.shown && this.isExplored(wk.x, wk.y)) {
        wk.shown = true;
        if (wk.spr) wk.spr.visible = true;
      }
      // Unit types with no wreck art keep the old cross marker.
      if (!wk.spr && wk.shown) {
        const sx = isoX(wk.x, wk.y);
        const sy = isoY(wk.x, wk.y);
        g.moveTo(sx - 7, sy - 5).lineTo(sx + 7, sy + 5).stroke({ width: 3, color: '#5C625F' });
        g.moveTo(sx - 7, sy + 5).lineTo(sx + 7, sy - 5).stroke({ width: 3, color: '#5C625F' });
      }
    }

    for (const spr of this.dyingSprites) spr.visible = false;
    let slot = 0;
    for (let k = this.dying.length - 1; k >= 0; k--) {
      const d = this.dying[k];
      d.t += dt;
      const p = Math.min(1, d.t / PixiRenderer.DEATH_SECONDS);
      const atlas = this.spriteAtlas.get(d.typeId);
      if (atlas && this.isExplored(d.x, d.y)) {
        const clip = clipOrFallback(atlas.sheet, 'down');
        const rows = (atlas.textures[clip] ?? atlas.textures.idle) as Texture[][];
        while (this.dyingSprites.length <= slot) {
          const s = new Sprite({ texture: rows[0][0], anchor: 0.5 });
          this.spriteLayer.addChild(s);
          this.dyingSprites.push(s);
        }
        const spr = this.dyingSprites[slot++];
        spr.texture = rows[PixiRenderer.spriteIndex(d.facing, atlas.sheet)][0];
        // Sink, fade and tip over — a body going down, not a sprite vanishing.
        spr.position.set(isoX(d.x, d.y), isoY(d.x, d.y) + p * 3);
        spr.alpha = 1 - p * 0.5;
        spr.rotation = p * 0.14;
        spr.scale.set(PixiRenderer.sheetScale(atlas));
        spr.zIndex = depthZ(d.x, d.y);
        spr.visible = true;
      }
      if (d.t >= PixiRenderer.DEATH_SECONDS) {
        this.dying.splice(k, 1);
        this.addWreck(d.x, d.y, d.facing, d.typeId);
      }
    }
  }

  /** Place permanent wreckage. Static after creation, so it costs nothing. */
  private addWreck(x: number, y: number, facing: number, typeId: string): void {
    const atlas = this.spriteAtlas.get(typeId);
    let spr: Sprite | null = null;
    if (atlas && clipOrFallback(atlas.sheet, 'wreck') === 'wreck') {
      const rows = atlas.textures.wreck as Texture[][];
      spr = new Sprite({ texture: rows[PixiRenderer.spriteIndex(facing, atlas.sheet)][0], anchor: 0.5 });
      spr.position.set(isoX(x, y), isoY(x, y));
      spr.scale.set(PixiRenderer.sheetScale(atlas));
      this.wreckLayer.addChild(spr);
    }
    const shown = this.isExplored(x, y);
    if (spr) spr.visible = shown;
    this.wrecks.push({ x, y, spr, shown });
    while (this.wrecks.length > PixiRenderer.MAX_WRECKS) {
      const old = this.wrecks.shift();
      if (old?.spr) this.wreckLayer.removeChild(old.spr);
    }
  }

  /** Deterministic per-tile hash for ground variation — same look every run. */
  private static h2(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  private drawTerrain(): void {
    const g = this.terrainG;
    g.clear();
    // Buildings are separate display objects now, so clearing the Graphics is
    // not enough -- drop the old tiles or a rebuild stacks a second copy.
    for (const t of this.buildingTiles) this.spriteLayer.removeChild(t);
    this.buildingTiles = [];
    for (const b of this.buildingSprites) this.spriteLayer.removeChild(b);
    this.buildingSprites = [];
    for (const d of this.decorSprites) this.spriteLayer.removeChild(d);
    this.decorSprites = [];
    // A structure with art is drawn once for its whole footprint, not per tile.
    this.drawnStructures.clear();
    const w = this.sim.width;
    const h = this.sim.height;
    const H = 18; // building height in px
    // Ground tone under a sprited building. From the palette like every other
    // colour, resolved once rather than per tile.
    const underBuilding = this.opts.resolveColor
      ? this.opts.resolveColor('shadow.0')
      : this.opts.terrainBlocked;
    // Decor tones, resolved once rather than per tile. Palette keys, not literals.
    const roadTone = this.opts.resolveColor ? this.opts.resolveColor('dust.3') : '#AC8248';
    const rutTone = this.opts.resolveColor ? this.opts.resolveColor('dust.5') : '#806032';
    const rockTone = this.opts.resolveColor ? this.opts.resolveColor('limestone.6') : '#8C7659';
    const rockLit = this.opts.resolveColor ? this.opts.resolveColor('limestone.3') : '#C8B494';
    // Red-brown earth and grey-green scrub, both from the palette. terracotta was
    // added for building trim but it is exactly the colour of the exposed dirt in
    // this landscape, so it earns a second use.
    const dirtTone = this.opts.resolveColor ? this.opts.resolveColor('terracotta.2') : '#7A3B24';
    const bushTone = this.opts.resolveColor ? this.opts.resolveColor('olive.1') : '#6E7449';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = y * w + x;
        const blocked = this.sim.blocked[t] !== 0;
        const cover = this.sim.cover[t];
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        const rnd = PixiRenderer.h2(x, y);
        const diamond = [cx, cy - TILE_H / 2, cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx - TILE_W / 2, cy];

        if (blocked) {
          // Buildings are NOT drawn here. They go into spriteLayer as their own
          // display objects so they can depth-sort against units -- a soldier
          // behind a wall has to be covered by it. Drawing them into terrainG
          // would put every building under every unit unconditionally.
          const sIdx = this.sim.structureAt(x, y);
          const stype =
            sIdx >= 0 ? this.sim.structureTypes[this.sim.structures.typeIdx[sIdx]] : null;
          if (stype && this.structureAtlas.has(stype.id)) {
            // Still paint the ground. A sprite is framed to its own geometry and
            // never covers its footprint diamond exactly, so skipping this leaves
            // the page background showing through as black wedges around every
            // base. It was invisible while the mosque was the only sprited
            // building and obvious once there were seven.
            //
            // Slightly darker than open ground: what is under a building is
            // packed earth and its own shadow, not open street.
            g.poly(diamond).fill({ color: this.opts.terrainOpen, alpha: 0.92 + rnd * 0.08 });
            g.poly(diamond).fill({ color: underBuilding, alpha: 0.22 });
            // Sprited: one sprite for the whole footprint, so a 3x3 mosque is
            // one dome rather than nine. Drawn on first tile encountered.
            if (!this.drawnStructures.has(sIdx)) {
              this.drawnStructures.add(sIdx);
              this.drawStructureSprite(sIdx, stype.id);
            }
            continue;
          }
          this.drawBuildingTile(x, y, cx, cy, rnd, H, diamond);
          continue;
        }

        // Open ground: base wash with per-tile tonal variation.
        g.poly(diamond).fill({ color: this.opts.terrainOpen, alpha: 0.92 + rnd * 0.08 });

        const kind = this.decor ? this.decor[t] : TERRAIN_DECOR.none;

        if (kind === TERRAIN_DECOR.road) {
          // A street is swept, so it gets neither pebbles nor rubble -- the
          // absence of grain is most of what makes it read as a road.
          g.poly(diamond).fill({ color: roadTone, alpha: 0.85 });
          const rut = (cx + cy) % 2 === 0 ? 5 : 7;
          g.moveTo(cx - TILE_W / 2 + 6, cy - rut).lineTo(cx + TILE_W / 2 - 6, cy - rut);
          g.moveTo(cx - TILE_W / 2 + 6, cy + rut).lineTo(cx + TILE_W / 2 - 6, cy + rut);
          g.stroke({ color: rutTone, alpha: 0.30, width: 1.5 });
          continue;
        }

        if (kind === TERRAIN_DECOR.knoll) {
          // Rock, not height. The sim has no elevation, so a knoll gives cover
          // and nothing else; drawing it tall would promise a sight line it
          // cannot deliver.
          for (let k = 0; k < 4; k++) {
            const a = PixiRenderer.h2(x * 11 + k, y * 17 + k);
            const b = PixiRenderer.h2(x * 23 + k, y * 5 + k);
            const px = cx + (a - 0.5) * (TILE_W - 20);
            const py = cy + (b - 0.5) * (TILE_H - 10);
            const r = 3 + a * 5;
            g.ellipse(px, py, r, r * 0.62).fill({ color: rockTone, alpha: 0.95 });
            g.ellipse(px - r * 0.2, py - r * 0.22, r * 0.6, r * 0.36).fill({
              color: rockLit,
              alpha: 0.8,
            });
          }
          continue;
        }

        if (kind === TERRAIN_DECOR.grove) {
          // Trunk shadow flat on the ground; the canopy is a separate,
          // depth-sorted object so a unit behind the tree is occluded by it.
          g.ellipse(cx, cy + 3, 9, 4.5).fill({ color: rockTone, alpha: 0.22 });
          this.drawOliveTree(x, y, cx, cy);
          continue;
        }

        // Open hillside, not a swept plain. Reference photography of this terrain
        // is rock and dirt with sparse dry scrub: pale limestone breaking through,
        // patches of red-brown earth, and the odd bush. Three cheap passes, all
        // keyed off the tile hash so the ground is stable between rebuilds.
        // Open hillside, not a swept plain. Reference photography of this terrain
        // is rock and dirt with sparse dry scrub, and the important thing is that
        // the variation is FINE-GRAINED. A first pass drew large soft ellipses of a
        // near-base tone and they read as pale stains on the ground rather than as
        // texture -- low-contrast blobs at tile scale look like a rendering fault.
        // Small marks at high frequency read as ground; big ones do not.
        {
          const n = 3 + Math.floor(rnd * 5);
          for (let k = 0; k < n; k++) {
            const a = PixiRenderer.h2(x * 19 + k * 7, y * 23 + k * 5);
            const b = PixiRenderer.h2(x * 41 + k * 3, y * 7 + k * 11);
            const px = cx + (a - 0.5) * (TILE_W - 12);
            const py = cy + (b - 0.5) * (TILE_H - 6);
            if (b > 0.78) {
              // Exposed earth: a small dark fleck, not a wash.
              g.ellipse(px, py, 1.6 + a * 2.2, 1 + a * 1.2).fill({
                color: dirtTone,
                alpha: 0.24,
              });
            } else {
              // Limestone breaking through -- the most characteristic thing about
              // this landscape from above, and the map had none of it.
              const r = 1.2 + a * 2.6;
              g.ellipse(px, py, r, r * 0.62).fill({ color: rockLit, alpha: 0.4 + b * 0.35 });
              if (a > 0.72) {
                g.ellipse(px + r * 0.3, py + r * 0.3, r * 0.7, r * 0.42).fill({
                  color: rockTone,
                  alpha: 0.3,
                });
              }
            }
          }
        }
        if (rnd > 0.84 && cover === 0) {
          // A dry bush. Sparse, because the reference is mostly bare ground.
          const a = PixiRenderer.h2(x * 31, y * 3);
          g.ellipse(cx + (a - 0.5) * 30, cy + (rnd - 0.9) * 18, 3.2 + a * 1.4, 2 + a).fill({
            color: bushTone,
            alpha: 0.55,
          });
        }
        if (cover > 0) {
          // Cover reads as scattered rubble/sandbags, denser with level.
          const c = this.opts.terrainCover[Math.min(cover, 3) - 1];
          for (let k = 0; k < cover + 2; k++) {
            const a = PixiRenderer.h2(x * 7 + k, y * 13 + k);
            const b = PixiRenderer.h2(x * 31 + k, y * 3 + k);
            const px = cx + (a - 0.5) * (TILE_W - 18);
            const py = cy + (b - 0.5) * (TILE_H - 8);
            g.rect(px, py, 4 + a * 4, 2.5).fill({ color: c, alpha: 0.9 });
          }
        }
      }
    }
  }

  /**
   * One olive tree, as its own depth-sorted Graphics.
   *
   * Trees go in `spriteLayer` rather than the flat terrain graphics for the same
   * reason buildings do: a canopy is tall enough that a soldier standing behind
   * one must be covered by it, and terrain draws under every unit
   * unconditionally. Static, so this is rebuilt only when terrain goes dirty --
   * the same per-tile display-object cost `drawBuildingTile` already pays.
   */
  private drawOliveTree(x: number, y: number, cx: number, cy: number): void {
    // Foliage comes from the `olive` ramp, not `scrub`. Olive leaves are silvery
    // grey-green; scrub is a saturated leaf-green and reads as the wrong plant.
    const trunk = this.opts.resolveColor ? this.opts.resolveColor('dust.5') : '#806032';
    const trunkLit = this.opts.resolveColor ? this.opts.resolveColor('dust.3') : '#AC8248';
    const leafDark = this.opts.resolveColor ? this.opts.resolveColor('olive.2') : '#4E5433';
    const leafMid = this.opts.resolveColor ? this.opts.resolveColor('olive.1') : '#6E7449';
    const leafLit = this.opts.resolveColor ? this.opts.resolveColor('olive.0') : '#8F9464';
    const g = new Graphics();

    // One dominant tree per tile, sometimes a second smaller one. An olive is a
    // wide low crown on a short massive trunk -- much broader than tall -- so the
    // canopy is drawn as a squat cluster sitting close to the ground rather than a
    // ball on a stick. Getting this wrong made the first pass read as lollipops.
    const twin = PixiRenderer.h2(x * 3, y * 7) > 0.62;
    const count = twin ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const a = PixiRenderer.h2(x * 13 + k * 5, y * 29 + k * 3);
      const b = PixiRenderer.h2(x * 37 + k * 2, y * 11 + k * 7);
      const scale = k === 0 ? 1 : 0.68;
      const px = cx + (a - 0.5) * (TILE_W - 30) + (k === 0 ? 0 : 9);
      const py = cy + (b - 0.5) * (TILE_H - 16) + (k === 0 ? 0 : 4);

      // Short, thick, gnarled: two splayed stems from a flared base.
      const th = (5.5 + a * 2.5) * scale;
      const tw = 3.2 * scale;
      g.moveTo(px - tw, py)
        .lineTo(px - tw * 0.45, py - th)
        .lineTo(px + tw * 0.45, py - th)
        .lineTo(px + tw, py)
        .closePath()
        .fill({ color: trunk, alpha: 0.98 });
      g.rect(px - tw * 0.15, py - th - 1, tw * 0.5, 2).fill({ color: trunkLit, alpha: 0.5 });

      // Crown: wider than tall, in three overlapping lobes so the outline is
      // broken rather than a clean ellipse.
      const rx = (12.5 + b * 4) * scale;
      const ry = rx * 0.52;
      const top = py - th - ry * 0.62;
      g.ellipse(px, top, rx, ry).fill({ color: leafDark, alpha: 0.97 });
      g.ellipse(px - rx * 0.44, top + ry * 0.16, rx * 0.52, ry * 0.72).fill({
        color: leafDark,
        alpha: 0.97,
      });
      g.ellipse(px + rx * 0.44, top + ry * 0.2, rx * 0.46, ry * 0.66).fill({
        color: leafDark,
        alpha: 0.97,
      });
      // Sun on the upper-left, matching the 135-degree key the sprites use.
      g.ellipse(px - rx * 0.22, top - ry * 0.3, rx * 0.62, ry * 0.5).fill({
        color: leafMid,
        alpha: 0.92,
      });
      g.ellipse(px - rx * 0.38, top - ry * 0.46, rx * 0.3, ry * 0.26).fill({
        color: leafLit,
        alpha: 0.8,
      });
    }
    g.zIndex = depthZ(x + 0.5, y + 0.5);
    this.spriteLayer.addChild(g);
    this.decorSprites.push(g);
  }

  /**
   * One blocked tile, as its own Graphics in the depth-sorted sprite layer.
   *
   * Static: only rebuilt when terrain goes dirty, which is what already drives
   * the integrity darkening as a building is chewed up. There is no per-frame
   * cost beyond the sort itself.
   */
  /**
   * One sprited structure, drawn once for its whole footprint.
   *
   * Depth is taken from the footprint's NEAREST corner rather than its centre.
   * The sort key is a single number for what may be nine tiles, so some choice
   * has to be made, and the near corner is the conservative one: a unit truly in
   * front of the building still has a greater depth sum and draws over it, while
   * a unit level with the building's middle is occluded. Using the centre
   * instead would let units beside the near face incorrectly draw underneath,
   * which reads far worse -- a soldier apparently inside a wall.
   */
  private drawStructureSprite(sIdx: number, structureId: string): void {
    const art = this.structureAtlas.get(structureId);
    if (!art) return;
    const st = this.sim.structures;
    const minX = st.minX[sIdx];
    const minY = st.minY[sIdx];
    const maxX = st.maxX[sIdx];
    const maxY = st.maxY[sIdx];
    // Footprint centre, in tile coords; +1 because max is an inclusive tile.
    const fx0 = (minX + maxX + 1) / 2;
    const fy0 = (minY + maxY + 1) / 2;
    const spr = new Sprite({ texture: art.texture, anchor: 0.5 });
    spr.position.set(isoX(fx0, fy0), isoY(fx0, fy0));
    spr.scale.set((art.scale * TILE_W) / art.texture.width);
    // Battered buildings darken, exactly as the procedural extrusion does.
    const max = st.maxHp[sIdx];
    const integrity = max > 0 ? Math.max(0, st.hp[sIdx] / max) : 1;
    spr.alpha = 0.55 + 0.45 * integrity;
    spr.zIndex = depthZ(maxX + 1, maxY + 1);
    this.spriteLayer.addChild(spr);
    this.buildingSprites.push(spr);
  }

  private drawBuildingTile(
    x: number,
    y: number,
    cx: number,
    cy: number,
    rnd: number,
    fallbackHeight: number,
    diamond: number[]
  ): void {
    const sIdx = this.sim.structureAt(x, y);
    let roof = this.opts.terrainBlocked;
    let bh = fallbackHeight;
    let integrity = 1;
    if (sIdx >= 0) {
      const stype = this.sim.structureTypes[this.sim.structures.typeIdx[sIdx]];
      bh = stype.heightPx;
      roof = this.opts.resolveColor ? this.opts.resolveColor(stype.color) : roof;
      const max = this.sim.structures.maxHp[sIdx];
      if (max > 0) integrity = Math.max(0, this.sim.structures.hp[sIdx] / max);
    }
    const wear = 0.45 + 0.55 * integrity; // battered walls go dark
    const g = new Graphics();
    g.poly([cx - TILE_W / 2, cy, cx, cy + TILE_H / 2, cx, cy + TILE_H / 2 - bh, cx - TILE_W / 2, cy - bh])
      .fill({ color: '#1E1F1A', alpha: 0.9 });
    g.poly([cx + TILE_W / 2, cy, cx, cy + TILE_H / 2, cx, cy + TILE_H / 2 - bh, cx + TILE_W / 2, cy - bh])
      .fill({ color: '#3A3C33', alpha: 0.9 * wear });
    g.poly(diamond.map((v, i) => (i % 2 ? v - bh : v))).fill({ color: roof, alpha: wear });
    // Roof clutter: a water tank or vent, hash-placed. Shaken off as the
    // building is chewed up.
    if (rnd > 0.4 && integrity > 0.6) {
      g.circle(cx + (rnd - 0.5) * 18, cy - bh + (rnd - 0.5) * 8, 3).fill({ color: '#8E9491', alpha: 0.8 });
    }
    // Depth from the tile centre, the same point units are measured from.
    g.zIndex = depthZ(x + 0.5, y + 0.5);
    this.spriteLayer.addChild(g);
    this.buildingTiles.push(g);
  }

  frame(alpha: number): void {
    const dtSeconds = Math.min(this.app.ticker.deltaMS, 100) / 1000;
    this.frameN++;
    // Drain the one-shot latches before anything reads them. Recoil and
    // flinch decay over their own durations, framerate-independently.
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (this.firingTimer[i] > 0) this.firingTimer[i] = Math.max(0, this.firingTimer[i] - dtSeconds);
      if (this.recoilT[i] > 0) this.recoilT[i] = Math.max(0, this.recoilT[i] - dtSeconds / RECOIL_SECONDS);
      if (this.flinchT[i] > 0) this.flinchT[i] = Math.max(0, this.flinchT[i] - dtSeconds / FLINCH_SECONDS);
    }
    const cx = this.app.renderer.width / 2;
    const cy = this.app.renderer.height / 2;
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(
      cx - isoX(this.camera.x, this.camera.y) * this.camera.zoom,
      cy - isoY(this.camera.x, this.camera.y) * this.camera.zoom
    );

    const st = this.sim.state;
    const g = this.unitsG;
    g.clear();

    this.stepDeaths(dtSeconds, g);
    if (this.particles) this.particles.step(dtSeconds);

    // Which occupants get a roof slot, assigned once per frame in entity order so
    // the spread is stable rather than flickering between frames.
    this.roofSlot.fill(-1);
    {
      const seen = new Map<number, number>();
      for (let i = 0; i < this.sim.entityCount; i++) {
        if (st.alive[i] === 0) continue;
        const inside = st.garrisonedIn[i];
        if (inside < 0) continue;
        const n = seen.get(inside) ?? 0;
        seen.set(inside, n + 1);
        this.roofSlot[i] = n;
      }
    }

    // Hide all entity sprites first; visible ones get shown below.
    for (const spr of this.entitySprites) {
      if (spr) spr.visible = false;
    }
    for (const spr of this.turretSprites) {
      if (spr) spr.visible = false;
    }

    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0) continue;
      const x = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const y = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      // Anyone who isn't ours is only drawn while actually observed — fog
      // hides them, and losing sight loses the contact.
      if (st.side[i] !== 0 && !this.isVisible(x, y)) continue;
      // Garrisoned: lift onto the roof, or skip entirely past the slot cap.
      const inside = st.garrisonedIn[i];
      let roofDx = 0;
      let roofDy = 0;
      let roofZ = 0;
      if (inside >= 0) {
        const sTypeId = this.sim.structureTypes[this.sim.structures.typeIdx[inside]].id;
        const sArt = this.structureAtlas.get(sTypeId);
        // The roof plane, not the top of the art. badgeTopPx is the topmost opaque
        // row, which for the mosque is the tip of its minaret -- figures placed
        // there hovered above the dome rather than standing on it.
        const roofPx =
          sArt?.roofTopPx ??
          sArt?.badgeTopPx ??
          this.sim.structureTypes[this.sim.structures.typeIdx[inside]].heightPx;
        const place = PixiRenderer.roofPlacement(this.roofSlot[i], roofPx);
        if (!place) continue; // over the cap: the pips still report them
        roofDx = place.dx;
        roofDy = place.dy;
        // A structure sprite sorts at its far corner, so an occupant must clear
        // that or it draws inside its own building. +1, same trick the turret uses.
        roofZ = depthZ(this.sim.structures.maxX[inside] + 1,
                       this.sim.structures.maxY[inside] + 1) + 1;
      }
      const sx = isoX(x, y) + roofDx;
      const sy = isoY(x, y) + roofDy;
      const side = st.side[i];
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const r = type.isSoft ? 7 : 11;

      let bodyAlpha = 1;
      if (side !== 0) {
        const lvl = this.sim.contactLevel(0, i);
        bodyAlpha = lvl === 2 ? 1 : lvl === 1 ? 0.65 : 0.35;
      }

      const facingNorm = fx.toNumber(st.facing[i]);
      const atlas = this.spriteAtlas.get(type.id);

      if (atlas) {
        const sheet = atlas.sheet;
        const idle = atlas.textures.idle as Texture[][];
        // Posture is a read of sim state (GDD 5.8): pinned units go to ground,
        // broken ones run, and a sheet lacking a clip falls back to idle so
        // un-reauthored units keep working.
        const anim: UnitAnimInput = {
          alive: st.alive[i],
          routed: st.routed[i],
          pinned: st.pinned[i],
          speed: this.entitySpeed[i],
          firing: this.firingTimer[i] > 0,
        };
        const clip = clipOrFallback(sheet, resolveClip(anim));
        const spec = sheet.clips[clip];
        const nFrames = spec?.frames ?? 1;
        const clipTex = (atlas.textures[clip] ?? idle) as Texture[][];

        let frame = 0;
        if (nFrames > 1) {
          if (this.animSeeded[i] === 0) {
            this.entityAnimFrame[i] = phaseOffset(i, nFrames);
            this.animSeeded[i] = 1;
          }
          // Locomotion is paced by ground covered, so feet track the terrain
          // at any speed. Other multi-frame clips run on their own declared
          // rate. Either way the advance is by elapsed time, never by frame
          // count, so playback is independent of display refresh rate.
          const fps =
            clip === 'move'
              ? walkFps(this.entitySpeed[i], nFrames) * cadenceScale(anim)
              : spec?.fps ?? 0;
          const before = Math.floor(this.entityAnimFrame[i]);
          this.entityAnimFrame[i] = advancePhase(this.entityAnimFrame[i], fps, dtSeconds, nFrames);
          frame = Math.min(nFrames - 1, Math.floor(this.entityAnimFrame[i]));
          // Ambient VFX for the smoking idle. Fired off the clip phase, on the
          // frame the hand reaches the mouth and again as it comes away, so the
          // ember and the exhale land where the animation says they should.
          //
          // Nothing here touches sim state. Idling is not a sim event and must
          // not become one -- a cigarette in the simulation would widen the state
          // the replay hash covers for something no outcome depends on -- so the
          // renderer owns this entirely. See vfx/emitters.ts byName().
          const cue = ambientCue(clip, nFrames, before, frame);
          if (cue === 'ember') this.spawnAmbient('cigarette_ember', sx, sy);
          else if (cue === 'smoke') this.spawnAmbient('cigarette_smoke', sx, sy);
        }
        // Transform motion, applied to the sprite only — the plate, bars and
        // glyphs stay put so legibility never jitters with the art.
        let ox = 0;
        let oy = 0;
        if (this.recoilT[i] > 0) {
          // Ease-out: hardest at the shot, settling back.
          const k = this.recoilT[i] * this.recoilT[i];
          // Recoil now tracks the weapon, not the chassis: a tank's coax
          // nudges, its main gun shoves.
          const px = RECOIL_PX_SOFT + (RECOIL_PX_VEHICLE - RECOIL_PX_SOFT) * this.recoilPower[i];
          const a = this.recoilDir[i] * Math.PI * 2;
          ox -= Math.cos(a) * px * k;
          oy -= Math.sin(a) * px * k * 0.5;
        }
        if (this.flinchT[i] > 0) {
          const k = this.flinchT[i] * this.flinchT[i];
          const a = this.flinchDir[i] * Math.PI * 2;
          ox += Math.cos(a) * FLINCH_PX * k;
          oy += Math.sin(a) * FLINCH_PX * k * 0.5;
        }
        if (st.pinned[i] === 1) {
          // Deterministic per-entity jitter, so units do not tremble in unison.
          ox += Math.sin(this.frameN * 0.9 + i * 2.4) * TREMBLE_PX;
          oy += Math.cos(this.frameN * 1.1 + i * 1.7) * TREMBLE_PX;
        }
        if (clip === 'move' && type.isSoft) {
          // Two footfalls per stride, so the bob runs at twice cycle rate.
          oy -= Math.abs(Math.sin(this.entityAnimFrame[i] * Math.PI)) * BOB_PX;
        }

        // Sprite-based rendering.
        while (this.entitySprites.length <= i) this.entitySprites.push(null);
        let spr = this.entitySprites[i];
        if (!spr) {
          spr = new Sprite({ texture: idle[0][0], anchor: 0.5 });
          this.spriteLayer.addChild(spr);
          this.entitySprites[i] = spr;
        }
        const hullIdx = PixiRenderer.spriteIndex(facingNorm, sheet);
        spr.texture = clipTex[hullIdx][frame] ?? idle[hullIdx][0];
        spr.position.set(sx + ox, sy + oy);
        // Depth from the unit's own tile position, so it sorts against
        // buildings by the same rule they use.
        spr.zIndex = roofZ !== 0 ? roofZ : depthZ(x, y);
        spr.alpha = bodyAlpha;
        spr.visible = true;
        const spriteScale = (sheet.scale * TILE_W) / idle[0][0].width;
        spr.scale.set(spriteScale);

        // Turret: independent rotation sprite composited above the hull.
        if (atlas.turretTextures) {
          const target = st.curTarget[i];
          const struct = st.curStructure[i];
          const aimAtStructure = target < 0 && struct >= 0 && this.sim.structures.alive[struct] === 1;
          // With no target the turret returns to the hull's heading.
          let goalTurn = facingNorm;
          if ((target >= 0 && st.alive[target] !== 0) || aimAtStructure) {
            const ax = aimAtStructure ? fx.toNumber(this.sim.structures.cx[struct]) : this.curX[target];
            const ay = aimAtStructure ? fx.toNumber(this.sim.structures.cy[struct]) : this.curY[target];
            const dx = ax - this.curX[i];
            const dy = ay - this.curY[i];
            goalTurn = ((Math.atan2(dy, dx) / (Math.PI * 2)) % 1 + 1) % 1;
          }
          // Damped spring rather than a linear lerp, so traverse overshoots
          // slightly and settles. A turret has mass; the old lerp read as a
          // servo snapping to its setpoint.
          let delta = goalTurn - this.turretFacing[i];
          if (delta > 0.5) delta -= 1;
          if (delta < -0.5) delta += 1;
          // Explicit Euler diverges once damping * dt exceeds 1, which a
          // 100ms frame hitch would reach — so the spring integrates on a
          // bounded step even when the frame took longer.
          const sdt = Math.min(dtSeconds, 1 / 30);
          const accel = delta * TURRET_STIFFNESS - this.turretVel[i] * TURRET_DAMPING;
          this.turretVel[i] += accel * sdt;
          this.turretFacing[i] += this.turretVel[i] * sdt;
          this.turretFacing[i] = ((this.turretFacing[i] % 1) + 1) % 1;

          const tIdx = PixiRenderer.spriteIndex(this.turretFacing[i], atlas.turretSheet ?? sheet);
          while (this.turretSprites.length <= i) this.turretSprites.push(null);
          let tspr = this.turretSprites[i];
          if (!tspr) {
            tspr = new Sprite({ texture: atlas.turretTextures[0][0], anchor: 0.5 });
            this.spriteLayer.addChild(tspr);
            this.turretSprites[i] = tspr;
          }
          tspr.texture = atlas.turretTextures[tIdx][0];
          // A turret sheet is drawn at the hull's position but framed from where
          // the weapon is aiming, so it is drawn as though the whole vehicle had
          // turned — the station orbits the rig's pivot. Negligible for a
          // centre-mounted weapon, wrong for one on a pickup bed. The rig records
          // where the traverse axis lands per facing and this puts it back.
          const [axX, axY] = turretAxisOffset(atlas.turretSheet ?? sheet, hullIdx, tIdx);
          // Turret rides the hull, recoil and all. +1 so the sort keeps it
          // immediately above its own hull rather than relying on the
          // insertion order sorting has just taken away.
          tspr.position.set(sx + ox + axX * spriteScale, sy + oy + axY * spriteScale);
          tspr.zIndex = (roofZ !== 0 ? roofZ : depthZ(x, y)) + 1;
          tspr.alpha = bodyAlpha;
          tspr.visible = true;
          tspr.scale.set(spriteScale);
        }
      } else {
        // Procedural fallback.
        g.ellipse(sx, sy + 3, r + 3, (r + 3) / 2).fill({ color: '#0A0A08', alpha: 0.35 * bodyAlpha });
        const fc = facingNorm * Math.PI * 2;
        const cos = Math.cos(fc);
        const sin = Math.sin(fc);
        if (type.isKamikaze) {
        // A munition, not an aircraft: a dart with a warhead nose.
        const ah = 7;
        const nx2 = Math.cos(fc), ny2 = Math.sin(fc);
        const tipX = isoX(x + nx2 * 0.5, y + ny2 * 0.5);
        const tipY = isoY(x + nx2 * 0.5, y + ny2 * 0.5) - ah;
        const tailX = isoX(x - nx2 * 0.35, y - ny2 * 0.35);
        const tailY = isoY(x - nx2 * 0.35, y - ny2 * 0.35) - ah;
        g.moveTo(tailX, tailY).lineTo(tipX, tipY).stroke({ width: 3, color: this.opts.hullColors[side], alpha: bodyAlpha });
        g.circle(tipX, tipY, 3).fill({ color: '#E8541E', alpha: bodyAlpha });
        g.ellipse(isoX(x, y), isoY(x, y) + 2, 5, 2.5).fill({ color: '#0A0A08', alpha: 0.3 * bodyAlpha });
      } else if (type.role === 'drone') {
          const spin = this.frameN * 0.3;
          const ah = 8;
          for (const o of [0, Math.PI / 2] as const) {
            g.moveTo(sx + Math.cos(spin + o) * 8, sy - ah + Math.sin(spin + o) * 4)
              .lineTo(sx - Math.cos(spin + o) * 8, sy - ah - Math.sin(spin + o) * 4)
              .stroke({ width: 2, color: this.opts.hullColors[side], alpha: bodyAlpha });
          }
          g.circle(sx, sy - ah, 3.5).fill({ color: this.opts.hullColors[side], alpha: bodyAlpha });
          g.circle(sx, sy - ah, 3.5).stroke({ width: 1.5, color: this.opts.teamColors[side], alpha: bodyAlpha });
        } else if (type.role === 'sniper') {
        // Prone team with a long barrel: reads as static and far-reaching.
        g.ellipse(sx, sy + 3, r + 2, (r + 2) / 2).fill({ color: '#0A0A08', alpha: 0.35 * bodyAlpha });
        g.ellipse(sx, sy, r, r / 2).fill({ color: this.opts.infantryColors[side], alpha: bodyAlpha });
        g.ellipse(sx, sy, r, r / 2).stroke({ width: 1.5, color: this.opts.teamColors[side], alpha: bodyAlpha });
        const bx2 = x + Math.cos(fc) * 1.1;
        const by2 = y + Math.sin(fc) * 1.1;
        g.moveTo(sx, sy).lineTo(isoX(bx2, by2), isoY(bx2, by2)).stroke({ width: 1.5, color: '#2E2F28', alpha: bodyAlpha });
      } else if (type.isSoft) {
          // Infantry wear the lighter faction tone so foot troops never read
          // as armour at a glance.
          g.circle(sx, sy, r).fill({ color: this.opts.infantryColors[side], alpha: bodyAlpha });
          g.circle(sx, sy, r).stroke({ width: 2, color: this.opts.teamColors[side], alpha: bodyAlpha });
          const hx = x + cos * 0.4;
          const hy = y + sin * 0.4;
          g.moveTo(sx, sy).lineTo(isoX(hx, hy), isoY(hx, hy)).stroke({ width: 2.5, color: '#F2E8D5', alpha: bodyAlpha });
        } else {
          const HL = 0.55;
          const HW = 0.32;
          const pts: number[] = [];
          for (const [a, b] of [[HL, HW], [HL, -HW], [-HL, -HW], [-HL, HW]] as const) {
            const wx = x + a * cos - b * sin;
            const wy = y + a * sin + b * cos;
            pts.push(isoX(wx, wy), isoY(wx, wy));
          }
          g.poly(pts).fill({ color: this.opts.hullColors[side], alpha: bodyAlpha });
          g.poly(pts).stroke({ width: 1.5, color: this.opts.teamColors[side], alpha: bodyAlpha });
          const bx = x + cos * 0.8;
          const by = y + sin * 0.8;
          g.moveTo(sx, sy - 2).lineTo(isoX(bx, by), isoY(bx, by) - 2).stroke({ width: 2.5, color: '#2E2F28', alpha: bodyAlpha });
          g.circle(sx, sy - 2, 4.5).fill({ color: this.opts.hullColors[side], alpha: bodyAlpha });
          g.circle(sx, sy - 2, 4.5).stroke({ width: 1.5, color: '#2E2F28', alpha: 0.8 * bodyAlpha });
        }
      }

      // Seats taken, so a loaded vehicle reads as loaded.
      if (type.transportSlots > 0) {
        const aboard = this.sim.passengerCount(i);
        for (let k = 0; k < type.transportSlots; k++) {
          g.circle(sx - (type.transportSlots - 1) * 3 + k * 6, sy + r + 6, 2).fill({
            color: k < aboard ? this.opts.teamColors[side] : '#3A3C33',
            alpha: bodyAlpha,
          });
        }
      }

      // HP bar.
      const hpRatio = Math.max(0, fx.toNumber(st.hp[i]) / fx.toNumber(type.hp));
      g.rect(sx - 12, sy - r - 10, 24, 3).fill({ color: '#14150F', alpha: 0.8 });
      g.rect(sx - 12, sy - r - 10, 24 * hpRatio, 3).fill(hpRatio > 0.5 ? '#6B8A4A' : hpRatio > 0.25 ? '#E8C33A' : '#D93A2B');

      // Suppression bar (orange) — the mechanic that matters most, so it is
      // always on screen.
      const supp = Math.min(1, fx.toNumber(st.suppression[i]));
      if (supp > 0.02) {
        g.rect(sx - 12, sy - r - 6, 24 * supp, 3).fill('#FFB43C');
      }
      // Pinned/broken must be readable at a glance across the whole field:
      // a pulsing ring in the suppression colour, not just a small glyph.
      if (st.pinned[i] === 1 || st.routed[i] === 1) {
        const pulse = 0.45 + 0.35 * Math.sin(this.frameN * 0.25);
        g.ellipse(sx, sy + 2, r + 10, (r + 10) / 2).stroke({
          width: 2.5,
          color: st.routed[i] === 1 ? '#D93A2B' : '#FFB43C',
          alpha: pulse,
        });
      }
      if (st.routed[i] === 1) {
        // Broken: a white flag, running for cover.
        g.moveTo(sx + 6, sy - r - 18).lineTo(sx + 6, sy - r - 8).stroke({ width: 1.5, color: '#F2E8D5' });
        g.poly([sx + 6, sy - r - 18, sx + 13, sy - r - 15, sx + 6, sy - r - 12]).fill('#F2E8D5');
      } else if (st.pinned[i] === 1) {
        g.poly([sx - 5, sy - r - 16, sx + 5, sy - r - 16, sx, sy - r - 11]).fill('#FFB43C');
      }
      // Kill-state dots: mobility (gray) and firepower (dark red).
      if (st.mobilityKilled[i] === 1) g.circle(sx - r, sy + r - 2, 3).fill('#8E9491');
      if (st.firepowerKilled[i] === 1) g.circle(sx + r, sy + r - 2, 3).fill('#8B1E12');

      if (this.selection.includes(i)) {
        g.ellipse(sx, sy + 2, r + 7, (r + 7) / 2).stroke({ width: 2, color: '#B8FF5A' });
      }

      // Control-group badge, so the org chart is visible on the field.
      const grp = this.unitGroup[i];
      if (grp > 0) {
        let label = this.groupLabels[i];
        if (!label) {
          label = new Text({
            text: '',
            style: { fill: '#14150F', fontFamily: 'monospace', fontSize: 11, fontWeight: 'bold' },
          });
          label.anchor.set(0.5);
          this.spriteLayer.addChild(label);
          this.groupLabels[i] = label;
        }
        g.circle(sx - r - 4, sy - r - 4, 7).fill({ color: '#B8FF5A', alpha: 0.95 });
        label.text = String(grp);
        label.position.set(sx - r - 4, sy - r - 4);
        // A group badge is UI, not geometry: it must never be occluded by a
        // building the way its unit is. Above every sorted tile and sprite.
        label.zIndex = Number.MAX_SAFE_INTEGER;
        label.visible = true;
      } else if (this.groupLabels[i]) {
        this.groupLabels[i].visible = false;
      }
    }
    // Badges for units that went out of view this frame.
    for (let i = 0; i < this.groupLabels.length; i++) {
      const lb = this.groupLabels[i];
      if (lb && (st.alive[i] === 0 || this.unitGroup[i] === 0)) lb.visible = false;
    }

    if (this.terrainDirty) {
      this.terrainDirty = false;
      this.drawTerrain();
      this.fogDirty = true;
    }

    // Building status: an integrity bar once a building has been hit, and a
    // pip per man inside — you should be able to see that a house is held
    // and how close it is to coming down.
    const str = this.sim.structures;
    for (let s = 0; s < this.sim.structureCount; s++) {
      if (str.alive[s] === 0) continue;
      const bx = isoX(fx.toNumber(str.cx[s]), fx.toNumber(str.cy[s]));
      const by = isoY(fx.toNumber(str.cx[s]), fx.toNumber(str.cy[s]));
      const stype = this.sim.structureTypes[str.typeIdx[s]];
      // Height above the footprint centre to hang the badge from. `heightPx` is
      // the procedural extrusion's height and is right only for a structure with
      // no sprite: it is 34 for the mosque, whose sprite draws 250px tall, which
      // put the badge 67px inside the dome and hid the garrison pips that tell a
      // player whether the building is held.
      const art = this.structureAtlas.get(stype.id);
      const top = by - (art?.badgeTopPx ?? stype.heightPx) - 12;
      const ratio = str.maxHp[s] > 0 ? str.hp[s] / str.maxHp[s] : 1;
      if (ratio < 0.999) {
        g.rect(bx - 16, top, 32, 4).fill({ color: '#14150F', alpha: 0.85 });
        g.rect(bx - 16, top, 32 * Math.max(0, ratio), 4).fill(
          ratio > 0.6 ? '#8E9491' : ratio > 0.3 ? '#E8C33A' : '#D93A2B'
        );
      }
      const occ = str.occupants[s];
      if (occ > 0) {
        // Held building: a house badge in the holder's colour, with one pip
        // per man inside, so "who is in there and how many" reads at a glance.
        let side = 1;
        for (let i = 0; i < this.sim.entityCount; i++) {
          if (st.alive[i] === 1 && st.garrisonedIn[i] === s) {
            side = st.side[i];
            break;
          }
        }
        const col = this.opts.teamColors[side];
        const by2 = top - 16;
        g.poly([bx - 7, by2, bx, by2 - 6, bx + 7, by2]).fill({ color: col }); // roof
        g.rect(bx - 5, by2, 10, 8).fill({ color: col }); // walls
        g.rect(bx - 1.5, by2 + 3, 3, 5).fill({ color: '#14150F' }); // doorway
        for (let k = 0; k < occ; k++) {
          g.circle(bx - (occ - 1) * 3 + k * 6, by2 + 12, 2).fill({ color: col });
        }
      }

      // Hover affordance: an arrow walking into a doorway, shown when the
      // selection could actually move in. It answers "can I garrison this?"
      // before the click rather than after.
      if (s === this.hoverStructure && this.hoverCanGarrison) {
        const pulse = 0.55 + 0.45 * Math.sin(this.frameN * 0.12);
        const hy = top - 34;
        g.rect(bx + 2, hy - 9, 11, 18).stroke({ width: 2, color: '#B8FF5A', alpha: pulse });
        g.rect(bx + 2, hy - 9, 3, 18).fill({ color: '#B8FF5A', alpha: pulse }); // door jamb
        g.moveTo(bx - 14, hy).lineTo(bx - 2, hy).stroke({ width: 2.5, color: '#B8FF5A', alpha: pulse });
        g.poly([bx - 2, hy - 5, bx + 4, hy, bx - 2, hy + 5]).fill({ color: '#B8FF5A', alpha: pulse });
      }
    }

    // Demolition charges being set: a ring that closes as the timer runs.
    for (let i = 0; i < this.sim.entityCount; i++) {
      if (st.alive[i] === 0) continue;
      const prog = this.sim.demolitionProgress(i);
      if (prog <= 0) continue;
      const px = isoX(this.curX[i], this.curY[i]);
      const py = isoY(this.curX[i], this.curY[i]);
      g.ellipse(px, py, 20, 10).stroke({ width: 2, color: '#5C625F', alpha: 0.5 });
      g.ellipse(px, py, 20 * prog, 10 * prog).stroke({ width: 3, color: '#E8541E', alpha: 0.9 });
    }

    // Weapon envelopes for the selection (GDD §5.8): solid ring at effective
    // range where accuracy holds up, faint ring at maximum reach, and an
    // inner ring for weapons with a minimum range (mortars can't shoot close).
    // A world circle maps to an axis-aligned ellipse in 2:1 dimetric.
    const ISO_K = Math.SQRT1_2;
    for (const i of this.selection) {
      if (st.alive[i] === 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      if (type.weapons.length === 0) continue;
      const ux = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const uy = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      const ex = isoX(ux, uy);
      const ey = isoY(ux, uy);
      const ring = (tiles: number, color: string, width: number, a: number): void => {
        if (tiles <= 0) return;
        g.ellipse(ex, ey, tiles * TILE_W * ISO_K, tiles * TILE_H * ISO_K).stroke({
          width,
          color,
          alpha: a,
        });
      };
      const w0 = type.weapons[0];
      ring(fx.toNumber(w0.range), this.opts.teamColors[st.side[i]], 1, 0.28);
      ring(fx.toNumber(w0.effectiveRange), this.opts.teamColors[st.side[i]], 1.5, 0.5);
      ring(Math.sqrt(fx.toNumber(w0.minRangeSq)), '#D93A2B', 1, 0.35);
    }

    // Engagement reticles: brackets on whatever the selected units are
    // shooting at, with a faint line so the duel is readable at a glance.
    for (const i of this.selection) {
      if (st.alive[i] === 0 || st.side[i] !== 0) continue;
      const t = st.curTarget[i];
      if (t < 0 || st.alive[t] === 0) continue;
      const tx = this.prevX[t] + (this.curX[t] - this.prevX[t]) * alpha;
      const ty = this.prevY[t] + (this.curY[t] - this.prevY[t]) * alpha;
      const rx = isoX(tx, ty);
      const ry = isoY(tx, ty);
      const R = 15;
      const c = this.opts.teamColors[1];
      for (const [mx, my] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g.moveTo(rx + mx * R, ry + my * (R / 2) - my * 4)
          .lineTo(rx + mx * R, ry + my * (R / 2))
          .lineTo(rx + mx * R - mx * 7, ry + my * (R / 2))
          .stroke({ width: 2, color: c });
      }
      const sx0 = isoX(this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha, this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha);
      const sy0 = isoY(this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha, this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha);
      g.moveTo(sx0, sy0).lineTo(rx, ry).stroke({ width: 1, color: c, alpha: 0.35 });
    }

    // The ground the mission is actually about. Without this the player is
    // told to 'hold the western approach' and has to guess where that is.
    if (this.objectiveZone) {
      const [zx, zy, zw, zh] = this.objectiveZone;
      const color =
        this.objectiveZoneState === 'contested'
          ? '#D93A2B'
          : this.objectiveZoneState === 'unheld'
            ? '#E8C33A'
            : '#B8FF5A';
      const pulse = this.objectiveZoneState === 'held' ? 0.3 : 0.35 + 0.25 * Math.sin(this.frameN * 0.09);
      const corners: [number, number][] = [
        [zx, zy],
        [zx + zw, zy],
        [zx + zw, zy + zh],
        [zx, zy + zh],
      ];
      const pts: number[] = [];
      for (const [cx2, cy2] of corners) {
        pts.push(isoX(cx2, cy2), isoY(cx2, cy2));
      }
      g.poly(pts).stroke({ width: 2, color, alpha: pulse + 0.25 });
      g.poly(pts).fill({ color, alpha: 0.05 });
    }

    // Where the tutorial is pointing. Presentation only — reads no sim state
    // beyond the camera projection.
    if (this.tutorialFocus) {
      const { x: fx2, y: fy2, radius } = this.tutorialFocus;
      const color = this.opts.resolveColor ? this.opts.resolveColor('vfx.tracer') : '#B8FF5A';
      const pulse = 0.35 + 0.25 * Math.sin(this.frameN * 0.09);
      const ringPts: number[] = [];
      const segments = 24;
      for (let k = 0; k < segments; k++) {
        const theta = (k / segments) * Math.PI * 2;
        const rx = fx2 + radius * Math.cos(theta);
        const ry = fy2 + radius * Math.sin(theta);
        ringPts.push(isoX(rx, ry), isoY(rx, ry));
      }
      g.poly(ringPts, true).stroke({ width: 2, color, alpha: pulse + 0.25 });
    }

    // Queued route for the selection: the path you drew, in order.
    for (const i of this.selection) {
      if (st.alive[i] === 0 || st.moving[i] === 0) continue;
      const n = this.sim.waypointCount(i);
      let px = isoX(this.curX[i], this.curY[i]);
      let py = isoY(this.curX[i], this.curY[i]);
      const legs: [number, number][] = [];
      legs.push([fx.toNumber(this.sim.state.posX[i]), fx.toNumber(this.sim.state.posY[i])]);
      const goal = this.sim.goalOf(i);
      legs.push([fx.toNumber(goal[0]), fx.toNumber(goal[1])]);
      for (let k = 0; k < n; k++) {
        const [wx, wy] = this.sim.waypointAt(i, k);
        legs.push([fx.toNumber(wx), fx.toNumber(wy)]);
      }
      for (let k = 1; k < legs.length; k++) {
        const ax = isoX(legs[k - 1][0], legs[k - 1][1]);
        const ay = isoY(legs[k - 1][0], legs[k - 1][1]);
        const bx = isoX(legs[k][0], legs[k][1]);
        const by = isoY(legs[k][0], legs[k][1]);
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 1.5, color: '#B8FF5A', alpha: 0.35 });
        g.circle(bx, by, 3).fill({ color: '#B8FF5A', alpha: 0.55 });
      }
      px = 0;
      py = 0;
      void px;
      void py;
    }

    // Order crosshairs fade out where the last command pointed.
    this.orderMarkers = this.orderMarkers.filter((m) => --m.ttl > 0);
    for (const m of this.orderMarkers) {
      const mx = isoX(m.x, m.y);
      const my = isoY(m.x, m.y);
      const a = m.ttl / 80;
      const s = 10 + (1 - a) * 6;
      g.moveTo(mx - s, my).lineTo(mx - 4, my).stroke({ width: 2, color: '#B8FF5A', alpha: a });
      g.moveTo(mx + 4, my).lineTo(mx + s, my).stroke({ width: 2, color: '#B8FF5A', alpha: a });
      g.moveTo(mx, my - s / 2).lineTo(mx, my - 2).stroke({ width: 2, color: '#B8FF5A', alpha: a });
      g.moveTo(mx, my + 2).lineTo(mx, my + s / 2).stroke({ width: 2, color: '#B8FF5A', alpha: a });
      g.ellipse(mx, my, s + 4, (s + 4) / 2).stroke({ width: 1.5, color: '#B8FF5A', alpha: a * 0.6 });
    }

    if (this.fogDirty) this.drawFog();

    // Smoke screens, drawn over the ground and under the units so troops
    // inside one still read — it obscures, it does not delete them.
    for (let y = 0; y < this.sim.height; y++) {
      for (let x = 0; x < this.sim.width; x++) {
        const d = this.sim.smoke[y * this.sim.width + x];
        if (d === 0) continue;
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        g.poly([
          cx, cy - TILE_H / 2,
          cx + TILE_W / 2, cy,
          cx, cy + TILE_H / 2,
          cx - TILE_W / 2, cy,
        ]).fill({ color: '#C9CBC4', alpha: (d / 255) * 0.72 });
      }
    }

    // Transient FX.
    const fg = this.fxG;
    fg.clear();
    this.fxAboveG.clear();
    this.tracers = this.tracers.filter((t) => --t.ttl > 0);
    for (const t of this.tracers) {
      fg.moveTo(isoX(t.sx, t.sy), isoY(t.sx, t.sy) - 4)
        .lineTo(isoX(t.tx, t.ty), isoY(t.tx, t.ty) - 4)
        .stroke({ width: 1.5, color: this.opts.tracerColors[t.side], alpha: t.ttl / 9 });
    }
    this.puffs = this.puffs.filter((p) => --p.ttl > 0);
    for (const p of this.puffs) {
      fg.circle(isoX(p.x, p.y), isoY(p.x, p.y) - 3, p.r * (1.4 - p.ttl / 14)).fill({
        color: p.color,
        alpha: (p.ttl / 14) * 0.8,
      });
    }
    if (this.particles) {
      this.particles.draw(fg, isoX, isoY, FX_LAYER_BELOW);
      this.particles.draw(this.fxAboveG, isoX, isoY, FX_LAYER_ABOVE);
    }
  }
}
