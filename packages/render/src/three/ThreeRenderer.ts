/**
 * The three.js backend. Phase B1 got it on screen with nothing but the clear
 * colour; Phase B2.4 adds the first drawn geometry -- terrain, built lazily
 * from `buildGround` (see `rebuildTerrain` below) and uploaded once per
 * change via `toGeometry`/`terrainMaterial`. Phase B3.5 adds the second:
 * living units, one `THREE.InstancedMesh` per loaded unit type
 * (`units/instances.ts`), fed a fresh `EntityFrame` per living entity every
 * frame (`units/frame-state.ts`) from real per-entity position tracking this
 * class now owns (`prevX`/`curX`/etc. below, populated by `snapshot`).
 *
 * Three kinds of not-yet-implemented member, and the line between them is the
 * whole discipline of this phase: *inventing an answer* is forbidden;
 * *reporting the current state truthfully* is not.
 *
 *  - **Data pushed in** *retains* its argument and returns:  `setElevation`,
 *    `loadStructureSprite`, and `setTutorialFocus`/
 *    `clearTutorialFocus` (a focus ring is state, not a one-shot). The data
 *    has arrived and is correct; it simply is not drawn until B4 (structure
 *    sprites) or is presentation-only Phase C state (`setTutorialFocus`).
 *    `setDecor` and `loadSprites` graduated out of this bucket in B2.6 and
 *    B3.5 respectively -- both now draw what they are given, immediately or
 *    on the next `frame()`. `useEmitters` graduated fully in Task B3.14: it
 *    wires its `EmitterSpec[]` into a real `EmitterLibrary` and constructs a
 *    real `ParticleSystem` from `resolve`, and (since B3.14) `onEvents`
 *    actually SPAWNS into both -- see the next bullet.
 *  - **Truthful no-ops**, where "nothing to do" is the honest answer rather
 *    than a dodge: `addOrderMarker` (a one-shot with no state worth
 *    keeping), and `isVisible`, which returns `true` because fog is B4 and a
 *    backend with no fog hides nothing. `snapshot` graduated out of this
 *    bucket in B3.5: it now latches per-entity position and measures ground
 *    speed, the same job Pixi's own `snapshot` does, because `frame()` needs
 *    both to draw a single moving unit. `onEvents` graduated out of this
 *    bucket in Task B3.14: it now wires seven of Pixi's nine event kinds --
 *    `fire`, `impact`, `nearMiss`, `aps`, `strike`, `destroyed`,
 *    `tunnelCollapsed` -- muzzle flashes, tracers, impact effects, the death
 *    fade, and the recoil/flinch latches `drainTimers` decays. Two kinds
 *    remain genuinely unhandled, not merely deferred by this comment:
 *    `structureHit`/`structureDestroyed`, both barred until Task B3.9 makes
 *    the terrain rebuild they trigger incremental (see `onEvents`'s own doc
 *    comment for the cost that forces this).
 *  - **Throws**: this bucket is now empty. `pickUnit` and `unitsInScreenRect`
 *    were the only two members that would have had to *fabricate* -- `-1`
 *    and `[]` both mean "you clicked empty ground", the player acts on that,
 *    and it would be believed -- so they threw rather than invent an answer.
 *    Task B3.8 implements both for real, ported from `PixiRenderer`'s own
 *    members into pure functions (`units/pick.ts`) this class merely calls.
 *    The ruling that sent it: `pickUnit` is NOT a projection question --
 *    Pixi's version is a nearest-entity search over `curX`/`curY` in WORLD
 *    coordinates, with no projection inside it at all; only
 *    `unitsInScreenRect` genuinely projects. Neither needs a GPU or a
 *    raycast, so both are tested in `environment: 'node'` exactly like
 *    `frame-state.ts`'s own `entityFrame`.
 *
 * The rule that catches these: any member reached from the 60 Hz frame loop,
 * the 20 Hz tick loop, or a block whose tail matters must not throw unless
 * fabricating is the only alternative. Two rounds of review found members that
 * broke it -- `isVisible` in the frame loop, the tutorial focus pair in the
 * tick loop -- so weigh that before adding a `notYet` to anything new.
 *
 * ## What B3.5 deliberately does not draw, and what Task B3.14 added to it
 *
 * `units/frame-state.ts`'s landed `EntityFrame` carries what B3.3 decided a
 * unit needs: position, ground/roof lift, clip, frame, facing, body alpha.
 * Task B3.14 EXTENDS `EntityFrameInput` (frame-state.ts was explicitly not
 * barred for this task, unlike B3.5) with `recoilT`/`recoilDir`/
 * `recoilPower`/`flinchT`/`flinchDir` -- both `firing`'s one-shot pose
 * (latched here, from `onEvents`'s `fire` case) and the recoil/flinch
 * screen-space nudges Pixi's own unit loop applies (`renderer.ts:2044-2063`)
 * are drawn now, event-fed exactly like Pixi.
 *
 * Everything ELSE Pixi's unit loop draws beyond what `EntityFrame` carries
 * is still out of scope: pinned TREMBLE and footfall BOB (both continuous,
 * driven every frame off `Sim` state or clip phase directly, not by an
 * event -- this task's brief scopes it to "the recoil and flinch decay
 * timers `frame()` drains", not every screen-space nudge Pixi's unit loop
 * ever applies), air-lift for `isAir` types (the sim's own `UnitType` doc
 * comment calls this "presentation" and names the renderer as the thing
 * that lifts it -- `frame-state.ts` does not), and the procedural-primitive
 * fallback for a unit type with no loaded sheet.
 *
 * Turret sprites (Task B3.6) DID land, closing the one item in this list
 * that B3.14 could not: every shot's muzzle/recoil bearing now reads turret
 * facing, not hull facing, for a unit type with turret art loaded
 * (`onFire` below, and `frame-state.ts`'s own `EntityFrame.turretFacing`).
 * Everything else in this paragraph is unaffected.
 *
 * A unit type with no loaded sheet simply is not drawn: "no mesh
 * units" (the B3 brief's own scope line) rules out inventing a placeholder
 * shape for it the way Pixi's circle fallback does -- and the same rule now
 * also governs a DYING unit with no loaded sheet (`stepDeaths`, Task
 * B3.14): it is silently skipped, not drawn as a placeholder either.
 */
import * as THREE from 'three';
import { fx, WEAPON_CLASS, type Fx, type Sim, type SimEvent } from '@lions/sim';
import type { Renderer, RendererOptions } from '../api'; // both, after Step 2
import { WORLD_Y_PER_LIFT_PIXEL, type Camera } from '../project';
import { EmitterLibrary, ParticleSystem, firePower, type EmitterSpec, type ParticleSpec } from '../vfx';
import { SIM_HZ } from '../anim';
import { parseManifest, clipOrFallback, type SheetSpec } from '../sheet';
import type { UnitAnimInput } from '../clip';
import { dimetricCamera, worldToScreenThree, screenToWorldThree } from './camera';
import { applyPalettePipeline } from './palette-material';
import { buildGround } from './terrain/ground';
import { buildScatter } from './terrain/scatter';
import { buildGroves } from './terrain/grove';
import { buildBuildings, type StructureFootprint } from './terrain/buildings';
import { toGeometry, terrainMaterial } from './terrain/mesh';
import type { TerrainInput } from './terrain/types';
import { packSheet, buildUnitTexture } from './units/atlas';
import { entityFrame, assignRoofSlots, type EntityFrameInput, type EntityFrame } from './units/frame-state';
import { UnitInstancer } from './units/instances';
import { pickUnit as pickUnitPure, unitsInScreenRect as unitsInScreenRectPure } from './units/pick';
import { stepTracers, spawnTracer, type TracerModel } from './units/tracers';
import { ParticleInstancer, TracerBatch, PARTICLE_CAPACITY, TRACER_CAPACITY } from './units/fx';
import { groundWorldY } from './ground-height';
import { tileHash } from '../tile-hash';

/** Where a unit type's sheets live, as the app named them. */
interface SpriteSheetRequest {
  basePath: string;
  turretPath?: string;
}

/** One unit mid-death-fade -- ThreeRenderer.stepDeaths' own tracking,
 *  mirroring PixiRenderer's identically-shaped `dying` entry (renderer.ts,
 *  `stepDeaths`'s own doc comment). Position, facing and typeId are captured
 *  at the moment of death, not read live off `Sim`, because the entity slot
 *  may be reused by a later spawn before the fade finishes. */
interface DyingUnit {
  x: number;
  y: number;
  facing: number;
  typeId: string;
  t: number;
}

/** Recoil/flinch decay durations, seconds -- redeclared from `renderer.ts`'s
 *  own `RECOIL_SECONDS`/`FLINCH_SECONDS` (private, unexported) rather than
 *  imported, the same reason everything else redeclared from `renderer.ts`
 *  in this backend is: importing from it would pull pixi.js into this
 *  module's graph. Owned here rather than `frame-state.ts` because draining
 *  `recoilT`/`flinchT` toward 0 is a once-a-frame, cross-entity operation
 *  (`drainTimers` below, mirroring `PixiRenderer.frame()`'s own
 *  top-of-frame drain, `renderer.ts:1882-1888`), not the per-entity decision
 *  `entityFrame` makes with the already-drained value. */
const RECOIL_SECONDS = 0.15;
const FLINCH_SECONDS = 0.18;
/** Seconds a dying unit spends fading before it is dropped -- mirrors
 *  `PixiRenderer.DEATH_SECONDS` (renderer.ts:1209). See `stepDeaths`'s own
 *  doc comment for what happens after that point (nothing -- permanent
 *  wreckage is out of scope; see there for why). */
const DEATH_SECONDS = 0.4;

/**
 * Particle draw layers -- mirrors `renderer.ts`'s own private
 * `FX_LAYER_BELOW`/`FX_LAYER_ABOVE`/`fxLayerIndex` (redeclared for the same
 * pixi.js-import reason as everything else redeclared from `renderer.ts`).
 * `FX_LAYER_BELOW` routes to `particleInstancerBelow` (real occlusion
 * against units/terrain); `FX_LAYER_ABOVE` routes to `particleInstancerAbove`
 * (unconditional, matching Pixi's own `fxAboveG`) -- see `units/fx.ts`'s own
 * top comment, "The `above_units` split (B3.14)", for the full reasoning.
 */
const FX_LAYER_BELOW = 0;
const FX_LAYER_ABOVE = 1;
function fxLayerIndex(layer: string | undefined): number {
  return layer === 'above_units' || layer === 'sky' ? FX_LAYER_ABOVE : FX_LAYER_BELOW;
}

/**
 * The `magnitude` value that makes `ParticleSystem.spawn`'s internal size
 * scale (`0.75 + magnitude * 1.25`) equal exactly 1 -- so `spawnFlatFx`
 * below can pass a `size_px` that becomes the drawn radius directly, rather
 * than one pre-divided by an arbitrary scale factor. See `spawnFlatFx`'s own
 * doc comment for the rest of the reasoning.
 */
const FLAT_FX_MAGNITUDE = 0.2;

export class ThreeRenderer implements Renderer {
  readonly camera: Camera = { x: 24, y: 24, zoom: 1 };
  selection: number[] = [];
  readonly unitGroup: Uint8Array;
  hoverEntity = -1;
  hoverStructure = -1;
  hoverCanGarrison = false;
  objectiveZone: readonly number[] | null = null;
  objectiveZoneState: 'held' | 'unheld' | 'contested' = 'held';

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /**
   * World data the app has already handed over, some of which is now drawn.
   *
   * One bag rather than several fields on purpose: it keeps what B2/B3/B4
   * inherit visible at a glance. Terrain (`decor`, `elevation`) is read by
   * `rebuildTerrain` below whenever `terrainDirty` is set; the two sheet maps
   * and the tutorial focus ring are B3's -- still retained only, not drawn.
   *
   * The emitter list and its palette resolver used to live here too
   * (`emitters`, `resolveColor`), retained-only, until B3.13 wired them into
   * `emitterLibrary`/`particleSystem` below -- objects that actually consume
   * them (indexing by weapon class, sampling colour curves) rather than a
   * copy of the raw arguments nothing read back. Keeping both would have
   * been two sources of the same state agreeing only by construction.
   */
  private readonly retained = {
    decor: null as Uint8Array | null,
    elevation: null as Uint8Array | null,
    unitSheets: new Map<string, SpriteSheetRequest>(),
    structureSheets: new Map<string, string>(),
    tutorialFocus: null as { x: number; y: number; radius: number } | null,
  };

  /**
   * Set by `setElevation`/`setDecor`, cleared by `rebuildTerrain`. Starts
   * `true` so a map that arrives with elevation/decor already retained (or
   * with neither -- an all-flat, decor-less map is still valid input to
   * `buildGround`) still gets a first build on the first `frame()`.
   *
   * Deliberately not built inside the setters themselves: both are called
   * during boot, in an order this class does not control (`main.ts` calls
   * `setDecor` then `setElevation`, but nothing enforces that), so building
   * on the first one to fire would build from half the data -- silently,
   * since a mesh built from a null elevation is valid, just flat.
   */
  private terrainDirty = true;
  private terrainMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  /** The grain -- flecks, blades, bushes, cover rubble, knolls, ridges,
   *  ruts, slope-face dressing -- as a second mesh sharing the ground's own
   *  material and rebuild path, not a modification of the ground mesh
   *  itself (`buildGround` and `buildScatter` are two independent builders
   *  over the same `TerrainInput`). */
  private scatterMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  /** Olive groves -- trunk and crown, standing above the ground rather than
   *  lying on it -- as a third mesh sharing the same material and rebuild
   *  path. `buildGroves` is a third independent builder over the identical
   *  `TerrainInput`, exactly like `buildScatter`. */
  private groveMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  /** Buildings -- a box per blocked, non-ridge tile -- as a fourth mesh
   *  sharing the same material and rebuild path. `buildBuildings` is a
   *  fourth independent builder over the identical `TerrainInput`, plus the
   *  one thing none of the other three needs: a plain-array snapshot of the
   *  sim's structures, assembled by `structureFootprints()` below so the
   *  builder itself never has to import `Sim`. */
  private buildingMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  /** Reused across rebuilds -- one unlit, vertex-coloured material carries no
   *  per-terrain state, so there is nothing a fresh instance would buy. */
  private readonly terrainMat: THREE.Material = terrainMaterial();

  /**
   * Per-entity position tracking for interpolation, mirroring
   * `PixiRenderer`'s own `prevX`/`prevY`/`curX`/`curY`/`entitySpeed`
   * (`renderer.ts:244-247,407`) exactly -- `frame()` needs the last two sim
   * ticks to lerp between, and `entityFrame` needs a *measured* ground speed
   * (from the tick delta, not the unit's data speed) so cover slowdowns,
   * pinning and mobility kills pace the gait for free, same as Pixi. All
   * sized to `sim.capacity`, populated by `snapshot()`, indexed by entity id.
   */
  private readonly prevX: Float64Array;
  private readonly prevY: Float64Array;
  private readonly curX: Float64Array;
  private readonly curY: Float64Array;
  private readonly entitySpeed: Float64Array;
  /** Persisted per-entity animation phase state `entityFrame` mutates in
   *  place -- `frame-state.ts`'s own `EntityFrameInput.entityAnimFrame`/
   *  `animSeeded` doc comment: "owned and persisted by the caller across
   *  frames." Mirrors Pixi's identically-named fields. */
  private readonly entityAnimFrame: Float64Array;
  private readonly animSeeded: Uint8Array;
  /**
   * Task B3.14: event-driven presentation timers, one-shot latches set from
   * `onEvents` and drained toward 0 by `drainTimers` at the top of every
   * `frame()` -- mirrors `PixiRenderer`'s identically-named private fields
   * (`renderer.ts:412-419`) exactly, including their shapes: `firingTimer`
   * counts down its own remaining seconds; `recoilT`/`flinchT` count down
   * 1..0 and are read alongside their paired `*Dir`/`recoilPower` by
   * `entityFrame` (`frame-state.ts`) to place the screen-space kick.
   */
  private readonly firingTimer: Float64Array;
  private readonly recoilT: Float64Array;
  private readonly recoilDir: Float64Array;
  private readonly recoilPower: Float64Array;
  private readonly flinchT: Float64Array;
  private readonly flinchDir: Float64Array;
  /**
   * Task B3.6: per-entity turret traverse state, mirroring Pixi's own
   * `turretFacing`/`turretVel` (`renderer.ts:421-425`) field-for-field --
   * owned here, mutated in place by `entityFrame` (`frame-state.ts`'s own
   * `EntityFrameInput.turretFacing`/`turretVel`/`turretSeeded` doc comment),
   * exactly like `entityAnimFrame`/`animSeeded` above. Meaningless (and
   * never mutated) for an entity whose unit type has no turret sheet.
   */
  private readonly turretFacing: Float64Array;
  private readonly turretVel: Float64Array;
  private readonly turretSeeded: Uint8Array;
  /**
   * Task B3.6: the TURRET's own one-shot firing latch -- deliberately a
   * SEPARATE timer from `firingTimer` above, not a second read of it. Every
   * shipped hull sheet with turret art (TNK/EITAN/NAMER/GUNTRUCK/TECH)
   * declares no `fire` clip of its own, so `firingTimer` (latched from the
   * HULL's fire-clip duration in `onFire` below) never fires for a turreted
   * vehicle at all -- reusing it here would leave every turret's own `fire`
   * clip permanently unreachable, exactly the "16 recoil frames stay dead
   * art" failure this task exists to close, just moved one layer past the
   * loadSprites fix that made them loadable. Latched off the TURRET sheet's
   * OWN fire-clip duration instead, independent of what the hull has.
   */
  private readonly turretFiringTimer: Float64Array;
  /** Units mid-death-fade -- see `stepDeaths`'s own doc comment. */
  private readonly dying: DyingUnit[] = [];

  /** One `UnitInstancer` per unit type with a loaded sheet, keyed by the
   *  unit type id `loadSprites` was called with. */
  private readonly unitInstancers = new Map<string, UnitInstancer>();
  /**
   * Task B3.6: one SECOND `UnitInstancer` per unit type whose `loadSprites`
   * call carried a `turretPath` -- composited above its hull instancer's
   * own mesh, updated via `UnitInstancer.updateTurret` rather than `update`.
   * Absent entries mean "this type has no turret art", the same "doubles as
   * the has-a-turret gate" shape `EntityFrameInput.turretSheet` uses.
   */
  private readonly turretInstancers = new Map<string, UnitInstancer>();
  /** Reused across frames (`.length = 0` each `frame()`, not reallocated) --
   *  every living entity's `EntityFrame` this tick, grouped by its unit
   *  type id, the shape `UnitInstancer.update` consumes. `stepDeaths` also
   *  appends a synthetic `EntityFrame` per still-fading dying unit into the
   *  same per-type arrays, for the same instancers to draw. */
  private readonly framesByType = new Map<string, EntityFrame[]>();
  /**
   * Task B3.6: the LIVING-ONLY subset of `framesByType`, for unit types with
   * a turret instancer -- populated in the same per-entity loop that builds
   * `framesByType`, but never appended to by `stepDeaths`. A dying unit's
   * synthetic `EntityFrame` (`stepDeaths`'s own doc comment) still draws its
   * hull's death-fade pose, but Pixi's own `stepDeaths` never draws a turret
   * sprite for one at all (`turretSprites[i].visible` stays `false` for the
   * whole fade, since dying entities never re-enter the main per-entity
   * loop that would show one) -- matched here by simply never handing a
   * dying frame to a turret instancer, rather than by a per-frame flag
   * `writeTurretInstances` would have to additionally check.
   */
  private readonly turretFramesByType = new Map<string, EntityFrame[]>();

  /**
   * Task B3.13/B3.14: combat feedback's draw path. `emitterLibrary` and
   * `particleSystem` are wired by `useEmitters` below -- `particleSystem`
   * stays `null` until then, exactly like `PixiRenderer.particles`, since a
   * `ParticleSystem` needs the app's `resolve` callback to construct.
   * `tracers` starts empty and is populated by `onEvents`'s own `fire` case
   * (Task B3.14), mirroring `PixiRenderer.tracers`.
   *
   * Two `ParticleInstancer`s, not one: Task B3.14 splits B3.13's single
   * merged mesh back into a below/above pair on the `depthTest` axis -- see
   * `units/fx.ts`'s own top comment, "The `above_units` split (B3.14)", for
   * the full reasoning and cost. `particleInstancerBelow`/`particleInstancerAbove`/
   * `tracerBatch` all exist unconditionally from construction, independent
   * of whether `useEmitters` has run yet or any tracer has ever spawned, so
   * `frame()` always has something to call `.update()` on.
   */
  private readonly emitterLibrary = new EmitterLibrary();
  private particleSystem: ParticleSystem | null = null;
  private tracers: TracerModel[] = [];
  private readonly particleInstancerBelow = new ParticleInstancer(PARTICLE_CAPACITY, FX_LAYER_BELOW, true);
  private readonly particleInstancerAbove = new ParticleInstancer(PARTICLE_CAPACITY, FX_LAYER_ABOVE, false);
  private readonly tracerBatch = new TracerBatch(TRACER_CAPACITY);

  constructor(
    private readonly sim: Sim,
    private readonly opts: RendererOptions
  ) {
    this.unitGroup = new Uint8Array(sim.capacity);
    const n = sim.capacity;
    this.prevX = new Float64Array(n);
    this.prevY = new Float64Array(n);
    this.curX = new Float64Array(n);
    this.curY = new Float64Array(n);
    this.entitySpeed = new Float64Array(n);
    this.entityAnimFrame = new Float64Array(n);
    this.animSeeded = new Uint8Array(n);
    this.firingTimer = new Float64Array(n);
    this.recoilT = new Float64Array(n);
    this.recoilDir = new Float64Array(n);
    this.recoilPower = new Float64Array(n);
    this.flinchT = new Float64Array(n);
    this.flinchDir = new Float64Array(n);
    this.turretFacing = new Float64Array(n);
    this.turretVel = new Float64Array(n);
    this.turretSeeded = new Uint8Array(n);
    this.turretFiringTimer = new Float64Array(n);
    // antialias stays off deliberately (Phase 0 verdict, "Antialiasing must
    // be off, or accounted for"): a blended edge pixel is by definition not
    // a palette colour, and this backend's sprite/toon pipeline quantizes
    // rather than blends. Do not re-enable it without accounting for edges.
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    // outputColorSpace and the clear colour, in the one order that is
    // correct -- see palette-material.ts's module doc comment for why
    // three.js reads outputColorSpace synchronously inside setClearColor(),
    // which is exactly why this is a single call rather than two lines a
    // future edit could reorder.
    applyPalettePipeline(this.renderer, this.opts.background);
    // Added unconditionally, not lazily on first useEmitters/spawn -- all
    // three meshes start at count/drawRange 0 (nothing live yet) and simply
    // stay that way until there is something to draw, the same "always
    // present, draws nothing until fed" shape terrain's own meshes have
    // before the first rebuildTerrain.
    this.scene.add(this.particleInstancerBelow.mesh, this.particleInstancerAbove.mesh, this.tracerBatch.mesh);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
  get width(): number {
    return this.renderer.domElement.width;
  }
  get height(): number {
    return this.renderer.domElement.height;
  }

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    this.renderer.setPixelRatio(1);
    this.fitToHost();
    host.appendChild(this.renderer.domElement);
    // PixiRenderer gets this from `resizeTo: host` (renderer.ts). Without an
    // equivalent the three canvas would stay at boot size while `width`/
    // `height` -- which `worldToScreen`/`screenToWorld` both read off the
    // canvas -- kept reporting it, so the two backends would disagree by
    // exactly the resize delta and every pointer read would land on the
    // wrong tile.
    //
    // A ResizeObserver on the host rather than a window `resize` listener:
    // it covers the window case and also the ones a window listener misses
    // (a sidebar opening, the host's own layout changing, devtools docking),
    // and it is scoped to the element this renderer actually fills.
    this.resizeObserver = new ResizeObserver(() => {
      this.fitToHost();
    });
    this.resizeObserver.observe(host);
    // Seeds prevX/prevY == curX/curY from the sim's actual starting
    // positions before the first `frame()` -- exactly Pixi's own
    // `PixiRenderer.init()` ("this.snapshot(); this.snapshot(); // prev ==
    // cur on the first frame", `renderer.ts:557-558`). `main.ts`'s own
    // fixed-tick loop calls `renderer.snapshot()` only from inside
    // `runTick()`, which does not run until after the first `sim.tick()` --
    // so without this, every unit would render at world (0, 0) (the
    // Float64Array zero-fill) for however many animation frames elapse
    // before that first tick lands.
    this.snapshot();
    this.snapshot();
    await Promise.resolve();
  }

  /**
   * Release the GPU context and stop observing the host.
   *
   * Nothing calls this today: `main()` has no shutdown path -- see the `void
   * rafId` note at the end of it -- so there is no sensible place to hang
   * teardown off. It exists so the observer has a documented owner rather
   * than being a listener with no way to remove it, and so a future teardown
   * has one call to make instead of having to learn this class's internals.
   *
   * Disposes every terrain geometry and the shared material. B2.4 left this
   * out for the ground mesh alone -- harmless while `WebGLRenderer.dispose()`
   * forces context loss regardless and nothing called `dispose()` at all --
   * but B2.5 added a second geometry sharing the same material, and B2.6 a
   * third; letting that omission grow rather than fixing it here would be
   * the wrong direction to take it in.
   */
  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.terrainMesh?.geometry.dispose();
    this.scatterMesh?.geometry.dispose();
    this.groveMesh?.geometry.dispose();
    this.buildingMesh?.geometry.dispose();
    this.terrainMat.dispose();
    for (const instancer of this.unitInstancers.values()) instancer.dispose();
    this.unitInstancers.clear();
    for (const instancer of this.turretInstancers.values()) instancer.dispose();
    this.turretInstancers.clear();
    this.particleInstancerBelow.dispose();
    this.particleInstancerAbove.dispose();
    this.tracerBatch.dispose();
    this.renderer.dispose();
    this.host = null;
  }

  /** Size the drawing buffer to the host element, exactly as Pixi's
   *  `resizeTo` does: `clientWidth`/`clientHeight`, at resolution 1. No clamp
   *  to a minimum -- a zero-sized host produces a zero-sized canvas on both
   *  backends, and inventing a 1x1 floor here would make them disagree. */
  private fitToHost(): void {
    if (!this.host) return;
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
  }

  /** `alpha` (interpolation) and `dtMs` (presentation animation -- frame
   *  advance) now feed every living unit's `EntityFrame` via `updateUnits`,
   *  and (Task B3.13) every live particle/tracer via `updateFx`. Terrain
   *  still reads neither: it has no per-frame presentation state.
   *
   *  `drainTimers` runs FIRST, before anything reads `firingTimer`/`recoilT`/
   *  `flinchT` -- mirroring `PixiRenderer.frame()`'s own top-of-frame drain
   *  (`renderer.ts:1882-1888`) exactly, including the ordering: the decay
   *  has to land before `updateUnits` builds this frame's `EntityFrameInput`
   *  from the just-drained values, or every latch would read one frame
   *  stale. */
  frame(alpha: number, dtMs: number): void {
    this.drainTimers(this.frameDtSeconds(dtMs));
    if (this.terrainDirty) {
      this.rebuildTerrain();
      this.terrainDirty = false;
    }
    this.updateUnits(alpha, dtMs);
    this.updateFx(dtMs);
    this.renderer.render(this.scene, this.threeCamera());
  }

  /**
   * Drains the one-shot firing/recoil/flinch latches -- ported verbatim from
   * `PixiRenderer.frame()`'s own top-of-frame drain (`renderer.ts:1882-1888`,
   * "Drain the one-shot latches before anything reads them. Recoil and
   * flinch decay over their own durations, framerate-independently.").
   * Not gated on `alive[i]`, matching Pixi exactly: a unit killed mid-recoil
   * still has its timer drained (harmlessly -- nothing reads a dead entity's
   * recoil, since `updateUnits`'s living-entity loop skips it and
   * `stepDeaths` builds its own synthetic frame from captured state instead).
   */
  private drainTimers(dtSeconds: number): void {
    const n = this.sim.entityCount;
    for (let i = 0; i < n; i++) {
      if (this.firingTimer[i] > 0) this.firingTimer[i] = Math.max(0, this.firingTimer[i] - dtSeconds);
      // Task B3.6: same shape as firingTimer -- counts down its own
      // remaining seconds, not a normalised 0..1 decay.
      if (this.turretFiringTimer[i] > 0) {
        this.turretFiringTimer[i] = Math.max(0, this.turretFiringTimer[i] - dtSeconds);
      }
      if (this.recoilT[i] > 0) this.recoilT[i] = Math.max(0, this.recoilT[i] - dtSeconds / RECOIL_SECONDS);
      if (this.flinchT[i] > 0) this.flinchT[i] = Math.max(0, this.flinchT[i] - dtSeconds / FLINCH_SECONDS);
    }
  }

  /**
   * Copy positions after every sim tick; `frame()` lerps between the
   * copies -- the three.js counterpart to `PixiRenderer.snapshot()`
   * (`renderer.ts:729-751`). Ground speed is measured from the tick delta
   * rather than read off the unit type, matching Pixi exactly, so cover
   * slowdowns, pinning and mobility kills pace the gait for free.
   *
   * Deliberately does not port Pixi's fog/trail refresh (`this.fogTick++ %
   * 4 === 0` gating `updateFog`/`drawTrail`) -- fog and trails are B4.
   *
   * Turret facing is NOT seeded here, unlike Pixi's own `snapshot()`
   * (`renderer.ts:748-750`, gated on `this.frameN === 0`): Task B3.6 seeds
   * it per-entity, in `entityFrame` itself (`turretSeeded`, `frame-state.ts`),
   * on that entity's own first decided frame rather than a single
   * tick-loop gate tied to the very first rendered frame. That also seeds a
   * reinforcement correctly on ITS OWN first frame, which Pixi's single
   * `frameN === 0` gate does not (a unit spawned after the first frame has
   * rendered is never seeded there at all, and springs from a frozen 0
   * until it first acquires a target).
   */
  snapshot(): void {
    this.prevX.set(this.curX);
    this.prevY.set(this.curY);
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      this.curX[i] = fx.toNumber(st.posX[i]);
      this.curY[i] = fx.toNumber(st.posY[i]);
      const dx = this.curX[i] - this.prevX[i];
      const dy = this.curY[i] - this.prevY[i];
      this.entitySpeed[i] = Math.hypot(dx, dy) * SIM_HZ;
    }
  }
  /**
   * Task B3.14: the presentation half of `onEvents`, ported from
   * `renderer.ts:756` onward (`PixiRenderer.onEvents`). Wires seven of the
   * nine event kinds Pixi handles there -- `fire`, `impact`, `nearMiss`,
   * `aps`, `strike`, `destroyed`, `tunnelCollapsed` -- muzzle flash position
   * and direction, tracer spawn, impact effects, the death fade
   * (`stepDeaths`), and the recoil/flinch latches `drainTimers` decays.
   *
   * `structureHit` and `structureDestroyed` are DELIBERATELY left unhandled.
   * Both mark terrain dirty in Pixi (`renderer.ts:853,881`), and Pixi fires
   * `structureHit` on EVERY damage event -- a full `rebuildTerrain` here
   * costs 114-179ms (this class's own `rebuildTerrain` doc comment), so
   * wiring either before Task B3.9 makes the rebuild incremental would make
   * a siege unplayable rather than merely visually stale. Task B3.9 owns
   * both; Task B3.10 (`onEvents`'s remaining non-presentation half, if any)
   * is the other named successor. `rebuildTerrain`'s own doc comment already
   * documents the resulting staleness (a destroyed building's footprint
   * does not repaint) -- this method does not widen that gap, it leaves it
   * exactly where B2.7 found it.
   *
   * Task B3.6 closed the turret gap this comment used to describe: `onFire`
   * below now reads the shooter's TURRET facing for muzzle position/
   * direction and recoil bearing whenever this backend has turret art
   * loaded for that unit type (`this.turretInstancers`), and only falls
   * back to hull facing for a unit type with none -- see `onFire`'s own
   * comment for the one deliberate way this differs from Pixi's `usesTurret`
   * condition (`renderer.ts:778-781`), and why.
   */
  onEvents(events: SimEvent[]): void {
    const st = this.sim.state;
    for (const e of events) {
      if (e.kind === 'fire') this.onFire(e);
      else if (e.kind === 'nearMiss') {
        this.spawnFlatFx(fx.toNumber(e.x), fx.toNumber(e.y), this.opts.nearMissColor, 7, 14);
      } else if (e.kind === 'aps' && e.intercepted) {
        this.spawnFlatFx(this.curX[e.target], this.curY[e.target], this.opts.interceptColor, 10, 12);
      } else if (e.kind === 'impact' && e.penetrated) {
        this.spawnFlatFx(this.curX[e.target], this.curY[e.target], this.opts.flashColor, 8, 10);
        // Jolt the target away from the shooter, so a penetrating hit lands
        // on the unit rather than only in the roll feed (renderer.ts:825-832).
        const dx = this.curX[e.target] - this.curX[e.shooter];
        const dy = this.curY[e.target] - this.curY[e.shooter];
        if (dx !== 0 || dy !== 0) {
          this.flinchT[e.target] = 1;
          this.flinchDir[e.target] = (((Math.atan2(dy, dx) / (Math.PI * 2)) % 1) + 1) % 1;
        }
      } else if (e.kind === 'strike') {
        this.onStrike(e.x, e.y, e.tick);
      } else if (e.kind === 'tunnelCollapsed') {
        this.onTunnelCollapsed(e.tunnel, e.tick);
      } else if (e.kind === 'destroyed') {
        this.dying.push({
          x: this.curX[e.entity],
          y: this.curY[e.entity],
          facing: fx.toNumber(st.facing[e.entity]),
          typeId: this.sim.unitTypes[st.typeIdx[e.entity]].id,
          t: 0,
        });
      }
      // structureHit / structureDestroyed: Task B3.9 (incremental terrain
      // rebuild) owns these -- see this method's own doc comment.
    }
  }

  /**
   * The `fire` case, ported from `renderer.ts:758-818`. Split out of
   * `onEvents` itself only because it is by far the longest of the seven --
   * the branch structure otherwise matches Pixi's exactly, kind for kind.
   */
  private onFire(e: Extract<SimEvent, { kind: 'fire' }>): void {
    const st = this.sim.state;
    // Shots at buildings carry target -1: aim the tracer at the building
    // (renderer.ts:759-762).
    const atStruct = e.target < 0 && e.structure !== undefined;
    const tx = atStruct ? fx.toNumber(this.sim.structures.cx[e.structure as number]) : this.curX[e.target];
    const ty = atStruct ? fx.toNumber(this.sim.structures.cy[e.structure as number]) : this.curY[e.target];
    this.tracers.push(spawnTracer(this.curX[e.shooter], this.curY[e.shooter], tx, ty, st.side[e.shooter]));

    const type = this.sim.unitTypes[st.typeIdx[e.shooter]];
    // Latch the fire clip for its own declared duration (renderer.ts:772-777).
    const fireClip = this.unitInstancers.get(type.id)?.sheet.clips.fire;
    if (fireClip && fireClip.fps > 0) {
      this.firingTimer[e.shooter] = fireClip.frames / fireClip.fps;
    }

    // Task B3.6: the turret's OWN fire-clip duration, latched independently
    // of the hull's `firingTimer` above -- see `turretFiringTimer`'s own
    // field doc comment for why reusing `firingTimer` would leave every
    // shipped turret's `fire` clip unreachable (no hull sheet with turret
    // art declares one of its own).
    const turretInstancer = this.turretInstancers.get(type.id);
    const turretFireClip = turretInstancer?.sheet.clips.fire;
    if (turretFireClip && turretFireClip.fps > 0) {
      this.turretFiringTimer[e.shooter] = turretFireClip.frames / turretFireClip.fps;
    }

    // Turret facing when this unit type has turret art loaded, hull facing
    // otherwise -- `this.turretFacing[e.shooter]` holds whatever
    // `updateUnits`'s last `entityFrame` call sprung it to, matching Pixi's
    // own `usesTurret` read of `this.turretFacing[e.shooter]`
    // (renderer.ts:778-781). Gated on ACTUAL turret art (`turretInstancer`)
    // rather than Pixi's `!type.isSoft` -- a deliberate, narrower condition:
    // Pixi's turret-facing spring only ever runs for a unit type with
    // turret art loaded (`if (atlas.turretTextures)`, renderer.ts:2112), so
    // a non-soft vehicle with NO turret sheet (the jeep, the D9, the
    // Apache) has its `turretFacing` seeded once at mission start and then
    // left frozen forever in Pixi -- reading it there would be reading a
    // stale value, not a turret-aware one. Reading hull facing for that
    // case instead (this backend's own pre-B3.6 behaviour) is strictly more
    // correct, not merely different, and only matters for a unit type that
    // never draws a turret sprite in either backend.
    const facingRad = turretInstancer
      ? this.turretFacing[e.shooter] * Math.PI * 2
      : fx.toNumber(st.facing[e.shooter]) * Math.PI * 2;
    const barrelLen = type.isSoft ? 0.4 : 0.8;
    const mzX = this.curX[e.shooter] + Math.cos(facingRad) * barrelLen;
    const mzY = this.curY[e.shooter] + Math.sin(facingRad) * barrelLen;

    // Which weapon fired decides the signature, not whether the shooter is
    // soft (renderer.ts:785-791).
    const wp = type.weapons.find((w) => w.id === e.weaponId);
    const cls = wp?.cls ?? WEAPON_CLASS.small_arms;
    const emitter = this.emitterLibrary.fireEmitterFor(cls);
    const power = wp ? firePower(wp) : 0;

    // Kick the shooter back along its own bearing (renderer.ts:792-800).
    // Demolition charges are placed, not fired -- a satchel charge must not
    // make the squad lurch.
    if (cls !== WEAPON_CLASS.demolition) {
      this.recoilT[e.shooter] = 1;
      this.recoilDir[e.shooter] = facingRad / (Math.PI * 2);
      this.recoilPower[e.shooter] = power;
    }

    if (emitter && this.particleSystem) {
      const dirTurns = facingRad / (Math.PI * 2);
      const prio = emitter.budget_priority ?? 5;
      const fxLayer = fxLayerIndex(emitter.layer);
      for (const layer of emitter.particles) {
        const offset = (layer.direction_offset_deg ?? 0) / 360;
        this.particleSystem.spawn(layer, mzX, mzY, dirTurns + offset, power, prio, fxLayer);
      }
    } else {
      // No emitter authored for this weapon class yet: the flat-colour
      // fallback Pixi's own `puffs` stand in with (renderer.ts:811-818),
      // reproduced through the SAME ParticleSystem pool real emitters use
      // rather than a second FX mechanism -- see spawnFlatFx's own doc
      // comment.
      if (type.isSoft) {
        this.spawnFlatFx(mzX, mzY, this.opts.flashColor, 5, 7);
      } else {
        this.spawnFlatFx(mzX, mzY, this.opts.flashColor, 14, 4);
        this.spawnFlatFx(mzX, mzY, this.opts.flashColor, 10, 8);
        this.spawnFlatFx(mzX, mzY, '#6B6355', 7, 18);
      }
    }
  }

  /**
   * The `strike` case, ported from `renderer.ts:833-846`: a scatter of 18
   * puffs around the impact point, positioned by the SAME deterministic
   * per-sample hash Pixi uses (`PixiRenderer.h2`, which `renderer.ts`'s own
   * doc comment says IS `tileHash` -- imported directly here rather than
   * reimplemented, so the two backends scatter identically for the same
   * tick/strike, not merely similarly).
   */
  private onStrike(ex: Fx, ey: Fx, tick: number): void {
    const sx = fx.toNumber(ex);
    const sy = fx.toNumber(ey);
    for (let k = 0; k < 18; k++) {
      const a = tileHash(k * 11 + tick, k * 17 + tick);
      const b = tileHash(k * 23 + tick, k * 5 + tick);
      this.spawnFlatFx(
        sx + (a - 0.5) * 4,
        sy + (b - 0.5) * 4,
        k % 3 === 0 ? this.opts.flashColor : this.opts.nearMissColor,
        10 + a * 14,
        20 + Math.floor(a * 20)
      );
    }
  }

  /**
   * The `tunnelCollapsed` case, ported from `renderer.ts:903-935`: a handful
   * of sample points along the route's length, each spawning the
   * `tunnel_collapse` emitter set (`spawnCollapseFx`) or, if no emitter set
   * is loaded, the same flat-puff fallback structure/tunnel collapse share
   * in Pixi.
   */
  private onTunnelCollapsed(tunnel: number, tick: number): void {
    const len = fx.toNumber(this.sim.tnLength[tunnel]);
    const samples = Math.max(2, Math.min(6, 1 + Math.round(len / 2.5)));
    for (let s = 0; s < samples; s++) {
      const d = fx.from((len * s) / (samples - 1));
      const [px, py] = this.sim.tunnelPointAt(tunnel, d);
      const tx = fx.toNumber(px) + 0.5;
      const ty = fx.toNumber(py) + 0.5;
      if (!this.spawnCollapseFx('tunnel_collapse', tx, ty)) {
        for (let k = 0; k < 4; k++) {
          const a = tileHash(k * 7 + tunnel + s * 5, k * 13 + tick);
          const b = tileHash(k * 31 + tick + s * 17, k * 3 + tunnel);
          this.spawnFlatFx(tx + (a - 0.5) * 2, ty + (b - 0.5) * 2, this.opts.nearMissColor, 8 + a * 8, 22 + Math.floor(a * 12));
        }
      }
    }
  }

  /**
   * A collapse's debris and dust bloom -- `structure_collapse` for a
   * building, `tunnel_collapse` for a route's vent (only the latter is
   * reachable from this task's wired events; `structureDestroyed` is out of
   * scope, see `onEvents`'s own doc comment). Ported from `renderer.ts:330-342`
   * (`PixiRenderer.spawnCollapseFx`). Returns false when no emitter set is
   * loaded, exactly like Pixi, so the caller can fall back to flat puffs.
   */
  private spawnCollapseFx(id: string, bx: number, by: number): boolean {
    if (!this.particleSystem) return false;
    const em = this.emitterLibrary.byName(id);
    if (!em) return false;
    const prio = em.budget_priority ?? 1;
    const fxLayer = fxLayerIndex(em.layer);
    for (const layer of em.particles) {
      // Straight up from the footprint centre; the spec's 360-degree cone
      // and the presentation PRNG inside spawn() do the scattering.
      this.particleSystem.spawn(layer, bx, by, 0.25, 1, prio, fxLayer);
    }
    return true;
  }

  /**
   * A single-colour, non-authored puff, routed through the SAME
   * `ParticleSystem` pool and draw path every real emitter uses -- not a
   * second FX mechanism. Pixi's equivalent (`renderer.ts`'s `Puff`
   * interface/array, `this.puffs`) is a flat, FRAME-counted circle drawn
   * directly on a `Graphics`, with its own growth formula (`r * (1.4 -
   * ttl/14)`, `renderer.ts:2605`) that has no equivalent in
   * `ParticleSystem`'s 0..1-normalised, TIME-based curve model.
   * `size_over_life`/`alpha_over_life` below reproduce the SHAPE of that
   * effect (a small puff that grows while it fades) rather than its exact
   * numbers -- an approximation, not a pixel-identical port; see this
   * task's report for why an exact port was not attempted (the two curve
   * models are not commensurable without either changing `ParticleSystem`,
   * which is barred this task, or adding a second, incompatible FX
   * mechanism just for these fallback cases).
   *
   * `lifetimeFrames` matches Pixi's own `ttl` values directly ("frames at a
   * nominal 60Hz", the same convention `tracers.ts`'s own
   * `TRACER_LIFETIME_S` documents) so every call site above can reuse
   * Pixi's literal numbers unchanged rather than re-deriving them.
   *
   * `magnitude` is fixed at `FLAT_FX_MAGNITUDE` so `radiusPx` becomes the
   * drawn radius directly (see that constant's own doc comment); `priority`
   * is `0`, the LOWEST possible -- `ParticleSystem.freeSlot`
   * (`vfx/particles.ts:88-103`) recycles the LOWEST-priority live particle
   * first when the pool is full, so `0` is the one value that guarantees a
   * fallback puff is always the first thing evicted under pool pressure,
   * never an authored emitter's own particle (every shipped emitter's
   * `budget_priority` is >= 1, `fire_small_arms.json`'s own floor). A
   * non-zero priority here would have the OPPOSITE effect from what it
   * reads as: `fire_small_arms` (1) and `fire_hmg` (2) -- the two commonest
   * weapon classes in a firefight -- and both cigarette emitters (1) would
   * all rank BELOW it and be evicted in ITS favour instead. Always spawns
   * on `FX_LAYER_BELOW`, matching Pixi's `puffs` -- they draw on `fxG` (the
   * below layer) unconditionally, never `fxAboveG`.
   */
  private spawnFlatFx(x: number, y: number, color: string, radiusPx: number, lifetimeFrames: number): void {
    if (!this.particleSystem) return;
    const spec: ParticleSpec = {
      count: 1,
      lifetime_ms: (lifetimeFrames / 60) * 1000,
      size_px: radiusPx,
      size_over_life: [0.5, 1.2],
      alpha_over_life: [0.85, 0],
      color_over_life: [color],
    };
    this.particleSystem.spawn(spec, x, y, 0, FLAT_FX_MAGNITUDE, 0, FX_LAYER_BELOW);
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return worldToScreenThree(wx, wy, this.camera, { width: this.width, height: this.height });
  }
  screenToWorld(px: number, py: number): { x: number; y: number } {
    return screenToWorldThree(px, py, this.camera, { width: this.width, height: this.height });
  }

  // --- queries. The line is between *inventing* an answer and *reporting the
  //     current state truthfully*, not between "implemented" and "not".
  /**
   * Nearest living, surfaced unit within `radiusTiles` of a world point, or
   * -1. `wx`/`wy` are already world coordinates -- the caller
   * (`main.ts:928`) converts screen to world via `screenToWorld` first, so
   * this is plain arithmetic over `curX`/`curY`, not a projection. See
   * `units/pick.ts`'s own doc comment for the full ruling.
   */
  pickUnit(wx: number, wy: number, radiusTiles = 1.2): number {
    return pickUnitPure(
      wx,
      wy,
      this.curX,
      this.curY,
      this.sim.state.alive,
      this.sim.state.tunnelIn,
      this.sim.entityCount,
      radiusTiles
    );
  }
  /**
   * True, always -- and this is the correct answer, not a placeholder.
   *
   * Fog is B4. This backend has no fog system, so nothing is hidden, so every
   * world point is visible. B4 replaces this with a real visibility query
   * against the fog it introduces.
   *
   * It matters that this does not throw: `updateHover()` calls it once per
   * living hostile every rAF iteration, so a throw here was a 60 Hz stream of
   * expected errors -- which drowns the diagnostics B2 will need and trains
   * everyone to stop reading the console.
   */
  isVisible(): boolean {
    return true;
  }
  /**
   * Living units whose projected FEET fall inside a screen-space rect --
   * box-select's answer. A genuine projection question, unlike `pickUnit`
   * above, so it goes through `worldToScreenThree` (via `units/pick.ts`) at
   * each unit's own tile height rather than assuming flat ground. See
   * `units/pick.ts`'s own doc comment for the parity argument against
   * `PixiRenderer.unitsInScreenRect`.
   */
  unitsInScreenRect(x0: number, y0: number, x1: number, y1: number): number[] {
    return unitsInScreenRectPure(
      x0,
      y0,
      x1,
      y1,
      this.curX,
      this.curY,
      this.sim.state.alive,
      this.sim.entityCount,
      this.retained.elevation,
      this.sim.width,
      this.sim.height,
      this.camera,
      { width: this.width, height: this.height }
    );
  }

  // --- world data pushed in. Decor/elevation/emitters are now drawn (or,
  //     for emitters, consumed by objects `updateFx` draws from -- see
  //     `onEvents`'s own doc comment for what still has to happen before a
  //     particle actually appears); the sheet maps and tutorial focus stay
  //     retained only, for B3/B4.
  setElevation(elevation: Uint8Array): void {
    this.retained.elevation = elevation;
    this.terrainDirty = true;
  }
  setDecor(decor: Uint8Array): void {
    this.retained.decor = decor;
    this.terrainDirty = true;
  }
  /**
   * Wires weapon-fire emitters into a real `EmitterLibrary` (indexed by
   * weapon class, mirroring `PixiRenderer.useEmitters`) and constructs a
   * real `ParticleSystem` from the app's `resolve` callback, at the SAME
   * `PARTICLE_CAPACITY` (2048) Pixi's own `ParticleSystem` uses
   * (`renderer.ts:644`) -- one pool, matched, not two independently-guessed
   * ceilings. Both are actually read from now: `emitterLibrary.
   * fireEmitterFor`/`byName` and `particleSystem.spawn` are wired from
   * `onEvents` (Task B3.14), and `particleSystem.step`/both
   * `ParticleInstancer.update` calls already run every frame regardless,
   * from `updateFx` below.
   *
   * `resolve` is wrapped, not passed straight through: `spawnFlatFx` (Task
   * B3.14) feeds ALREADY-RESOLVED hex strings (`this.opts.flashColor` et
   * al., resolved once at `RendererOptions` construction time in `main.ts`)
   * through `ParticleSpec.color_over_life`, and `ParticleSystem.spawn`
   * unconditionally calls `resolve` on every entry of that array
   * (`vfx/particles.ts:125`). The app's real `resolve` (`paletteColor`,
   * `packages/data/src/index.ts`) treats anything that is not a recognised
   * `band.index`/`band.name` palette key as unknown and returns magenta
   * (`#FF00FF`) -- a hex string has no `.` in it and is not a real palette
   * key, so passing one through unwrapped would silently turn every
   * `spawnFlatFx` puff (every fallback muzzle flash, every impact/near-miss/
   * intercept/strike effect) magenta. Hex strings pass straight through
   * here instead; anything else still resolves through the real palette
   * exactly as before -- authored emitters' own `color_over_life` entries
   * (palette keys like `"vfx.fire"`) are unaffected.
   */
  useEmitters(list: EmitterSpec[], resolve: (key: string) => string): void {
    this.emitterLibrary.useEmitters(list);
    const passthroughResolve = (key: string): string => (key.startsWith('#') ? key : resolve(key));
    this.particleSystem = new ParticleSystem(PARTICLE_CAPACITY, passthroughResolve);
  }
  /**
   * Load a unit type's sprite sheet and build the `THREE.InstancedMesh`
   * (`UnitInstancer`) it draws through -- one draw call for however many of
   * this type end up alive, per Ruling 1.
   *
   * Task B3.6: `opts.turretPath`, when given, is now ALSO loaded and built
   * into a second `UnitInstancer` (`turretInstancers`), the same generic
   * `packSheet`/`buildUnitTexture`/`UnitInstancer` pipeline the hull sheet
   * goes through -- a turret sheet is shaped exactly like a hull sheet
   * (`SheetSpec`), so nothing here is turret-specific except which map the
   * result lands in and which mesh the caller (`updateUnits`) later calls
   * `updateTurret` rather than `update` on. `packSheet`/`buildUnitTexture`
   * already pack and load EVERY clip a sheet declares (not merely `idle`),
   * so the gun truck's 16 recoil-frame `fire` clip is loaded here exactly
   * like `idle` is -- there is no separate "load every clip" step to add,
   * unlike the bug `renderer.ts`'s own `loadSprites` comment records
   * needing a fix for.
   *
   * Errors propagate rather than being swallowed: `main.ts` already wraps
   * every `loadSprites` call in its own `.catch` per unit type (so one
   * missing sheet does not stop the rest of the roster from loading), which
   * is exactly Pixi's own failure mode for the identical call. A turret
   * sheet that fails to load fails the WHOLE call (hull included), matching
   * Pixi: `PixiRenderer.loadSprites` `await`s its own turret load inline,
   * with nothing to catch a rejection there either.
   */
  async loadSprites(
    unitTypeId: string,
    basePath: string,
    opts?: { turretPath?: string }
  ): Promise<void> {
    this.retained.unitSheets.set(unitTypeId, { basePath, turretPath: opts?.turretPath });
    const res = await fetch(`${basePath}manifest.json`);
    if (!res.ok) throw new Error(`sheet manifest ${res.status} at ${basePath}`);
    const sheet: SheetSpec = parseManifest(await res.json());
    const packing = packSheet(sheet);
    const texture = await buildUnitTexture(basePath, sheet, packing);
    const instancer = new UnitInstancer(sheet, texture, packing, this.sim.capacity);
    // A re-load (unlikely, but `loadSprites` carries no such guarantee
    // against it) must not leak the mesh/material/texture it replaces.
    const previous = this.unitInstancers.get(unitTypeId);
    if (previous) {
      this.scene.remove(previous.mesh);
      previous.dispose();
    }
    this.unitInstancers.set(unitTypeId, instancer);
    this.scene.add(instancer.mesh);

    if (opts?.turretPath) {
      const turretRes = await fetch(`${opts.turretPath}manifest.json`);
      if (!turretRes.ok) throw new Error(`turret sheet manifest ${turretRes.status} at ${opts.turretPath}`);
      const turretSheet: SheetSpec = parseManifest(await turretRes.json());
      const turretPacking = packSheet(turretSheet);
      const turretTexture = await buildUnitTexture(opts.turretPath, turretSheet, turretPacking);
      const turretInstancer = new UnitInstancer(turretSheet, turretTexture, turretPacking, this.sim.capacity);
      const previousTurret = this.turretInstancers.get(unitTypeId);
      if (previousTurret) {
        this.scene.remove(previousTurret.mesh);
        previousTurret.dispose();
      }
      this.turretInstancers.set(unitTypeId, turretInstancer);
      this.scene.add(turretInstancer.mesh);
    } else {
      // A re-load that DROPS a previously-declared turretPath (not exercised
      // by any real caller today -- `main.ts`'s SPRITE_MAP is static -- but
      // `loadSprites` carries no guarantee against it) must not leave a
      // stale turret mesh drawing for a hull that no longer declares one.
      const stale = this.turretInstancers.get(unitTypeId);
      if (stale) {
        this.scene.remove(stale.mesh);
        stale.dispose();
        this.turretInstancers.delete(unitTypeId);
      }
    }
  }
  async loadStructureSprite(structureId: string, basePath: string): Promise<void> {
    this.retained.structureSheets.set(structureId, basePath);
    await Promise.resolve();
  }

  /**
   * A one-shot: a marker blooms at the ordered point and fades. There is no
   * state to retain -- replaying a queue of stale blooms when B3 arrives would
   * be wrong, not helpful -- and nothing to fabricate, so the honest answer is
   * that a backend with no marker layer has nothing to do with it. Exactly the
   * shape of `onEvents` above, which also receives real input and draws none
   * of it yet.
   *
   * Reached from the pointer handler, never from a loop -- but at `main.ts:962`
   * it is NOT the last statement: a throw there skipped `production.setArmed`
   * and left the drag box stuck on screen.
   */
  addOrderMarker(): void {
    /* B3 draws the marker */
  }

  /**
   * The tutorial focus ring is *state*, not a one-shot: set it and it stands
   * until cleared. So it retains, like its siblings above, rather than no-ops.
   *
   * Both halves run inside the 20 Hz tick loop (`main.ts:1233`/`:1238`)
   * whenever a tutorial is active -- which is every fresh-`localStorage` boot
   * of the first mission. Throwing there was the `updateHover` failure again:
   * 20 errors a second, and the tail of that block -- `tut.done`, the
   * completion flag, `runtime.completeObjective` -- never ran, so the tutorial
   * could not finish.
   */
  setTutorialFocus(x: number, y: number, radius: number): void {
    this.retained.tutorialFocus = { x, y, radius };
  }
  /** Truthfully: there is no ring drawn, and now none recorded either. */
  clearTutorialFocus(): void {
    this.retained.tutorialFocus = null;
  }

  private threeCamera(): THREE.OrthographicCamera {
    return dimetricCamera(this.camera, { width: this.width, height: this.height });
  }

  /** Wall-clock seconds since the previous frame, clamped exactly the way
   *  `PixiRenderer.frame()` clamps its own `dtSeconds` (`renderer.ts:1880`):
   *  a 100 ms ceiling so a tab returning from the background catches up in
   *  one bounded step instead of a huge stride. Shared by `updateUnits`
   *  (animation phase advance) and `updateFx` (particle/tracer ageing) so
   *  the two cannot silently clamp differently. */
  private frameDtSeconds(dtMs: number): number {
    return Math.min(dtMs, 100) / 1000;
  }

  /**
   * Builds this frame's `EntityFrame` for every living entity whose unit
   * type has a loaded `UnitInstancer`, grouped by type, and hands each
   * group to its instancer's `update`. The per-entity work ported from
   * Pixi's own unit loop (`renderer.ts:1919` onward) is exactly what
   * `entityFrame` (`frame-state.ts`) already decides -- this method's own
   * job is assembling its input from `Sim` and this class's own tracking
   * arrays, nothing more.
   *
   * `assignRoofSlots` runs once, over every entity, before any single one is
   * decided -- `frame-state.ts`'s own doc comment on why: it is a
   * cross-entity pre-pass, not a per-entity decision, "so the spread is
   * stable rather than flickering only because of that ordering."
   *
   * A unit type with no loaded `UnitInstancer` (a sheet still loading, or
   * one that never will) is silently skipped, matching this class's own
   * "no mesh units, no placeholder shape" scope line -- see the class-level
   * doc comment's "What B3.5 deliberately does not draw" section.
   */
  private updateUnits(alpha: number, dtMs: number): void {
    if (this.unitInstancers.size === 0) return;

    const dtSeconds = this.frameDtSeconds(dtMs);
    const st = this.sim.state;
    const n = this.sim.entityCount;
    const roofSlots = assignRoofSlots(st.garrisonedIn, st.alive, n);

    for (const frames of this.framesByType.values()) frames.length = 0;
    for (const frames of this.turretFramesByType.values()) frames.length = 0;

    for (let i = 0; i < n; i++) {
      if (st.alive[i] === 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const instancer = this.unitInstancers.get(type.id);
      if (!instancer) continue;
      // Task B3.6: absent when this type has no turret art -- doubles as
      // the has-a-turret gate `EntityFrameInput.turretSheet` documents.
      const turretInstancer = this.turretInstancers.get(type.id);

      const side = st.side[i];
      // Contact-level fade only applies to what is observed through
      // contact; the player's own units (side 0) are always full alpha, and
      // `entityFrame` ignores `contactLevel` for them regardless -- no need
      // to pay for the query.
      const contactLevel = side !== 0 ? this.sim.contactLevel(0, i) : 0;

      const inside = st.garrisonedIn[i];
      let roofPx = 0;
      if (inside >= 0) {
        // The roof plane, not the top of the art -- `terrain/buildings.ts`'s
        // own extrusion height, `heightPx`. ThreeRenderer has no structure
        // sprite atlas yet (structures still draw as procedural boxes), so
        // there is no `roofTopPx`/`badgeTopPx` to prefer the way Pixi does
        // when art is loaded -- `heightPx` is this backend's only answer,
        // not a fallback among several.
        const sType = this.sim.structureTypes[this.sim.structures.typeIdx[inside]];
        roofPx = sType.heightPx;
      }

      // Task B3.6: turret aim target, ported from renderer.ts:2113-2123 --
      // only computed when this type actually has turret art, the same
      // "no need to pay for the query" precedent `contactLevel` above
      // already follows. `null` means "no live target", and `entityFrame`
      // reads that as "spring back to the hull's own heading"
      // (`EntityFrameInput.turretTargetX`/`turretTargetY`'s own doc comment).
      let turretTargetX: number | null = null;
      let turretTargetY: number | null = null;
      if (turretInstancer) {
        const target = st.curTarget[i];
        const struct = st.curStructure[i];
        const aimAtStructure = target < 0 && struct >= 0 && this.sim.structures.alive[struct] === 1;
        if (target >= 0 && st.alive[target] !== 0) {
          turretTargetX = this.curX[target];
          turretTargetY = this.curY[target];
        } else if (aimAtStructure) {
          turretTargetX = fx.toNumber(this.sim.structures.cx[struct]);
          turretTargetY = fx.toNumber(this.sim.structures.cy[struct]);
        }
      }

      const anim: UnitAnimInput = {
        alive: st.alive[i],
        routed: st.routed[i],
        pinned: st.pinned[i],
        speed: this.entitySpeed[i],
        // Latched by onEvents' `fire` case (Task B3.14), drained once a
        // frame by drainTimers -- mirrors Pixi's own `this.firingTimer[i] >
        // 0` exactly (renderer.ts:2004).
        firing: this.firingTimer[i] > 0,
        working: this.sim.tunnelChargeProgress(i) > 0,
      };

      const input: EntityFrameInput = {
        entityId: i,
        prevX: this.prevX[i],
        prevY: this.prevY[i],
        curX: this.curX[i],
        curY: this.curY[i],
        alpha,
        elevation: this.retained.elevation,
        mapWidth: this.sim.width,
        mapHeight: this.sim.height,
        side,
        contactLevel,
        roofSlot: inside >= 0 ? roofSlots[i] : -1,
        roofPx,
        sheet: instancer.sheet,
        anim,
        dtSeconds,
        entityAnimFrame: this.entityAnimFrame,
        animSeeded: this.animSeeded,
        facing: st.facing[i],
        recoilT: this.recoilT[i],
        recoilDir: this.recoilDir[i],
        recoilPower: this.recoilPower[i],
        flinchT: this.flinchT[i],
        flinchDir: this.flinchDir[i],
        turretSheet: turretInstancer?.sheet ?? null,
        turretTargetX,
        turretTargetY,
        // Latched by onEvents' `fire` case (Task B3.6), independent of the
        // hull's own `firingTimer` above -- see `turretFiringTimer`'s own
        // doc comment for why the two cannot be the same signal.
        turretFiring: this.turretFiringTimer[i] > 0,
        turretFacing: this.turretFacing,
        turretVel: this.turretVel,
        turretSeeded: this.turretSeeded,
      };

      let list = this.framesByType.get(type.id);
      if (!list) {
        list = [];
        this.framesByType.set(type.id, list);
      }
      const frame = entityFrame(input);
      list.push(frame);

      if (turretInstancer) {
        // LIVING only -- `turretFramesByType` deliberately never receives a
        // `stepDeaths` synthetic frame; see this class's own field doc
        // comment on `turretFramesByType` for why.
        let turretList = this.turretFramesByType.get(type.id);
        if (!turretList) {
          turretList = [];
          this.turretFramesByType.set(type.id, turretList);
        }
        turretList.push(frame);
      }
    }

    this.stepDeaths(dtSeconds);

    for (const [typeId, instancer] of this.unitInstancers) {
      instancer.update(this.framesByType.get(typeId) ?? []);
      const turretInstancer = this.turretInstancers.get(typeId);
      if (turretInstancer) {
        turretInstancer.updateTurret(this.turretFramesByType.get(typeId) ?? [], instancer.sheet);
      }
    }
  }

  /**
   * Advances every unit mid-death-fade and, while still fading, appends a
   * synthetic `EntityFrame` for it into `framesByType` -- so the SAME
   * `UnitInstancer` a living unit of that type draws through also draws its
   * corpse, no separate mesh needed. Ported from Pixi's `stepDeaths`
   * (`renderer.ts:1230-1275), minus the permanent-wreckage half.
   *
   * Facing and `typeId` are captured at the moment of death (`onEvents`'s
   * `destroyed` case), not read live off `Sim` here, because the entity slot
   * may be reused by a later spawn before the fade finishes -- Pixi's own
   * comment on its `dying.push`, ported verbatim in spirit.
   *
   * Two things Pixi does that this method deliberately does NOT:
   *
   *  - **Rotation and squash** (`spr.rotation = p * 0.14`, the scale-Y
   *    settle). `writeUnitInstances`/`UnitInstancer` (both out of bounds for
   *    this task) only ever TRANSLATE an instance -- there is no rotation or
   *    non-uniform-scale attribute to write into, and adding one would mean
   *    editing a forbidden file. The fade keeps the alpha dim and a small
   *    downward `worldY` settle (below) but the body does not tip over.
   *  - **Permanent wreckage and its fog gate** (`addWreck`/`wreckLayer`/
   *    `MAX_WRECKS`, and the `isExplored` check that decides whether a
   *    fading OR wrecked unit draws at all). This backend has no fog system
   *    yet -- `isVisible()` always returns `true` (see this class's own top
   *    comment) -- so `isExplored`'s entire reason to exist, "you never
   *    witness a kill you did not observe", has no query to port against:
   *    the fade below draws unconditionally, and once it ends the entity
   *    simply stops drawing, with no wreck left behind. Wreckage belongs
   *    with whichever future task adds fog.
   *
   * A unit type with no loaded `UnitInstancer` is silently skipped, matching
   * this class's own "no mesh units" scope line -- and, since that also
   * governs `updateUnits`'s own early return, a dying entry's timer only
   * advances while at least one sheet is loaded; a mission where every unit
   * dies before any sheet finishes loading is the one case that stalls it,
   * and it stalls harmlessly (nothing would have been visible to fade
   * regardless).
   */
  private stepDeaths(dtSeconds: number): void {
    for (let k = this.dying.length - 1; k >= 0; k--) {
      const d = this.dying[k];
      d.t += dtSeconds;
      const p = Math.min(1, d.t / DEATH_SECONDS);
      const instancer = this.unitInstancers.get(d.typeId);
      if (instancer) {
        const clip = clipOrFallback(instancer.sheet, 'down');
        // Sink slightly as it settles -- Pixi's own `isoY(...) + p * 3`
        // (renderer.ts:1263), reproduced as a small downward WORLD-height
        // settle rather than a screen-space nudge, since there is no
        // post-projection position here to nudge (the same reasoning
        // `frame-state.ts`'s recoil/flinch doc comment gives, in reverse:
        // there it is a screen delta converted to world; here Pixi's own
        // "sink into the ground" reads most naturally as a real height
        // change, not a lateral one).
        const worldY =
          groundWorldY(this.retained.elevation, this.sim.width, this.sim.height, d.x, d.y) -
          p * 3 * WORLD_Y_PER_LIFT_PIXEL;
        const frame: EntityFrame = {
          wx: d.x,
          wy: d.y,
          worldY,
          clip,
          frame: 0,
          facing: d.facing,
          // Fades toward half, never to nothing -- matches Pixi's own
          // `1 - p * 0.5` (renderer.ts:1264) exactly.
          alpha: 1 - p * 0.5,
          roofDx: 0,
          roofDy: 0,
          visible: true,
          // Task B3.6: never drawn -- this synthetic frame only ever
          // reaches `framesByType` (the hull mesh), never
          // `turretFramesByType`, matching Pixi's own `stepDeaths`, which
          // draws no turret sprite for a dying unit at all (see
          // `turretFramesByType`'s own field doc comment). Still a
          // well-defined value rather than a sentinel, per `EntityFrame
          // .turretFacing`'s own contract.
          turretFacing: d.facing,
          turretClip: 'idle',
          turretFrame: 0,
        };
        let list = this.framesByType.get(d.typeId);
        if (!list) {
          list = [];
          this.framesByType.set(d.typeId, list);
        }
        list.push(frame);
      }
      if (d.t >= DEATH_SECONDS) this.dying.splice(k, 1);
    }
  }

  /**
   * Task B3.13/B3.14: ages and draws every live particle and tracer, every
   * frame, unconditionally -- mirrors `PixiRenderer.frame()`'s own `if
   * (this.particles) this.particles.step(dtSeconds)` (`renderer.ts:1902`)
   * plus its end-of-frame tracer step+draw (`renderer.ts:2597-2613`). Pixi's
   * `puffs` fallback path is NOT missing here -- Task B3.14's `spawnFlatFx`
   * (called from `onEvents`, above) routes the equivalent flat-colour
   * effects through this SAME `particleSystem`, so `updateFx` ages and draws
   * them exactly like any authored emitter's particles, with no separate
   * step of its own.
   *
   * `particleSystem` is `null` until `useEmitters` runs -- both
   * `ParticleInstancer.update` calls already handle that truthfully (see
   * their own doc comment), so there is nothing to guard here. `tracers`
   * needs no such guard: `stepTracers` (`units/tracers.ts`) is total over an
   * empty array.
   *
   * Called after `updateUnits`, but the ORDER between the two calls does not
   * matter for what ends up on screen -- NOT because three.js sorts by true
   * proximity (an earlier version of this comment claimed that; it does not:
   * every mesh here sits at its own untransformed origin, so three.js's
   * transparent-list sort ties on `z` for all of them and falls through to
   * `renderOrder` then insertion `id`). It does not matter because
   * `units/fx.ts`'s three FX meshes (Task B3.14 split the former two-mesh
   * pair into three -- see its own top comment, "The `above_units` split")
   * are each given an explicit `renderOrder` strictly above every unit's
   * default -- a declared choice ("FX draws after every unit"), not a
   * rediscovery of depth. `units/fx.ts`'s own top comment has the full
   * account, including the fix this replaced: without that explicit
   * `renderOrder`, FX-vs-unit draw order was an ACCIDENT of which class's
   * constructor three.js happened to run first, not a design. Occlusion
   * against terrain/buildings, for the below-tier particle mesh and for
   * tracers, is unaffected by any of this -- that still comes from real
   * `depthTest` against opaque, depth-writing geometry, independent of
   * `renderOrder` or of FX's own `depthWrite` (`false` for every FX
   * material, unlike units' `true`). The above-tier particle mesh
   * deliberately skips `depthTest` altogether -- see `units/fx.ts` for the
   * full reasoning on both counts.
   */
  private updateFx(dtMs: number): void {
    const dtSeconds = this.frameDtSeconds(dtMs);
    this.particleSystem?.step(dtSeconds);
    const elevation = this.retained.elevation;
    this.particleInstancerBelow.update(this.particleSystem, elevation, this.sim.width, this.sim.height);
    this.particleInstancerAbove.update(this.particleSystem, elevation, this.sim.width, this.sim.height);
    this.tracers = stepTracers(this.tracers, dtSeconds);
    this.tracerBatch.update(this.tracers, this.opts.tracerColors, elevation, this.sim.width, this.sim.height);
  }

  /**
   * (Re)builds the ground mesh, its scatter (grain) mesh, its grove (olive
   * trunk/crown) mesh, and its buildings (blocked-tile boxes) mesh from the
   * sim's static layout (`width`, `height`, `blocked`, `cover`,
   * `structures`) plus whatever `setElevation`/`setDecor` have retained, and
   * swaps all four into the scene in place of the previous set. The four are
   * independent builders over the identical `TerrainInput` -- none of
   * `buildScatter`, `buildGroves` or `buildBuildings` reads `buildGround`'s
   * output -- sharing only the material, so a mismatch between the ground's
   * palette tone and a mark's, a tree's or a building's alpha-composited
   * tone would be a bug in one of the builders, not in how this method wires
   * them together. `buildBuildings` alone also needs `structureFootprints()`
   * below, since it is the one builder whose input cannot be read off
   * `TerrainInput` alone.
   *
   * Only ever called from `frame()`, guarded by `terrainDirty` -- see that
   * field's doc comment for why building here, and not inside the setters,
   * is load-bearing rather than a style choice.
   *
   * Disposes each outgoing geometry before dropping the reference to it: a
   * rebuilt terrain that leaks its predecessor is invisible until a mission
   * rebuilds terrain a few hundred times, and then it is a memory bug nobody
   * can attribute. The material is not disposed -- `terrainMat` is reused
   * across rebuilds, not replaced (all four meshes share it).
   *
   * A gap this does not close: Pixi sets `terrainDirty` from `onEvents` on
   * `structureDestroyed` (`renderer.ts:881`), so a destroyed building's tile
   * repaints from blocked/`underBuilding` back to open ground there.
   * `ThreeRenderer.onEvents()` is still a B3 stub (events are not drawn
   * until units arrive), so nothing here ever re-fires this rebuild for that
   * reason -- the three.js ground keeps showing a destroyed structure's
   * footprint as still-blocked. Correctly out of B2's scope (there is
   * nothing yet to react to `onEvents` with), but left undocumented before
   * this comment, which is exactly the shape of gap that reads as a bug to
   * the next person who destroys a building on `?renderer=three` and
   * watches the ground not change.
   *
   * Task B2.7 makes this gap wider, not new: `buildingMesh` is built from
   * the SAME stale-until-rebuilt `TerrainInput`/`structureFootprints()`
   * snapshot, so a destroyed structure's box keeps standing on screen for
   * exactly the reason its ground tile keeps reading as blocked above --
   * `structureAt` would already report -1 for it (Sim truth is correct
   * immediately), but nothing tells this renderer to ask again. And even
   * once something does: B2.7 deliberately does NOT port `drawWreckedStructures`
   * (`renderer.ts:1759-1783`, a `Sprite` from `art.wreckTexture`) or invent a
   * rubble block to stand in for it -- "no structure sprites" is this plan's
   * own scope line, and inventing art is not porting. So a rebuilt
   * three.js terrain will make a destroyed structure's box disappear
   * outright (its tiles are unblocked, so the tile loop never reaches them),
   * with no rubble left behind where Pixi would show one. Both gaps are
   * B3's to close together, the same way `onEvents` itself is.
   */
  private rebuildTerrain(): void {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
    }
    if (this.scatterMesh) {
      this.scene.remove(this.scatterMesh);
      this.scatterMesh.geometry.dispose();
    }
    if (this.groveMesh) {
      this.scene.remove(this.groveMesh);
      this.groveMesh.geometry.dispose();
    }
    if (this.buildingMesh) {
      this.scene.remove(this.buildingMesh);
      this.buildingMesh.geometry.dispose();
    }
    const input: TerrainInput = {
      width: this.sim.width,
      height: this.sim.height,
      decor: this.retained.decor,
      elevation: this.retained.elevation,
      blocked: this.sim.blocked,
      cover: this.sim.cover,
    };
    const groundData = buildGround(input, this.opts.terrainTones, this.opts.background);
    this.terrainMesh = new THREE.Mesh(toGeometry(groundData), this.terrainMat);
    this.scene.add(this.terrainMesh);

    const scatterData = buildScatter(input, this.opts.terrainTones, this.opts.background);
    this.scatterMesh = new THREE.Mesh(toGeometry(scatterData), this.terrainMat);
    this.scene.add(this.scatterMesh);

    const groveData = buildGroves(input, this.opts.terrainTones, this.opts.background);
    this.groveMesh = new THREE.Mesh(toGeometry(groveData), this.terrainMat);
    this.scene.add(this.groveMesh);

    const buildingData = buildBuildings(
      input,
      structureFootprintsFor(this.sim),
      this.opts.terrainTones,
      this.opts.resolveColor,
      this.opts.background
    );
    this.buildingMesh = new THREE.Mesh(toGeometry(buildingData), this.terrainMat);
    this.scene.add(this.buildingMesh);
  }
}

/**
 * Every LIVING structure, as the plain-array snapshot `buildBuildings`
 * needs -- the pure builder must stay ignorant of `Sim`, so this is where
 * that boundary is actually crossed. Walks every tile once (same cost
 * `rebuildTerrain`'s own `TerrainInput` assembly already pays elsewhere)
 * asking `structureAt`, rather than trusting `structures.minX/maxX/minY/
 * maxY` as a solid rectangle -- a `per_tile` structure (a fence, a wall
 * run) is NOT a filled rectangle, and `structureAt` is the one query that
 * already gets this right for every structure shape the sim has.
 *
 * Deliberately draws no distinction between a structure with sprite art
 * and one without: `structureAtlas` is Pixi-only state this class does not
 * have, and Task B2.7's ruling is that B2 draws the block form for EVERY
 * structure regardless -- so there is nothing here to filter on even if
 * there were a reason to.
 *
 * A demolished structure never appears: `structureAt` returns -1 the
 * moment `alive` drops to 0 (and `destroyStructure` unblocks its whole
 * footprint besides), so this walk simply never visits its tiles. Whether
 * that walk itself re-runs when a structure dies is a separate question --
 * it does not, today, because `terrainDirty` is never set from `onEvents`
 * (a still-stubbed B3 concern, documented on `rebuildTerrain` above).
 *
 * Module-level (not a private method) and exported so
 * `packages/app/src/terrain-parity.test.ts` can build the same
 * `StructureFootprint[]` snapshot from its own `Sim` without maintaining a
 * second copy of this walk -- Task B2.8 duplicated it there verbatim
 * because this method was both private and, at the time, in a file B2's
 * later tasks were barred from editing. Task B3.1 lifts that bar: this is
 * now the one copy, reached from `ThreeRenderer` internally and from the
 * test (a `*.test.ts` file, exempt from the bundle-rule lint that would
 * otherwise stop `packages/app` from statically importing `@lions/render/
 * three`) via `@lions/render/three`.
 */
export function structureFootprintsFor(sim: Sim): StructureFootprint[] {
  const { width, height, structures: st, structureTypes } = sim;
  const tilesByStructure = new Map<number, number[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sIdx = sim.structureAt(x, y);
      if (sIdx < 0) continue;
      const tiles = tilesByStructure.get(sIdx);
      if (tiles) tiles.push(y * width + x);
      else tilesByStructure.set(sIdx, [y * width + x]);
    }
  }
  const footprints: StructureFootprint[] = [];
  for (const [sIdx, tiles] of tilesByStructure) {
    const type = structureTypes[st.typeIdx[sIdx]];
    footprints.push({
      tiles,
      heightPx: type.heightPx,
      colorKey: type.color,
      hp: st.hp[sIdx],
      maxHp: st.maxHp[sIdx],
    });
  }
  return footprints;
}
