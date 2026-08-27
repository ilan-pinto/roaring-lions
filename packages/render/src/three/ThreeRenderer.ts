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
 *    `useEmitters`, `loadStructureSprite`, and `setTutorialFocus`/
 *    `clearTutorialFocus` (a focus ring is state, not a one-shot). The data
 *    has arrived and is correct; it simply is not drawn until B4 (VFX,
 *    structure sprites) or is presentation-only Phase C state
 *    (`setTutorialFocus`). `setDecor` and `loadSprites` graduated out of this
 *    bucket in B2.6 and B3.5 respectively -- both now draw what they are
 *    given, immediately or on the next `frame()`.
 *  - **Truthful no-ops**, where "nothing to do" is the honest answer rather
 *    than a dodge: `onEvents` (event-driven presentation -- fire flashes,
 *    deaths, damage tint -- is B4/Phase C; every clip `entityFrame` can
 *    already resolve from direct per-tick `Sim` state alone, `working`
 *    included, needs no event feed at all), `addOrderMarker` (a one-shot
 *    with no state worth keeping), and `isVisible`, which returns `true`
 *    because fog is B4 and a backend with no fog hides nothing. `snapshot`
 *    graduated out of this bucket in B3.5: it now latches per-entity
 *    position and measures ground speed, the same job Pixi's own `snapshot`
 *    does, because `frame()` needs both to draw a single moving unit.
 *  - **Throws**: `pickUnit` and `unitsInScreenRect`, the only two members that
 *    would have to *fabricate*. `-1` and `[]` both mean "you clicked empty
 *    ground", the player acts on that, and it would be believed. A stack trace
 *    naming the method is the better failure -- accepted even though a throw
 *    at `main.ts:968` leaves the drag box on screen, because neither is
 *    reached from a loop and silent wrongness in a *selection* is worse.
 *
 * The rule that catches these: any member reached from the 60 Hz frame loop,
 * the 20 Hz tick loop, or a block whose tail matters must not throw unless
 * fabricating is the only alternative. Two rounds of review found members that
 * broke it -- `isVisible` in the frame loop, the tutorial focus pair in the
 * tick loop -- so weigh that before adding a `notYet` to anything new.
 *
 * ## What B3.5 deliberately does not draw
 *
 * `units/frame-state.ts`'s landed `EntityFrame` carries exactly what B3.3
 * decided a unit needs: position, ground/roof lift, clip, frame, facing,
 * body alpha. Everything Pixi's own unit loop draws beyond that --
 * `firing`'s one-shot pose (latched from a `fired` `SimEvent`, and `onEvents`
 * is still a stub per the bucket above), recoil/flinch/tremble/footfall-bob
 * screen-space nudges, air-lift for `isAir` types (the sim's own `UnitType`
 * doc comment calls this "presentation" and names the renderer as the thing
 * that lifts it -- `frame-state.ts` does not), turret sprites, and the
 * procedural-primitive fallback for a unit type with no loaded sheet -- is
 * out of scope here. None of it can be added without either modifying
 * `frame-state.ts` (barred this task) or reimplementing logic that module
 * already owns (exactly the "second clip resolver" risk its own doc comment
 * warns against). A unit type with no loaded sheet simply is not drawn: "no
 * mesh units" (the B3 brief's own scope line) rules out inventing a
 * placeholder shape for it the way Pixi's circle fallback does.
 */
import * as THREE from 'three';
import { fx, type Sim } from '@lions/sim';
import type { Renderer, RendererOptions } from '../api'; // both, after Step 2
import type { Camera } from '../project';
import type { EmitterSpec } from '../vfx';
import { SIM_HZ } from '../anim';
import { parseManifest, type SheetSpec } from '../sheet';
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

function notYet(member: string): never {
  throw new Error(
    `ThreeRenderer.${member} is not implemented until a later Phase B sub-plan. ` +
      `Use ?renderer=pixi (the default) for anything that needs it.`
  );
}

/** Where a unit type's sheets live, as the app named them. */
interface SpriteSheetRequest {
  basePath: string;
  turretPath?: string;
}

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
   * One bag rather than seven fields on purpose: it keeps what B2/B3/B4
   * inherit visible at a glance. Terrain (`decor`, `elevation`) is read by
   * `rebuildTerrain` below whenever `terrainDirty` is set; the emitter list
   * and its palette resolver are VFX, which is B4's; the two sheet maps and
   * the tutorial focus ring are B3's -- still retained only, not drawn.
   */
  private readonly retained = {
    decor: null as Uint8Array | null,
    elevation: null as Uint8Array | null,
    emitters: [] as EmitterSpec[],
    resolveColor: null as ((key: string) => string) | null,
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

  /** One `UnitInstancer` per unit type with a loaded sheet, keyed by the
   *  unit type id `loadSprites` was called with. */
  private readonly unitInstancers = new Map<string, UnitInstancer>();
  /** Reused across frames (`.length = 0` each `frame()`, not reallocated) --
   *  every living entity's `EntityFrame` this tick, grouped by its unit
   *  type id, the shape `UnitInstancer.update` consumes. */
  private readonly framesByType = new Map<string, EntityFrame[]>();

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
   *  advance) now feed every living unit's `EntityFrame` via `updateUnits`.
   *  Terrain still reads neither: it has no per-frame presentation state. */
  frame(alpha: number, dtMs: number): void {
    if (this.terrainDirty) {
      this.rebuildTerrain();
      this.terrainDirty = false;
    }
    this.updateUnits(alpha, dtMs);
    this.renderer.render(this.scene, this.threeCamera());
  }

  /**
   * Copy positions after every sim tick; `frame()` lerps between the
   * copies -- the three.js counterpart to `PixiRenderer.snapshot()`
   * (`renderer.ts:729-751`). Ground speed is measured from the tick delta
   * rather than read off the unit type, matching Pixi exactly, so cover
   * slowdowns, pinning and mobility kills pace the gait for free.
   *
   * Deliberately does not port Pixi's fog/trail refresh (`this.fogTick++ %
   * 4 === 0` gating `updateFog`/`drawTrail`) or turret-facing seed -- fog
   * and trails are B4, and turrets are out of scope for B3.5 (see this
   * class's own top comment).
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
  onEvents(): void {
    /* Event-driven presentation -- fire-flash timing, deaths, damage tint,
     * trails -- is B4/Phase C. Every clip `entityFrame` can already resolve
     * from direct per-tick Sim state alone (dead/routed/pinned/working/
     * moving/idle); only the one-shot `fire` pose needs an event feed
     * (Pixi's own `firingTimer`, latched from a `fired` SimEvent), and it is
     * the one clip units drawn by this backend do not yet show. */
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return worldToScreenThree(wx, wy, this.camera, { width: this.width, height: this.height });
  }
  screenToWorld(px: number, py: number): { x: number; y: number } {
    return screenToWorldThree(px, py, this.camera, { width: this.width, height: this.height });
  }

  // --- queries. The line is between *inventing* an answer and *reporting the
  //     current state truthfully*, not between "implemented" and "not".
  pickUnit(): number {
    return notYet('pickUnit');
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
  unitsInScreenRect(): number[] {
    return notYet('unitsInScreenRect');
  }

  // --- world data pushed in. Decor/elevation are now drawn (terrain);
  //     the rest stays retained only, for B3/B4.
  setElevation(elevation: Uint8Array): void {
    this.retained.elevation = elevation;
    this.terrainDirty = true;
  }
  setDecor(decor: Uint8Array): void {
    this.retained.decor = decor;
    this.terrainDirty = true;
  }
  useEmitters(list: EmitterSpec[], resolve: (key: string) => string): void {
    this.retained.emitters = list;
    this.retained.resolveColor = resolve;
  }
  /**
   * Load a unit type's sprite sheet and build the `THREE.InstancedMesh`
   * (`UnitInstancer`) it draws through -- one draw call for however many of
   * this type end up alive, per Ruling 1.
   *
   * `opts.turretPath` is retained but not loaded: turret sprites are out of
   * scope for B3.5 (see this class's own top comment) -- `frame-state.ts`'s
   * landed `EntityFrame`/`EntityFrameInput` carry no turret facing or clip
   * at all, so there is nothing downstream that could consume a second
   * sheet yet.
   *
   * Errors propagate rather than being swallowed: `main.ts` already wraps
   * every `loadSprites` call in its own `.catch` per unit type (so one
   * missing sheet does not stop the rest of the roster from loading), which
   * is exactly Pixi's own failure mode for the identical call.
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

    const dtSeconds = Math.min(dtMs, 100) / 1000;
    const st = this.sim.state;
    const n = this.sim.entityCount;
    const roofSlots = assignRoofSlots(st.garrisonedIn, st.alive, n);

    for (const frames of this.framesByType.values()) frames.length = 0;

    for (let i = 0; i < n; i++) {
      if (st.alive[i] === 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const instancer = this.unitInstancers.get(type.id);
      if (!instancer) continue;

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

      const anim: UnitAnimInput = {
        alive: st.alive[i],
        routed: st.routed[i],
        pinned: st.pinned[i],
        speed: this.entitySpeed[i],
        // The one clip this backend cannot yet show -- see onEvents' own
        // comment for why.
        firing: false,
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
      };

      let list = this.framesByType.get(type.id);
      if (!list) {
        list = [];
        this.framesByType.set(type.id, list);
      }
      list.push(entityFrame(input));
    }

    for (const [typeId, instancer] of this.unitInstancers) {
      instancer.update(this.framesByType.get(typeId) ?? []);
    }
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
