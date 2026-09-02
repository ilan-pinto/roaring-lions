/**
 * GH #143: the legacy billboard collapse (`beginCollapse`) is gated on the
 * structure-type sprite maps (`structureIdle`/`structureCollapseArt`), which
 * `loadStructureSprite` populates unconditionally for the same seven building
 * types that also ship a mesh (`main.ts`'s `STRUCTURE_SPRITES` and
 * `MESH_BUILDINGS` overlap on all seven). So a structure whose type has a
 * loaded building mesh (`updateBuildingMeshes` swaps it to a wreck instantly)
 * ALSO span a mis-scaled 2D falling-sprite ghost of the standing billboard on
 * top of it -- `updateStructures` already guards the ordinary idle/wreck
 * billboard swap against this exact case ("Mesh wins", `ThreeRenderer.ts`);
 * `beginCollapse` did not carry the same guard.
 *
 * Reaches into private state the same way `ThreeRenderer.test.ts` already
 * does for `fogMesh`/`smokeMesh` -- there is no public seam for either the
 * sprite maps `loadStructureSprite` would populate (that path needs a real
 * `fetch` + `createImageBitmap`) or the mesh map `loadBuildingMesh` would
 * populate (a real GLB fetch), so both are armed directly with the minimal
 * headless-safe objects `beginCollapse` actually reads from them --
 * `StructureInstancer.spriteTexture` and the `{scale, textureWidth,
 * textureHeight}` triple `structureCollapseArt` stores. `buildingMeshIdleTemplates`
 * only needs a KEY to exist for the guard under test; `beginCollapse` never
 * reads through the stored value itself, so an empty stand-in object is
 * honest, not merely convenient.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { StructureInstancer, structureBillboardGeometry } from './units/structures';
import { MESH_SCALE } from './units/mesh-anim';
import { BUILDING_SETTLE_SECONDS, type BuildingMeshTemplate } from './units/mesh-building';
import { COLLAPSE_SHROUD_SWAP_DELAY_MS } from './units/collapse-shroud';
import shellImpact from '../../../../data/vfx/shell_impact.json';
import type { EmitterSpec } from '../vfx/emitters';

const disposeSpy = vi.fn();

// Identical stand-in to `ThreeRenderer.test.ts`'s own -- see that file's top
// comment for why `new THREE.WebGLRenderer(...)` cannot construct under this
// suite's headless `environment: 'node'`, and why every other object the
// constructor builds (including the `StructureInstancer`s armed below) needs
// no such stand-in.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    dispose(): void {
      disposeSpy();
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

/** A 4x4 sim with one `shanty` structure at tile (0,0) -- footprint centre
 *  irrelevant to this suite, only that `beginCollapse` has a real structure
 *  index and type to resolve. */
function buildSim(): { sim: Sim; structureIdx: number } {
  const sim = new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
  const type = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
  const structureIdx = sim.addStructure(type, [0]);
  return { sim, structureIdx };
}

/** The private surface this suite drives directly -- see this file's top
 *  comment for why there is no public seam for either half. */
interface Private {
  structureIdle: Map<string, StructureInstancer>;
  structureCollapseArt: Map<string, { scale: number; textureWidth: number; textureHeight: number }>;
  buildingMeshIdleTemplates: Map<string, unknown>;
  collapsing: readonly unknown[];
  beginCollapse(structure: number): void;
}

/** Arms `structureIdle`/`structureCollapseArt` for `typeId` -- the state
 *  `loadStructureSprite` would have left behind for a type with shipped
 *  billboard art, built here without the real fetch/image-decode that method
 *  needs (see this file's top comment). */
function armBillboardArt(renderer: ThreeRenderer, typeId: string): void {
  const priv = renderer as unknown as Private;
  const geometry = structureBillboardGeometry(1, 64, 64);
  const instancer = new StructureInstancer(new THREE.Texture(), geometry, 1);
  priv.structureIdle.set(typeId, instancer);
  priv.structureCollapseArt.set(typeId, { scale: 1, textureWidth: 64, textureHeight: 64 });
}

describe('ThreeRenderer.beginCollapse / building meshes (GH #143)', () => {
  it('plays the billboard collapse for a structure type with NO mesh loaded -- the inverse case that must keep working', () => {
    const { sim, structureIdx } = buildSim();
    const renderer = new ThreeRenderer(sim, makeOpts());
    armBillboardArt(renderer, 'shanty');
    const priv = renderer as unknown as Private;

    priv.beginCollapse(structureIdx);

    expect(priv.collapsing.length).toBe(1);
  });

  it('does NOT play the billboard collapse for a structure type with a mesh loaded -- the double-fire GH #143 reports', () => {
    const { sim, structureIdx } = buildSim();
    const renderer = new ThreeRenderer(sim, makeOpts());
    armBillboardArt(renderer, 'shanty');
    const priv = renderer as unknown as Private;
    // The exact state `loadBuildingMesh('shanty', ...)` leaves behind for
    // this guard's purposes -- `beginCollapse` only ever needs to know the
    // KEY is present, never anything the stored template itself carries.
    priv.buildingMeshIdleTemplates.set('shanty', {});

    priv.beginCollapse(structureIdx);

    expect(priv.collapsing.length).toBe(0);
  });
});

/** A minimal, headless-safe `BuildingMeshTemplate` -- a plain `THREE.Group`
 *  scaled the same way `buildBuildingMeshTemplate` leaves a real one
 *  (`root.scale.setScalar(MESH_SCALE)`), no materials/geometries. Stands in
 *  for what `loadBuildingMesh` would build from a real GLB (this suite has
 *  no `fetch`, matching `ThreeRenderer.collapse.test.ts`'s own top comment). */
function fakeBuildingMeshTemplate(): BuildingMeshTemplate {
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  return { root, materials: [], geometries: [] };
}

interface BuildingMeshPrivate {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshWreckTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshWreckEntities: Map<number, THREE.Object3D>;
  updateBuildingMeshes(): void;
  stepBuildingMeshSettle(dtSeconds: number): void;
}

describe('ThreeRenderer building-mesh wreck settle (GH #143 follow-up)', () => {
  it('starts a newly-appeared wreck mesh squashed on its Y axis, below its template baseline', () => {
    const { sim, structureIdx } = buildSim();
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as BuildingMeshPrivate;
    priv.buildingMeshIdleTemplates.set('shanty', fakeBuildingMeshTemplate());
    priv.buildingMeshWreckTemplates.set('shanty', fakeBuildingMeshTemplate());

    sim.structures.alive[structureIdx] = 0;
    priv.updateBuildingMeshes();

    const wreckRoot = priv.buildingMeshWreckEntities.get(structureIdx);
    expect(wreckRoot).toBeDefined();
    expect(wreckRoot!.scale.y).toBeLessThan(MESH_SCALE);
    expect(wreckRoot!.scale.y).toBeGreaterThan(0);
    // Only height grows in -- the footprint (x/z) must not shift, or the
    // walls would visibly slide relative to the ground tile the sim already
    // fixed at spawn.
    expect(wreckRoot!.scale.x).toBeCloseTo(MESH_SCALE, 10);
    expect(wreckRoot!.scale.z).toBeCloseTo(MESH_SCALE, 10);
  });

  it('grows the wreck to its full template scale by BUILDING_SETTLE_SECONDS, stepped in increments', () => {
    const { sim, structureIdx } = buildSim();
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as BuildingMeshPrivate;
    priv.buildingMeshIdleTemplates.set('shanty', fakeBuildingMeshTemplate());
    priv.buildingMeshWreckTemplates.set('shanty', fakeBuildingMeshTemplate());

    sim.structures.alive[structureIdx] = 0;
    priv.updateBuildingMeshes();
    const wreckRoot = priv.buildingMeshWreckEntities.get(structureIdx)!;
    const startScale = wreckRoot.scale.y;

    // Stepped in several increments, the way `frame()` actually calls it at
    // 60 Hz, rather than one lump advance -- proves the bookkeeping (`t`
    // accumulating across calls) works, not just the pure curve function
    // already proven in isolation (`mesh-building.test.ts`).
    const dt = BUILDING_SETTLE_SECONDS / 7;
    for (let i = 0; i < 7; i++) priv.stepBuildingMeshSettle(dt);

    expect(wreckRoot.scale.y).toBeCloseTo(MESH_SCALE, 5);
    expect(wreckRoot.scale.y).toBeGreaterThan(startScale);
  });

  it('does not re-arm an already-settled wreck on a later frame -- updateBuildingMeshes only inserts once', () => {
    const { sim, structureIdx } = buildSim();
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as BuildingMeshPrivate;
    priv.buildingMeshIdleTemplates.set('shanty', fakeBuildingMeshTemplate());
    priv.buildingMeshWreckTemplates.set('shanty', fakeBuildingMeshTemplate());

    sim.structures.alive[structureIdx] = 0;
    priv.updateBuildingMeshes();
    priv.stepBuildingMeshSettle(BUILDING_SETTLE_SECONDS);
    const wreckRoot = priv.buildingMeshWreckEntities.get(structureIdx)!;
    expect(wreckRoot.scale.y).toBeCloseTo(MESH_SCALE, 10);

    // A later frame's poll of the same dead structure must not reset the
    // scale back down to squashed -- `updateBuildingMeshes` only inserts a
    // NEW wreck clone the first time it sees a structure dead
    // (`!this.buildingMeshWreckEntities.has(s)`), so calling it again here
    // is exactly what happens on frame 2, 3, ... of the same mission.
    priv.updateBuildingMeshes();

    expect(wreckRoot.scale.y).toBeCloseTo(MESH_SCALE, 10);
  });
});

/**
 * The collapse SHROUD and the standing-mesh hold it exists to cover
 * (`units/collapse-shroud.ts`). The pure lattice/envelope maths and the
 * pooled manager are covered in `units/collapse-shroud.test.ts`; what is
 * proven HERE is the wiring those cannot see -- that the swap is actually
 * held, that the shroud is actually sized from the structure, and that a
 * shell impact cannot reach either.
 */
interface ShroudPrivate extends BuildingMeshPrivate {
  buildingMeshSwapHold: Map<number, number>;
  buildingMeshBounds: Map<string, THREE.Vector3>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  collapseShrouds: {
    liveCount: number;
    instanceCount: number;
    step(dtMs: number): void;
    mesh: THREE.InstancedMesh;
  };
  structureCollapseArt: Map<string, { scale: number; textureWidth: number; textureHeight: number }>;
  beginCollapseShroud(structure: number, cx: number, cy: number): void;
  stepCollapseShrouds(dtMs: number): void;
  spawnCollapseFx(id: string, bx: number, by: number, power?: number, yawTurns?: number): boolean;
}

/** Sim + renderer with `shanty` mesh-arted and its standing clone already in
 *  the scene -- the state a real mission is in on the frame before a building
 *  dies. `boundsY` sizes the stand-in template so a test can vary the
 *  BUILDING and watch the shroud follow. */
function armMeshBuilding(boundsY = 3): {
  sim: Sim;
  structureIdx: number;
  renderer: ThreeRenderer;
  priv: ShroudPrivate;
} {
  const { sim, structureIdx } = buildSim();
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ShroudPrivate;
  priv.buildingMeshIdleTemplates.set('shanty', fakeBuildingMeshTemplate());
  priv.buildingMeshWreckTemplates.set('shanty', fakeBuildingMeshTemplate());
  // What `loadBuildingMesh` measures off the real GLB.
  priv.buildingMeshBounds.set('shanty', new THREE.Vector3(2, boundsY, 2));
  priv.updateBuildingMeshes(); // stands the idle clone up while it is alive
  return { sim, structureIdx, renderer, priv };
}

describe('ThreeRenderer collapse shroud: the swap is held until the smoke hides it', () => {
  it('keeps the STANDING mesh in the scene while the shroud is owed', () => {
    const { sim, structureIdx, priv } = armMeshBuilding();
    expect(priv.buildingMeshIdleEntities.has(structureIdx)).toBe(true);

    sim.structures.alive[structureIdx] = 0;
    priv.beginCollapseShroud(structureIdx, 0.5, 0.5);
    priv.updateBuildingMeshes();

    // Without the hold this is the frame the hard cut happens on.
    expect(priv.buildingMeshIdleEntities.has(structureIdx)).toBe(true);
    expect(priv.buildingMeshWreckEntities.has(structureIdx)).toBe(false);
    expect(priv.collapseShrouds.liveCount).toBe(1);
  });

  it('swaps to the wreck once the hold runs out, and not before', () => {
    const { sim, structureIdx, priv } = armMeshBuilding();
    sim.structures.alive[structureIdx] = 0;
    priv.beginCollapseShroud(structureIdx, 0.5, 0.5);

    // One frame short of the delay: still standing.
    priv.stepCollapseShrouds(COLLAPSE_SHROUD_SWAP_DELAY_MS - 1000 / 60);
    priv.updateBuildingMeshes();
    expect(priv.buildingMeshWreckEntities.has(structureIdx)).toBe(false);

    // Past it: swapped. Two frames rather than the one that arithmetically
    // finishes the hold -- `420 - (420 - 1000/60) - 1000/60` is 1.8e-14, not
    // 0, so an exact-change step leaves a hold of a femtosecond owed. Real
    // frames never land on the boundary and the effect is invisible either
    // way; the test simply must not depend on binary floating point summing
    // to exactly zero.
    priv.stepCollapseShrouds((2 * 1000) / 60);
    priv.updateBuildingMeshes();
    expect(priv.buildingMeshIdleEntities.has(structureIdx)).toBe(false);
    expect(priv.buildingMeshWreckEntities.has(structureIdx)).toBe(true);
  });

  it('still has the shroud at full density on the frame the swap lands', () => {
    // The two halves of the mechanism, checked against each other rather than
    // separately: the hold expiring and the cloud still being opaque are the
    // same claim, and a test that only checked the hold would pass with the
    // shroud already half faded.
    const { sim, structureIdx, priv } = armMeshBuilding();
    sim.structures.alive[structureIdx] = 0;
    priv.beginCollapseShroud(structureIdx, 0.5, 0.5);
    for (let ms = 0; ms < COLLAPSE_SHROUD_SWAP_DELAY_MS; ms += 1000 / 60) {
      priv.stepCollapseShrouds(1000 / 60);
      priv.collapseShrouds.step(1000 / 60);
    }
    priv.updateBuildingMeshes();
    expect(priv.buildingMeshWreckEntities.has(structureIdx)).toBe(true);

    const opacity = priv.collapseShrouds.mesh.geometry.getAttribute(
      'aOpacity'
    ) as THREE.InstancedBufferAttribute;
    expect(priv.collapseShrouds.instanceCount).toBeGreaterThan(0);
    for (let i = 0; i < priv.collapseShrouds.instanceCount; i++) {
      expect(opacity.getX(i), `puff ${i} had already started to thin`).toBe(1);
    }
  });

  it('does NOT hold a structure that has no standing clone to hold', () => {
    // Holding here would leave bare ground where the building is for the
    // whole delay -- the same hard cut, inverted.
    const { sim, structureIdx, priv } = armMeshBuilding();
    priv.buildingMeshIdleEntities.delete(structureIdx);

    sim.structures.alive[structureIdx] = 0;
    priv.beginCollapseShroud(structureIdx, 0.5, 0.5);

    expect(priv.buildingMeshSwapHold.has(structureIdx)).toBe(false);
    expect(priv.collapseShrouds.liveCount).toBe(1); // ...but it is still shrouded
  });

  it('sizes the shroud from the BUILDING, so a taller one gets a taller cloud', () => {
    const short = armMeshBuilding(1);
    short.sim.structures.alive[short.structureIdx] = 0;
    short.priv.beginCollapseShroud(short.structureIdx, 0.5, 0.5);
    short.priv.collapseShrouds.step(COLLAPSE_SHROUD_SWAP_DELAY_MS);

    const tall = armMeshBuilding(8);
    tall.sim.structures.alive[tall.structureIdx] = 0;
    tall.priv.beginCollapseShroud(tall.structureIdx, 0.5, 0.5);
    tall.priv.collapseShrouds.step(COLLAPSE_SHROUD_SWAP_DELAY_MS);

    const top = (p: ShroudPrivate): number => {
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      let highest = -Infinity;
      for (let i = 0; i < p.collapseShrouds.instanceCount; i++) {
        p.collapseShrouds.mesh.getMatrixAt(i, m);
        m.decompose(pos, q, s);
        highest = Math.max(highest, pos.y + s.y);
      }
      return highest;
    };
    // A constant-size puff would make these equal; that is the failure this
    // catches, and it is the one the brief calls out ("a fixed-size puff will
    // swallow the wall and leave the apartment's top floors bare").
    expect(top(tall.priv)).toBeGreaterThan(2 * top(short.priv));
    // ...and the tall one actually reaches over its own roof.
    expect(top(tall.priv)).toBeGreaterThan(8);
  });

  it('is NOT reachable from a shell impact -- that path has no structure at all', () => {
    // `shell_impact.json` goes through `spawnCollapseFx`, the same method a
    // structure collapse uses for its burst and plume. The shroud is
    // deliberately spawned OUTSIDE that method, from the `structureDestroyed`
    // branch, because it is sized from the structure's own extents and
    // `spawnCollapseFx` knows only a point. This is what makes "shell impacts
    // are unaffected" a fact rather than an intention.
    const { renderer, priv } = armMeshBuilding();
    // Through the real public seam, so the `ParticleSystem` this path needs
    // exists exactly as it does in the app.
    renderer.useEmitters([shellImpact as unknown as EmitterSpec], () => '#C29455');
    const spawned = priv.spawnCollapseFx('shell_impact', 1.5, 1.5, 0.3, 0);

    expect(spawned).toBe(true); // the emitter really did run
    expect(priv.collapseShrouds.liveCount).toBe(0);
  });
});
