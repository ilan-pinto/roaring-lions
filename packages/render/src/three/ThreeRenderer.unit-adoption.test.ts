/**
 * GH-943 P3 (T1): the unit seam on a node boot. Every unit swap site queues its subtree for adoption (`queueNodeAdoption`), the
 * queue is adopted at the top of the next node render (`flushNodeAdoption`), and every clone site clones the LEGACY material.
 *
 * Harness: a node boot through a mocked `./backend/node-backend` whose kit is a STUB (every slot returns a `MeshStandardNodeMaterial`
 * tagged `rlLegacy`), a faked `WebGLRenderer` and a stubbed legacy post chain (for the legacy arm), and the real template builders
 * fed fixture GLBs through mocked loaders: a Lavi whose hull carries the team mark and running-gear attributes, and a wounded KDF
 * figure under rain (rain rim, then wounded floor).
 *
 * Gates, each with its one-line falsification (run by hand, listed in the commit message):
 *  - G1 every swap site adopts: after every frame the census WITHOUT `portedKeys`, plus the `unadopted` backstop, names no unit
 *    segment. Falsify: delete the `queueNodeAdoption` after `bindRunningGear` (the move frame names `rl-running-gear-1`), or the
 *    `adopt?.(root)` in `beginMeshDeathFade` (the fade frame names the fade clone).
 *  - G2 clone sites clone the legacy material: the running-gear clone, the fade clone and the scar are cut from the legacy team
 *    variant and keep its hook segments. Falsify: drop `legacyOf` in `running-gear-binding.ts`, in `mesh-death.ts`'s
 *    `beginMeshDeathFade`, or in `vehicle-damage.ts`'s `applyVehicleDamageBand`, one at a time. Ruling P3-R2: two hulls sharing
 *    one twin, scarred to different bands, each fade from their OWN scar. Falsify: `legacyOf` reads only the twin's key.
 *  - G3 no new program per vehicle: a second hull's running-gear bind and a second entity's fade add no twin and no material.
 *    Falsify: key the memo on the clone (`const base = legacyBaseOf(m)` -> `const base = m`).
 *  - G8 legacy is untouched: a legacy boot never calls the kit and never queues. Falsify: remove `queueNodeAdoption`'s guard.
 *  - Ruling P3-R4: hiding then showing a legacy material after adoption, the twin follows on the next render.
 *    Falsify: mirror only false -> true in `mirrorTwinVisibility`, or drop its call from `flushNodeAdoption`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import type { NodeBackendOptions } from './backend/node-backend';
import { censusUnadopted, censusUnported, type UnportedHook } from './backend/unported';
import { ThreeRenderer } from './ThreeRenderer';
import { hookSegments, UNIT_HOOK_SEGMENTS } from './material-names';
import { isTwin, legacyBaseOf, legacyOf, TWIN_LEGACY_KEY } from './twin-identity';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import type { MeshUnitEntity } from './units/mesh-unit';
import type { MeshFaction } from './units/mesh-role';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import { parseFixture } from './units/mesh-fixture';
import { parseRunningGear } from './units/running-gear';
import { runningGearBinding } from './units/running-gear-binding';
import { insigniaHookOf, teamHookOf } from './units/team-mask';
import type { DyingVehicle } from './units/mesh-vehicle-death';
import type { DyingMeshUnit } from './units/mesh-death';
import { MESH_DEATH_SECONDS } from './units/mesh-death';
import type { BackdropSpec, LoadedBackdropKit } from './terrain/backdrop';
import { readKitFixture } from './terrain/backdrop-kit-fixture';
import { webGpuFormats } from './units/webgpu-vertex-format.test-support';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    shadowMap = { enabled: false, type: actual.PCFShadowMap };
    info = { reset(): void {}, render: { calls: 0, triangles: 0 }, autoReset: true };
    setClearColor(): void {}
    setPixelRatio(): void {}
    getPixelRatio(): number {
      return 1;
    }
    setSize(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('./post-chain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./post-chain')>();
  return {
    ...actual,
    createPostChain: () => ({
      setFogPass(): void {},
      setAoPass(): void {},
      setBloomPass(): void {},
      setSize(): void {},
      render(): void {},
      dispose(): void {},
      vignette: { enabled: false },
      grade: { apply(): void {}, enabled: false },
    }),
  };
});

const seam = vi.hoisted(() => ({ kit: null as MaterialKit | null, opts: null as NodeBackendOptions | null }));

vi.mock('./backend/node-backend', () => ({
  createNodeBackend: async (opts: NodeBackendOptions): Promise<{ backend: RenderBackend }> => {
    seam.opts = opts;
    if (seam.kit === null) throw new Error('spec: no stub kit');
    const backend = {
      kind: 'node-webgl2',
      adapter: 'webgl2',
      domElement: {} as HTMLCanvasElement,
      setPixelRatio(): void {},
      getPixelRatio: () => 1,
      setSize(): void {},
      kit: { fog: null, ao: null, bloom: null },
      materials: seam.kit,
      setFog(): void {},
      setOutputMaths(): void {},
      bloom: { setEnabled: () => false, setFade(): void {}, strength: 0, built: false, readPreBloom: async () => null },
      pmrem: {},
      ao: null,
      configure(): void {},
      post: null,
      async prepare(): Promise<void> {},
      render(): void {},
      photographGround: async () => null,
      captureView: async () => null,
      whenSubmitted: async () => {},
      unported: () => [],
      stats: () => ({ calls: 0, triangles: 0 }),
      dispose(): void {},
    };
    return { backend: backend as unknown as RenderBackend };
  },
}));

/** The team mark the Lavi's material declares (`units/team-mask.test.ts`'s fixture). */
const MARK = {
  version: 1,
  roof: { x: [-1.7, -0.4], z_half: 0.7, y: [2.28, 2.56], min_ny: 0.6 },
  band: { x: [-1.7, -0.4], y: [2.12, 2.3], min_nz: 0.6 },
  exclude_uv: [[0.28149, 0.21069], [0.26978, 0.26538], [0.86938, 0.82397]],
  exclude_radius: 0.0002,
  luma: 0.17655,
  team_fraction: 0.021,
};
const RG_SPEC = parseRunningGear(
  { rl_running_gear: { version: 1, wheels: [{ side: 'r', index: 0, centre: [1, 0.4, 0.9], radius: 0.4, cutRadius: 0.41, steer: false, maxSteerRad: 0 }], tracks: [] } },
  'fixture'
);

/** Every `_rl_wheel` attribute `laviTemplate` made, in order (GH-1319: a legacy boot must draw exactly these objects). */
const fixtureWheels: THREE.InterleavedBufferAttribute[] = [];

/** The Lavi fixture: one hull, an `idle` and a `wreck` clip, its material team-marked and its geometry wheel-tagged. */
async function laviTemplate(): Promise<VehicleMeshTemplate> {
  const built = buildVehicleMeshTemplate(
    await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }], clipNames: ['idle', 'wreck'], deathRoot: { parts: ['hull_hull'] } }),
    'mbt_lavi'
  );
  {
    built.root.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      // The live hull only: the `WRECK_` twin keeps its own charred material.
      if (!mesh.isMesh || mesh.name.startsWith('WRECK_') || (mesh.userData as { rl_role?: unknown }).rl_role !== 'hull') return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (!m.isMeshStandardMaterial) return;
      m.map = new THREE.Texture();
      m.userData = { ...(m.userData as Record<string, unknown>), rl_team_mark: MARK };
      const n = mesh.geometry.getAttribute('position').count;
      // GH-1319: the SHIPPED shape. `DRACOLoader` pads the 1-byte `_RL_WHEEL` scalar to a 4-byte stride and hands it over
      // interleaved (a plain `BufferAttribute(Uint8Array)`, which three widens itself, hid the WebGPU crash).
      const wheelBytes = new Uint8Array(n * 4);
      for (let v = 0; v < n; v++) wheelBytes[v * 4] = 1;
      const wheel = new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(wheelBytes, 4), 1, 0);
      fixtureWheels.push(wheel);
      mesh.geometry.setAttribute('_rl_wheel', wheel);
      mesh.geometry.setAttribute('_rl_track', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
    });
  }
  return { ...built, runningGear: RG_SPEC };
}

vi.mock('./units/mesh-vehicle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-vehicle')>();
  return { ...actual, loadVehicleMeshTemplate: async () => laviTemplate() };
});
vi.mock('./units/mesh-unit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-unit')>();
  return {
    ...actual,
    loadMeshUnitTemplate: async (url: string, faction: MeshFaction, textured: boolean, _cold: boolean, tiers: undefined, kitOn: boolean, surfaces: never) =>
      actual.buildMeshUnitTemplate(await parseFixture({ roleName: 'uniform', clipName: 'idle' }), faction, url, textured, tiers, kitOn, surfaces),
  };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(gpu: RendererOptions['gpu'], backdrop?: BackdropSpec): RendererOptions {
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
    quality: QUALITY_PRESETS.low,
    environmentLight: false,
    // Rain: the KDF figure carries the rim, then the wounded floor (`stock|rl-unit-rain-rim|rl-wounded-floor`).
    weather: 'rain',
    ...(gpu !== undefined ? { gpu } : {}),
    ...(backdrop !== undefined ? { backdrop } : {}),
  };
}

const LAVI: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 1800, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};
const WOUNDED: UnitTypeJson = {
  id: 'kdf_wounded',
  role: 'wounded',
  hull: { hp: 100, armor: { front: 1, side: 1, rear: 1 } },
  mobility: { speed_tiles_s: 0.5 },
  sensors: { optics: 1, sight_tiles: 6, signature: 0.6 },
};

interface Private {
  scene: THREE.Scene;
  nodeMaterialKit: MaterialKit | null;
  pendingAdoption: Set<THREE.Object3D>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  vehicleDying: DyingVehicle[];
  meshDying: DyingMeshUnit[];
  runningGear: { moved: Uint8Array };
  evacuated: Set<number>;
  meshDeparting: { entity: MeshUnitEntity }[];
  backdrop: { group: THREE.Group } | null;
  backdropKit: LoadedBackdropKit | null;
  backdropLevels: unknown;
  backdropDirty: boolean;
}

interface StubKit extends MaterialKit {
  /** Every twin made, in order. */
  readonly made: THREE.Material[];
  readonly calls: () => number;
}

/** Every slot returns a fresh `MeshStandardNodeMaterial`, tagged with its legacy material (`rlLegacy`) and named after its slot. */
function stubKit(): StubKit {
  const made: THREE.Material[] = [];
  const make = (slot: string) => (legacy: THREE.Material): THREE.Material => {
    const twin = new MeshStandardNodeMaterial({ name: `stub-twin-${slot}` });
    Object.defineProperty(twin.userData, TWIN_LEGACY_KEY, { value: legacy, enumerable: false, configurable: true, writable: true });
    made.push(twin);
    return twin;
  };
  // Every slot but two: the flipbook and the smoke screen write their uniforms through `mesh.material` every frame
  // (`flipbook-fx.ts` `step`, `smoke-mesh.ts`), so a stub twin there throws. T12 holds their legacy material apart (the P2 ring's
  // pattern) when it fills those slots.
  const slots = ['ground', 'foliage', 'ring', 'unit', 'outline', 'banner', 'backdrop', 'decal', 'overlay', 'zoneBand', 'supplyRoute', 'trail', 'xray', 'particle', 'tracer', 'vfxMesh', 'rimFade', 'beam', 'rotor'] as const;
  const kit = { flipbook: null, smokeScreen: null, ...Object.fromEntries(slots.map((s) => [s, make(s)])) } as unknown as MaterialKit;
  return Object.assign(kit, { made, calls: () => made.length });
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;

/** The census of the scene the node backend runs (no `portedKeys`), plus the `unadopted` backstop with the renderer's own table. */
function unitHooks(priv: Private): string[] {
  const slotOf = seam.opts?.twinSlotOf;
  if (slotOf === undefined) throw new Error('spec: the renderer handed the backend no twinSlotOf');
  const kit = seam.kit as MaterialKit;
  const found: UnportedHook[] = [
    ...censusUnported(priv.scene),
    ...censusUnadopted(priv.scene, (m) => {
      const s = slotOf(m);
      return s !== null && kit[s] !== null;
    }),
  ];
  return found
    .filter((h) => (h.kind === 'on-before-compile' || h.kind === 'unadopted') && h.key.split('|').some((s) => UNIT_HOOK_SEGMENTS.has(s)))
    .map((h) => `${h.kind}:${h.key}`);
}

/** The live hull mesh of an entity (not the wreck twin, not the outline). */
function hullOf(e: VehicleMeshEntity): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  for (const top of e.liveTop) {
    top.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!found && m.isMesh && (m.userData as { rl_role?: unknown }).rl_role === 'hull') found = m;
    });
  }
  if (!found) throw new Error('no hull mesh');
  return found;
}

/** A sim with two Lavis and a wounded KDF figure, a renderer, the meshes loaded, and the first frame drawn. */
async function boot(gpu: RendererOptions['gpu'], backdrop?: BackdropSpec) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const lavi = sim.addUnitType(LAVI);
  const wounded = sim.addUnitType(WOUNDED);
  const a = sim.spawn(lavi, 0, fx.from(6.5), fx.from(6.5));
  const b = sim.spawn(lavi, 0, fx.from(12.5), fx.from(6.5));
  const squad = sim.spawn(wounded, 0, fx.from(9.5), fx.from(14.5));
  const r = new ThreeRenderer(sim, makeOpts(gpu, backdrop));
  const priv = r as unknown as Private;
  await r.init(HOST);
  await r.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');
  await r.loadMeshUnit('kdf_wounded', 'kdf_wounded.glb', 'kdf');
  const toBand = (id: number, band: number): void => {
    const max = sim.unitTypes[sim.state.typeIdx[id]].hp;
    (sim.state.hp as Int32Array)[id] = band >= 8 ? max : Math.floor((max * band) / 8);
  };
  return { sim, r, priv, a, b, squad, toBand };
}

beforeEach(() => {
  seam.kit = null;
  seam.opts = null;
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('G1: every unit swap site adopts, on the frame of the swap', () => {
  it('a vehicle: spawn, move, damage band, death fade, template reload; a squad: spawn, wound, fade', async () => {
    seam.kit = stubKit();
    const { sim, r, priv, a, b, squad, toBand } = await boot('webgl2');
    const frame = (label: string, dtMs = 16): void => {
      r.frame(1, dtMs);
      expect(unitHooks(priv), label).toEqual([]);
    };
    frame('spawn');
    const hullA = hullOf(priv.vehicleMeshEntities.get(a) as VehicleMeshEntity);
    // Precondition: the hull really carries a unit hook (the team variant), and draws its twin.
    expect(isTwin(hullA.material as THREE.Material)).toBe(true);
    expect(hookSegments(legacyOf(hullA.material as THREE.Material, hullA))).toEqual(['rl-unit-mark-3']);
    expect(priv.meshUnitEntities.has(squad)).toBe(true);
    // ...and so does the figure: the rain rim, then the wounded floor.
    const figureChains: string[][] = [];
    (priv.meshUnitEntities.get(squad) as MeshUnitEntity).root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && isTwin(m.material)) figureChains.push(hookSegments(legacyOf(m.material, m)));
    });
    expect(figureChains).toContainEqual(['rl-unit-rain-rim', 'rl-wounded-floor']);

    priv.runningGear.moved[a] = 1;
    frame('move (running-gear bind)');
    const bound = runningGearBinding(priv.vehicleMeshEntities.get(a) as VehicleMeshEntity);
    expect(bound).toBeDefined();
    expect(hookSegments(legacyOf(hullA.material as THREE.Material, hullA))).toEqual(['rl-unit-mark-3', 'rl-running-gear-1']);

    toBand(a, 3);
    frame('damage band');
    toBand(squad, 2);
    frame('wound');

    sim.debugKill(a);
    frame('vehicle death fade');
    expect(priv.vehicleDying).toHaveLength(1);
    expect((priv.vehicleDying[0] as DyingVehicle).swaps.length).toBeGreaterThan(0);

    await r.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');
    frame('template reload');
    const hullB = hullOf(priv.vehicleMeshEntities.get(b) as VehicleMeshEntity);
    expect(isTwin(hullB.material as THREE.Material)).toBe(true);

    // A clean, never-moved hull: its fade is the only swap of that frame (no release, no scar re-apply queues it).
    sim.debugKill(b);
    frame('vehicle death fade (clean, unbound)');
    expect(priv.vehicleDying.some((d) => d.entity.root === hullB.parent || d.swaps.some((s) => s.mesh === hullB))).toBe(true);

    sim.debugKill(squad);
    let fading = false;
    for (let i = 0; i < 40 && !fading; i++) {
      frame(`squad death, frame ${i}`, 50);
      fading = priv.meshDying[0]?.phase === 'fading';
    }
    expect(fading).toBe(true);
    r.dispose();
  });
});

describe('G2: clone sites clone the legacy material', () => {
  it('the running-gear clone, the scar and the fade clone are cut from the legacy team variant and keep its hook', async () => {
    seam.kit = stubKit();
    const { sim, r, priv, a, b, toBand } = await boot('webgl2');
    r.frame(1, 16);
    const entity = priv.vehicleMeshEntities.get(a) as VehicleMeshEntity;
    const hull = hullOf(entity);
    const variant = legacyOf(hull.material as THREE.Material, hull);
    expect(isTwin(variant)).toBe(false);
    expect(hookSegments(variant)).toEqual(['rl-unit-mark-3']);

    priv.runningGear.moved[a] = 1;
    r.frame(1, 16);
    const binding = runningGearBinding(entity);
    if (!binding) throw new Error('no binding');
    expect(binding.swaps[0]?.original).toBe(variant);
    const rg = binding.materials[0] as THREE.Material;
    expect(isTwin(rg)).toBe(false);
    expect((rg as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect(hookSegments(rg)).toEqual(['rl-unit-mark-3', 'rl-running-gear-1']);
    expect(legacyBaseOf(rg)).toBe(variant);

    // The scar on a moved hull is written onto its own (legacy) running-gear clone; on death the bind is released and the scar is
    // cut from the legacy variant.
    toBand(a, 3);
    r.frame(1, 16);
    sim.debugKill(a);
    r.frame(1, 16);
    const swaps = (priv.vehicleDying[0] as DyingVehicle).swaps;
    const hullSwap = swaps.find((s) => s.mesh === hull);
    if (!hullSwap) throw new Error('no hull swap');
    const scar = hullSwap.original;
    expect(isTwin(scar)).toBe(false);
    expect(hookSegments(scar)).toEqual(['rl-unit-mark-3']);
    expect(legacyBaseOf(scar)).toBe(variant);
    const fade = hullSwap.fade;
    expect(isTwin(fade)).toBe(false);
    expect(fade.transparent).toBe(true);
    expect(hookSegments(fade)).toEqual(['rl-unit-mark-3']);
    expect(legacyBaseOf(fade)).toBe(variant);

    // A clean, never-moved hull dies while it DRAWS its twin (no release, no scar re-apply): the fade is still cut from the legacy.
    const entityB = priv.vehicleMeshEntities.get(b) as VehicleMeshEntity;
    const hullB = hullOf(entityB);
    expect(isTwin(hullB.material as THREE.Material)).toBe(true);
    const variantB = legacyOf(hullB.material as THREE.Material, hullB);
    sim.debugKill(b);
    r.frame(1, 16);
    const fadeB = priv.vehicleDying.flatMap((d) => d.swaps).find((s) => s.mesh === hullB);
    if (!fadeB) throw new Error('no fade for the clean hull');
    expect(fadeB.original).toBe(variantB);
    expect(isTwin(fadeB.fade)).toBe(false);
    expect(hookSegments(fadeB.fade)).toEqual(['rl-unit-mark-3']);
    expect(legacyBaseOf(fadeB.fade)).toBe(variantB);
    r.dispose();
  });

  it('ruling P3-R2: two hulls sharing one twin, scarred to different bands, each fade from their OWN scar', async () => {
    seam.kit = stubKit();
    const { sim, r, priv, a, b, toBand } = await boot('webgl2');
    r.frame(1, 16);
    toBand(a, 4);
    toBand(b, 1);
    r.frame(1, 16);
    const hullA = hullOf(priv.vehicleMeshEntities.get(a) as VehicleMeshEntity);
    const hullB = hullOf(priv.vehicleMeshEntities.get(b) as VehicleMeshEntity);
    // The precondition the ruling is about: one shared twin, two different legacy scars behind it.
    expect(hullA.material).toBe(hullB.material);
    const scarA = legacyOf(hullA.material as THREE.Material, hullA) as THREE.MeshStandardMaterial;
    const scarB = legacyOf(hullB.material as THREE.Material, hullB) as THREE.MeshStandardMaterial;
    expect(scarA).not.toBe(scarB);
    expect(scarA.color.getHex()).not.toBe(scarB.color.getHex());
    sim.debugKill(a);
    sim.debugKill(b);
    r.frame(1, 16);
    expect(priv.vehicleDying).toHaveLength(2);
    const fadeOf = (hull: THREE.Mesh): THREE.MeshStandardMaterial => {
      for (const d of priv.vehicleDying) for (const s of d.swaps) if (s.mesh === hull) return s.fade as THREE.MeshStandardMaterial;
      throw new Error('no fade');
    };
    expect(fadeOf(hullA).color.getHex()).toBe(scarA.color.getHex());
    expect(fadeOf(hullB).color.getHex()).toBe(scarB.color.getHex());
    r.dispose();
  });
});

describe('G3: no new program per vehicle', () => {
  it('a second hull\'s running-gear bind and a second entity\'s fade add no twin and no material to the scene', async () => {
    const kit = stubKit();
    seam.kit = kit;
    const { sim, r, priv, a, b } = await boot('webgl2');
    r.frame(1, 16);
    const twinsInScene = (): number => {
      const seen = new Set<THREE.Material>();
      priv.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m && !Array.isArray(m) && isTwin(m)) seen.add(m);
      });
      return seen.size;
    };
    priv.runningGear.moved[a] = 1;
    r.frame(1, 16);
    const afterFirstBind = { made: kit.calls(), inScene: twinsInScene() };
    priv.runningGear.moved[b] = 1;
    r.frame(1, 16);
    expect(runningGearBinding(priv.vehicleMeshEntities.get(b) as VehicleMeshEntity)).toBeDefined();
    // No factory call: the second bind hit the first one's memo. (The scene can only lose a twin: the clean variant's twin leaves
    // it once both hulls draw the running-gear twin.)
    expect(kit.calls()).toBe(afterFirstBind.made);
    expect(twinsInScene()).toBeLessThanOrEqual(afterFirstBind.inScene);

    sim.debugKill(a);
    r.frame(1, 16);
    const afterFirstFade = { made: kit.calls(), inScene: twinsInScene() };
    sim.debugKill(b);
    r.frame(1, 16);
    expect(priv.vehicleDying).toHaveLength(2);
    // No factory call: the second fade hit the first one's memo. (The scene can only lose a twin here: the shared running-gear
    // twin leaves it with its last user's release.)
    expect(kit.calls()).toBe(afterFirstFade.made);
    expect(twinsInScene()).toBeLessThanOrEqual(afterFirstFade.inScene);
    r.dispose();
  });
});

describe('GH-1096 S1: a living Lavi built by the renderer wears the insignia; a type with no frame does not', () => {
  it('the Lavi\'s hull variant carries both halves of the one hook; the Ambush Tank, same fixture hull, carries the team mark only', async () => {
    seam.kit = stubKit();
    const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
    const a = sim.spawn(sim.addUnitType(LAVI), 0, fx.from(6.5), fx.from(6.5));
    // A second type on the same fixture hull (the mock hands every load the Lavi's template): framed by TYPE id, so none.
    const c = sim.spawn(sim.addUnitType({ ...LAVI, id: 'mbt_lavi_camo' }), 0, fx.from(14.5), fx.from(14.5));
    const r = new ThreeRenderer(sim, makeOpts('webgl2'));
    const priv = r as unknown as Private;
    await r.init(HOST);
    await r.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');
    await r.loadVehicleMesh('mbt_lavi_camo', 'mbt_lavi_camo.glb');
    r.frame(1, 16);
    const lavi = legacyOf(hullOf(priv.vehicleMeshEntities.get(a) as VehicleMeshEntity).material as THREE.Material, hullOf(priv.vehicleMeshEntities.get(a) as VehicleMeshEntity));
    expect(teamHookOf(lavi)).toBeDefined();
    expect(insigniaHookOf(lavi)).toBeDefined();
    expect(lavi.customProgramCacheKey().endsWith('|rl-unit-mark-3|team+ins')).toBe(true);
    const other = hullOf(priv.vehicleMeshEntities.get(c) as VehicleMeshEntity);
    const camoHull = legacyOf(other.material as THREE.Material, other);
    expect(teamHookOf(camoHull)).toBeDefined();
    expect(insigniaHookOf(camoHull)).toBeUndefined();
    r.dispose();
  });
});

describe('GH-1096 S1: the insignia field is fetched only for a roster holding a framed type', () => {
  const URL_SDF = '/t/textures/insignia/roaring_lion_sdf.png';
  async function fetchesFor(types: readonly UnitTypeJson[]): Promise<number> {
    seam.kit = stubKit();
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
    const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
    types.forEach((t, i) => sim.spawn(sim.addUnitType(t), 0, fx.from(4.5 + 4 * i), fx.from(6.5)));
    const r = new ThreeRenderer(sim, { ...makeOpts('webgl2'), insigniaSdfUrl: URL_SDF });
    await r.init(HOST);
    const n = load.mock.calls.filter((c) => c[0] === URL_SDF).length;
    r.dispose();
    load.mockRestore();
    return n;
  }
  it('a Lavi in the roster: one fetch; no framed type (a wounded figure, the Ambush Tank): none', async () => {
    expect(await fetchesFor([LAVI, WOUNDED])).toBe(1);
    expect(await fetchesFor([WOUNDED, { ...LAVI, id: 'mbt_lavi_camo' }])).toBe(0);
  });
});

describe('G8: a legacy boot never calls the kit and never queues', () => {
  it('spawn, move, damage, death fade, reload: no factory call, an empty queue, every material legacy', async () => {
    const kit = stubKit();
    seam.kit = kit;
    const { sim, r, priv, a, toBand } = await boot(undefined);
    // The stub kit handed to a LEGACY renderer: only the node-only guards keep it out.
    priv.nodeMaterialKit = kit;
    expect(seam.opts).toBeNull();
    r.frame(1, 16);
    expect(priv.pendingAdoption.size).toBe(0);
    priv.runningGear.moved[a] = 1;
    r.frame(1, 16);
    toBand(a, 3);
    r.frame(1, 16);
    sim.debugKill(a);
    r.frame(1, 16);
    await r.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');
    r.frame(1, 16);
    expect(priv.pendingAdoption.size).toBe(0);
    expect(kit.calls()).toBe(0);
    priv.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m && !Array.isArray(m)) expect(isTwin(m)).toBe(false);
    });
    r.dispose();
  });
});

describe('GH-1319: a moving vehicle draws only attributes WebGPU can lay out', () => {
  it('node boot: after the running-gear bind, every attribute of the moving hull has a vertex format in three\'s WebGPU backend', async () => {
    seam.kit = stubKit();
    const { r, priv, a } = await boot('webgl2');
    r.frame(1, 16);
    priv.runningGear.moved[a] = 1;
    r.frame(1, 16);
    const entity = priv.vehicleMeshEntities.get(a) as VehicleMeshEntity;
    expect(runningGearBinding(entity)).toBeDefined();
    const hull = hullOf(entity);
    const wheel = hull.geometry.getAttribute('_rl_wheel');
    // The values the wheel term reads are kept (the fixture tags every vertex wheel 1).
    expect(Array.from({ length: wheel.count }, (_, i) => wheel.getX(i)).every((v) => v === 1)).toBe(true);
    const names = Object.keys(hull.geometry.attributes);
    const formats = await webGpuFormats(names.map((n) => hull.geometry.getAttribute(n) as THREE.BufferAttribute));
    expect(formats).toHaveLength(names.length);
    expect(names.filter((_, i) => formats[i] === undefined)).toEqual([]);
    r.dispose();
  });

  it('legacy boot: the hull keeps the very `_rl_wheel` object the loader made, interleaved 8-bit, moved or not', async () => {
    const { r, priv, a } = await boot(undefined);
    r.frame(1, 16);
    priv.runningGear.moved[a] = 1;
    r.frame(1, 16);
    const entity = priv.vehicleMeshEntities.get(a) as VehicleMeshEntity;
    expect(runningGearBinding(entity)).toBeDefined();
    const wheel = hullOf(entity).geometry.getAttribute('_rl_wheel') as THREE.InterleavedBufferAttribute;
    expect(fixtureWheels).toContain(wheel);
    expect(wheel.isInterleavedBufferAttribute).toBe(true);
    expect(wheel.array).toBeInstanceOf(Uint8Array);
    r.dispose();
  });
});

describe('ruling P3-R4: visible is mirrored before the scene is traversed, both ways', () => {
  it('hide then show a legacy material after adoption: the twin follows on the next render', async () => {
    seam.kit = stubKit();
    const { r, priv, a } = await boot('webgl2');
    r.frame(1, 16);
    const hull = hullOf(priv.vehicleMeshEntities.get(a) as VehicleMeshEntity);
    const twin = hull.material as THREE.Material;
    const legacy = legacyOf(twin, hull);
    expect(isTwin(twin)).toBe(true);
    expect(twin.visible).toBe(true);
    legacy.visible = false;
    r.frame(1, 16);
    expect(twin.visible).toBe(false);
    legacy.visible = true;
    r.frame(1, 16);
    expect(twin.visible).toBe(true);
    r.dispose();
  });
});

/** True when `o` is `root` or hangs under it. */
function under(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p !== null; p = p.parent) if (p === root) return true;
  return false;
}

/**
 * Each swap site queues EXACTLY what it swapped (a bind or release its meshes, a scar the live tops, a fade the root), so no site is
 * covered by another's queue in the same frame. The spy records every `queueNodeAdoption` call (it calls through). Falsify each line on
 * its own: the release's, the death scar re-apply's, `beginVehicleDeath`'s `adopt`, the living scar's, the bind's, `endMeshDeathFade`'s
 * `adopt?.(s.mesh)` (and `stepVehicleDeath`'s wreck-only `env.adopt`), `beginMeshEvac`'s `adopt`, `beginFadePhase`'s `env.adopt`.
 */
describe('each swap site queues what it swapped, on its own', () => {
  it('the bind queues its meshes; a living scar on an unbound hull queues its live tops', async () => {
    seam.kit = stubKit();
    const { r, priv, a, b, toBand } = await boot('webgl2');
    r.frame(1, 16);
    const queued = vi.spyOn(r, 'queueNodeAdoption');
    const entityA = priv.vehicleMeshEntities.get(a) as VehicleMeshEntity;
    priv.runningGear.moved[a] = 1;
    r.frame(1, 16);
    const binding = runningGearBinding(entityA);
    if (!binding) throw new Error('no binding');
    expect(queued.mock.calls.map((c) => c[0]).filter((o) => under(o, entityA.root))).toEqual(binding.swaps.map((sw) => sw.mesh));
    queued.mockClear();
    const entityB = priv.vehicleMeshEntities.get(b) as VehicleMeshEntity;
    toBand(b, 3);
    r.frame(1, 16);
    expect(queued.mock.calls.map((c) => c[0]).filter((o) => under(o, entityB.root))).toEqual([...entityB.liveTop]);
    // ...and the scar draws its twin on that frame.
    expect(isTwin(hullOf(entityB).material as THREE.Material)).toBe(true);
    r.dispose();
  });

  it('a bound, scarred hull\'s death queues the release\'s meshes, then the scar\'s live tops, then the fade\'s root', async () => {
    seam.kit = stubKit();
    const { sim, r, priv, a, toBand } = await boot('webgl2');
    r.frame(1, 16);
    const entity = priv.vehicleMeshEntities.get(a) as VehicleMeshEntity;
    priv.runningGear.moved[a] = 1;
    r.frame(1, 16);
    toBand(a, 3);
    r.frame(1, 16);
    const binding = runningGearBinding(entity);
    if (!binding) throw new Error('no binding');
    const releaseMeshes = binding.swaps.map((sw) => sw.mesh);
    const queued = vi.spyOn(r, 'queueNodeAdoption');
    sim.debugKill(a);
    r.frame(1, 16);
    expect(priv.vehicleDying).toHaveLength(1);
    expect(queued.mock.calls.map((c) => c[0]).filter((o) => under(o, entity.root))).toEqual([...releaseMeshes, ...entity.liveTop, entity.root]);
    r.dispose();
  });

  it('a vehicle fade that ends in a wreck queues its restored meshes: the hull draws its twin again and the census is clean', async () => {
    seam.kit = stubKit();
    const { sim, r, priv, a } = await boot('webgl2');
    r.frame(1, 16);
    const entity = priv.vehicleMeshEntities.get(a) as VehicleMeshEntity;
    const hull = hullOf(entity);
    sim.debugKill(a);
    r.frame(1, 16);
    const dying = priv.vehicleDying[0] as DyingVehicle;
    const swapped = dying.swaps.map((sw) => sw.mesh);
    const hullSwap = dying.swaps.find((sw) => sw.mesh === hull);
    if (!hullSwap) throw new Error('no hull swap');
    // Mid-fade the hull draws the fade clone's twin.
    expect(legacyOf(hull.material as THREE.Material, hull)).toBe(hullSwap.fade);
    const queued = vi.spyOn(r, 'queueNodeAdoption');
    let frames = 0;
    while ((dying as unknown as { settling: boolean }).settling !== true && frames < 40) {
      r.frame(1, 50);
      frames++;
    }
    expect(0.016 + frames * 0.05).toBeGreaterThanOrEqual(MESH_DEATH_SECONDS);
    expect((dying as unknown as { settling: boolean }).settling).toBe(true);
    // The fade's end queued every mesh it restored...
    const calls = queued.mock.calls.map((c) => c[0]);
    for (const m of swapped) expect(calls).toContain(m);
    // ...so the restored hull draws its twin again, and nothing hooked is left un-adopted.
    expect(isTwin(hull.material as THREE.Material)).toBe(true);
    expect(legacyOf(hull.material as THREE.Material, hull)).toBe(hullSwap.original);
    expect(unitHooks(priv)).toEqual([]);
    r.dispose();
  });

  it('a squad: the fade begin queues the root; the fade end that REMOVES the entity queues nothing of it', async () => {
    seam.kit = stubKit();
    const { sim, r, priv, squad } = await boot('webgl2');
    r.frame(1, 16);
    const entity = priv.meshUnitEntities.get(squad) as MeshUnitEntity;
    const queued = vi.spyOn(r, 'queueNodeAdoption');
    sim.debugKill(squad);
    let fadeFrameCalls: THREE.Object3D[] | null = null;
    for (let i = 0; i < 60 && fadeFrameCalls === null; i++) {
      queued.mockClear();
      r.frame(1, 50);
      if (priv.meshDying[0]?.phase === 'fading') fadeFrameCalls = queued.mock.calls.map((c) => c[0]);
    }
    if (fadeFrameCalls === null) throw new Error('the squad never reached its fade');
    expect(fadeFrameCalls.filter((o) => under(o, entity.root))).toEqual([entity.root]);
    // Run the fade out: the frame that removes the entity queues nothing that hangs under it (it is disposed in that call).
    let removedFrameCalls: THREE.Object3D[] | null = null;
    for (let i = 0; i < 40 && removedFrameCalls === null; i++) {
      queued.mockClear();
      r.frame(1, 50);
      if (priv.meshDying.length === 0) removedFrameCalls = queued.mock.calls.map((c) => c[0]);
    }
    if (removedFrameCalls === null) throw new Error('the squad fade never ended');
    expect(entity.root.parent).toBeNull();
    expect(removedFrameCalls.filter((o) => under(o, entity.root))).toEqual([]);
    expect(priv.pendingAdoption.size).toBe(0);
    r.dispose();
  });

  it('an evacuation fade queues the root', async () => {
    seam.kit = stubKit();
    const { sim, r, priv, squad } = await boot('webgl2');
    r.frame(1, 16);
    const entity = priv.meshUnitEntities.get(squad) as MeshUnitEntity;
    priv.evacuated.add(squad);
    const queued = vi.spyOn(r, 'queueNodeAdoption');
    sim.debugKill(squad);
    r.frame(1, 16);
    expect(priv.meshDeparting.map((d) => d.entity)).toContain(entity);
    expect(queued.mock.calls.map((c) => c[0]).filter((o) => under(o, entity.root))).toEqual([entity.root]);
    r.dispose();
  });
});

const BACKDROP_SPEC: BackdropSpec = {
  valley: 'ns',
  crest: 48,
  seed: 7,
  kit: 'wadi_halam_kit',
  pieces: [
    { id: 'bd_wall_far_a', at: [0, 8], rot: 0 },
    { id: 'bd_terrace_a', at: [-0.52, 8], rot: 0 },
    { id: 'bd_slope_near_a', at: [16, 8], rot: 180 },
  ],
};

/** `ThreeRenderer.backdrop.test.ts`'s kit: the real fixture's pieces and olive. */
function backdropKit(): LoadedBackdropKit {
  const source = readKitFixture();
  const olive = new THREE.BufferGeometry();
  const o = source.pieces.get('bd_olive');
  if (o === undefined) throw new Error('fixture has no olive');
  olive.setAttribute('position', new THREE.BufferAttribute(o.positions, 3));
  olive.setAttribute('normal', new THREE.BufferAttribute(o.normals, 3));
  olive.setAttribute('uv', new THREE.BufferAttribute(o.uvs, 2));
  olive.setIndex(new THREE.BufferAttribute(Uint32Array.from(o.index), 1));
  return { source, map: new THREE.Texture(), olive };
}

/** The backdrop build queues its group: every one of its meshes draws the `backdrop` twin on the build frame. Falsify: delete the
 *  `queueNodeAdoption(this.backdrop.group)` line. */
describe('the backdrop build adopts', () => {
  it('every backdrop mesh draws its twin on the frame the valley is built', async () => {
    seam.kit = stubKit();
    const { r, priv } = await boot('webgl2', BACKDROP_SPEC);
    r.frame(1, 16);
    priv.backdropKit = backdropKit();
    priv.backdropLevels = undefined;
    priv.backdropDirty = true;
    r.frame(1, 16);
    const group = priv.backdrop?.group;
    if (!group) throw new Error('no backdrop built');
    const drawn: THREE.Material[] = [];
    group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m && !Array.isArray(m)) drawn.push(m);
    });
    expect(drawn.length).toBeGreaterThanOrEqual(4);
    for (const m of drawn) {
      expect(isTwin(m)).toBe(true);
      expect(m.name).toBe('stub-twin-backdrop');
    }
    r.dispose();
  });
});
