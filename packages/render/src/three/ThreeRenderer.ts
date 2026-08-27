/**
 * The three.js backend. Phase B1 got it on screen with nothing but the clear
 * colour; Phase B2.4 adds the first drawn geometry -- terrain, built lazily
 * from `buildGround` (see `rebuildTerrain` below) and uploaded once per
 * change via `toGeometry`/`terrainMaterial`.
 *
 * Three kinds of not-yet-implemented member, and the line between them is the
 * whole discipline of this phase: *inventing an answer* is forbidden;
 * *reporting the current state truthfully* is not.
 *
 *  - **Data pushed in** *retains* its argument and returns: `setDecor`,
 *    `setElevation`, `useEmitters`, the two sprite loaders, and
 *    `setTutorialFocus`/`clearTutorialFocus` (a focus ring is state, not a
 *    one-shot). The data has arrived and is correct; it simply is not drawn
 *    until B2/B3/B4. Throwing here made `?renderer=three` unreachable in the
 *    first place -- the boot threw at `setDecor` before `init` ever appended
 *    the canvas, so the one thing B1 draws could not be seen at all.
 *  - **Truthful no-ops**, where "nothing to do" is the honest answer rather
 *    than a dodge: `snapshot` (nothing to latch), `onEvents` (nothing draws
 *    yet), `addOrderMarker` (a one-shot with no state worth keeping), and
 *    `isVisible`, which returns `true` because fog is B4 and a backend with no
 *    fog hides nothing.
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
 */
import * as THREE from 'three';
import type { Sim } from '@lions/sim';
import type { Renderer, RendererOptions } from '../api'; // both, after Step 2
import type { Camera } from '../project';
import type { EmitterSpec } from '../vfx';
import { dimetricCamera, worldToScreenThree, screenToWorldThree } from './camera';
import { applyPalettePipeline } from './palette-material';
import { buildGround } from './terrain/ground';
import { buildScatter } from './terrain/scatter';
import { buildGroves } from './terrain/grove';
import { buildBuildings, type StructureFootprint } from './terrain/buildings';
import { toGeometry, terrainMaterial } from './terrain/mesh';
import type { TerrainInput } from './terrain/types';

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

  constructor(
    private readonly sim: Sim,
    private readonly opts: RendererOptions
  ) {
    this.unitGroup = new Uint8Array(sim.capacity);
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

  /** `alpha`/`dtMs` (interpolation, presentation animation) go unread until
   *  B3 draws anything they could apply to -- terrain has none. */
  frame(): void {
    if (this.terrainDirty) {
      this.rebuildTerrain();
      this.terrainDirty = false;
    }
    this.renderer.render(this.scene, this.threeCamera());
  }

  snapshot(): void {
    /* nothing to latch until B3 draws units */
  }
  onEvents(): void {
    /* B3 */
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
  async loadSprites(
    unitTypeId: string,
    basePath: string,
    opts?: { turretPath?: string }
  ): Promise<void> {
    this.retained.unitSheets.set(unitTypeId, { basePath, turretPath: opts?.turretPath });
    await Promise.resolve();
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
      this.structureFootprints(),
      this.opts.terrainTones,
      this.opts.resolveColor,
      this.opts.background
    );
    this.buildingMesh = new THREE.Mesh(toGeometry(buildingData), this.terrainMat);
    this.scene.add(this.buildingMesh);
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
   */
  private structureFootprints(): StructureFootprint[] {
    const { width, height, structures: st, structureTypes } = this.sim;
    const tilesByStructure = new Map<number, number[]>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sIdx = this.sim.structureAt(x, y);
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
}
