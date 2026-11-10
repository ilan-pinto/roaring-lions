/**
 * GH-943 P3 (T5): the occlusion and smoke outlines on a node boot, through the renderer. The harness is T1's
 * (`ThreeRenderer.unit-adoption.test.ts`: a mocked node backend, a faked WebGLRenderer, the real template builders on fixture GLBs);
 * the kit holds the REAL outline factory (`createNodeOutlineMaterial`) and nothing else, so every unit body stays its legacy self.
 *
 * Gates, each with its one-line falsification (run by hand, listed in the commit message):
 *  - every runtime outline swap adopts on the frame of the swap (no silhouette mesh draws a legacy material after any frame):
 *      the smoke outline put on (`stepSmokeOutlines`), taken off, the hit flash put on (`stepFireLinkFlashes`), and taken off.
 *    Falsify: delete the `queueNodeAdoption` at each of the four sites, one at a time.
 *  - ruling P3-R4 through the existing `overlays` toggle: hide, the outline twins are not drawn; show, they are drawn again.
 *    Falsify: mirror only one direction in `mirrorTwinVisibility`.
 *  - G6 the smoke outline follows the viewer: the viewer's own vehicle in smoke draws the smoke outline's twin, an enemy beside it
 *    keeps its plain outline. Falsify: give the smoke material to the enemy side (`wearsSmokeOutline`'s `side === viewer`).
 *  - Review Focus 4: a team-colour change recolours the outline twins in place, no rebuild.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import type { NodeBackendOptions } from './backend/node-backend';
import { ThreeRenderer } from './ThreeRenderer';
import { NULL_P3_SLOTS } from './node-material-adoption';
import { MATERIAL_MATHS } from './material-maths';
import { isTwin, legacyOf } from './twin-identity';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import type { MeshUnitEntity } from './units/mesh-unit';
import type { MeshFaction } from './units/mesh-role';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import { parseFixture } from './units/mesh-fixture';
import { parseRunningGear } from './units/running-gear';
import { isSilhouette } from './units/silhouette';
import { createNodeOutlineMaterial, NODE_OUTLINE_MATERIAL_NAME } from './units/silhouette.node';

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
      mesh.geometry.setAttribute('_rl_wheel', new THREE.BufferAttribute(new Uint8Array(n).fill(1), 1));
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

function makeOpts(gpu: RendererOptions['gpu']): RendererOptions {
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
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  silhouetteMeshMaterials: THREE.MeshBasicMaterial[];
  smokeOutlineVehicleMaterial: THREE.MeshBasicMaterial | null;
  smokeOutlineInfantryMaterial: THREE.MeshBasicMaterial | null;
  fireLinkFlashes: { target: number; startS: number }[];
  fireLinkFlashMaterials: Map<number, THREE.MeshBasicMaterial>;
  fireLinkClockS: number;
}

/** The kit: the real outline twin, every other slot null (unit bodies stay legacy). Counts the twins it made. */
async function outlineKit(): Promise<MaterialKit & { made: THREE.Material[] }> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const made: THREE.Material[] = [];
  return {
    ...NULL_P3_SLOTS,
    ground: null,
    foliage: null,
    ring: null,
    outline: (legacy) => {
      const t = createNodeOutlineMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.outline }, legacy);
      made.push(t);
      return t;
    },
    made,
  };
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;

/** Every silhouette mesh under `root`. */
function silhouettesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && isSilhouette(m)) out.push(m);
  });
  return out;
}

/** The scene's silhouette meshes that draw a LEGACY material (a node boot must have none after any frame). */
function legacyOutlines(scene: THREE.Scene): string[] {
  return silhouettesOf(scene)
    .filter((m) => !isTwin(m.material as THREE.Material))
    .map((m) => m.name);
}

/** Own Lavi `a` and wounded figure `squad` (side 0, the viewer), and an enemy Lavi `e` (side 1) beside `a`. */
async function boot(gpu: RendererOptions['gpu']) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const lavi = sim.addUnitType(LAVI);
  const wounded = sim.addUnitType(WOUNDED);
  const a = sim.spawn(lavi, 0, fx.from(6.5), fx.from(6.5));
  const e = sim.spawn(lavi, 1, fx.from(8.5), fx.from(6.5));
  const squad = sim.spawn(wounded, 0, fx.from(9.5), fx.from(14.5));
  const r = new ThreeRenderer(sim, makeOpts(gpu));
  const priv = r as unknown as Private;
  await r.init(HOST);
  await r.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');
  await r.loadMeshUnit('kdf_wounded', 'kdf_wounded.glb', 'kdf');
  // Smoke is a stand-in read: the tiles in `smoky` read thick smoke, everything else none. The sim is never written.
  const smoky = new Set<string>();
  vi.spyOn(sim, 'smokeAt').mockImplementation((x: number, y: number) => (smoky.has(`${x},${y}`) ? 200 : 0));
  return { sim, r, priv, a, e, squad, smoky };
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

describe('the outline twin on a node boot', () => {
  it('every spawned unit\'s silhouette (vehicle and squad) draws the outline twin of its own side\'s legacy material', async () => {
    seam.kit = await outlineKit();
    const { r, priv, a, e, squad } = await boot('webgl2');
    r.frame(1, 16);
    expect(legacyOutlines(priv.scene)).toEqual([]);
    const sides: [number, number][] = [[a, 0], [e, 1], [squad, 0]];
    for (const [id, slot] of sides) {
      const root = (priv.vehicleMeshEntities.get(id) ?? priv.meshUnitEntities.get(id))?.root;
      if (!root) throw new Error(`no entity ${id}`);
      const outlines = silhouettesOf(root);
      expect(outlines.length, `entity ${id}`).toBeGreaterThan(0);
      for (const m of outlines) {
        expect((m.material as THREE.Material).name).toBe(NODE_OUTLINE_MATERIAL_NAME);
        expect(legacyOf(m.material as THREE.Material, m)).toBe(priv.silhouetteMeshMaterials[slot]);
      }
    }
    // The squad's outline is skinned (the twin's skinned expansion is the path it takes).
    const squadOutline = silhouettesOf((priv.meshUnitEntities.get(squad) as MeshUnitEntity).root)[0] as THREE.SkinnedMesh;
    expect(squadOutline.isSkinnedMesh).toBe(true);
    r.dispose();
  });

  it('every runtime outline swap adopts on its own frame: smoke on, flash on, flash off, smoke on, smoke off', async () => {
    seam.kit = await outlineKit();
    const { r, priv, a, smoky } = await boot('webgl2');
    const frame = (label: string): void => {
      r.frame(1, 16);
      expect(legacyOutlines(priv.scene), label).toEqual([]);
    };
    frame('spawn');
    const outlinesA = silhouettesOf((priv.vehicleMeshEntities.get(a) as VehicleMeshEntity).root);
    // Non-empty first: `wears` loops over this list and a vehicle that drew no outline would pass every step.
    expect(outlinesA.length).toBeGreaterThan(0);
    const wears = (want: THREE.Material | null | undefined): void => {
      for (const m of outlinesA) expect(legacyOf(m.material as THREE.Material, m)).toBe(want);
    };
    const plain = priv.silhouetteMeshMaterials[0];

    // 1. Smoke over the own Lavi: the smoke outline (stepSmokeOutlines, put on).
    smoky.add('6,6');
    frame('smoke on');
    wears(priv.smokeOutlineVehicleMaterial);

    // 2. A hit flash on it while in smoke (stepFireLinkFlashes, put on): `was` is the plain outline.
    priv.fireLinkFlashes.push({ target: a, startS: priv.fireLinkClockS });
    frame('flash on');
    wears(priv.fireLinkFlashMaterials.get(0));

    // 3. The smoke clears, then the flash ends (stepFireLinkFlashes, taken off): back to the plain LEGACY outline, and the smoke step
    //    has nothing to re-apply, so the flash's own restore is the only swap of this frame.
    smoky.clear();
    for (const f of priv.fireLinkFlashes) f.startS = -100;
    frame('flash off');
    wears(plain);

    // 4. Smoke again (put on), then gone (stepSmokeOutlines, taken off).
    smoky.add('6,6');
    frame('smoke on again');
    wears(priv.smokeOutlineVehicleMaterial);
    smoky.clear();
    frame('smoke off');
    wears(plain);
    r.dispose();
  });

  it('G6: the viewer\'s own vehicle in smoke wears the smoke outline; the enemy beside it in the same smoke keeps its plain one', async () => {
    seam.kit = await outlineKit();
    const { r, priv, a, e, smoky } = await boot('webgl2');
    r.frame(1, 16);
    smoky.add('6,6');
    smoky.add('8,6');
    r.frame(1, 16);
    const enemyRoot = (priv.vehicleMeshEntities.get(e) as VehicleMeshEntity).root;
    // Precondition: the enemy is drawn (in sight), so only its side keeps the smoke outline off it.
    expect(enemyRoot.visible).toBe(true);
    const ownOutlines = silhouettesOf((priv.vehicleMeshEntities.get(a) as VehicleMeshEntity).root);
    const enemyOutlines = silhouettesOf(enemyRoot);
    // Both lists are looped over below; an empty one would pass every expectation in it.
    expect(ownOutlines.length).toBeGreaterThan(0);
    expect(enemyOutlines.length).toBeGreaterThan(0);
    for (const m of ownOutlines) {
      expect(isTwin(m.material as THREE.Material)).toBe(true);
      expect(legacyOf(m.material as THREE.Material, m)).toBe(priv.smokeOutlineVehicleMaterial);
      expect((m.material as THREE.Material).depthTest).toBe(false);
    }
    for (const m of enemyOutlines) {
      expect(isTwin(m.material as THREE.Material)).toBe(true);
      expect(legacyOf(m.material as THREE.Material, m)).toBe(priv.silhouetteMeshMaterials[1]);
      expect((m.material as THREE.Material).depthTest).toBe(true);
    }
    r.dispose();
  });

  it('ruling P3-R4: the overlays toggle hides every outline twin on the next render and shows it again; so does the outline layer', async () => {
    seam.kit = await outlineKit();
    const { r, priv, a, smoky } = await boot('webgl2');
    smoky.add('6,6');
    r.frame(1, 16);
    const twins = (): THREE.Material[] => [...new Set(silhouettesOf(priv.scene).map((m) => m.material as THREE.Material))];
    // The team twins and the own Lavi's smoke twin are all in the scene.
    expect(twins().length).toBeGreaterThanOrEqual(3);
    expect(twins().every((t) => isTwin(t) && t.visible)).toBe(true);
    for (const layer of ['overlays', 'outline'] as const) {
      r.setDebugLayerVisible(layer, false);
      r.frame(1, 16);
      expect(twins().map((t) => t.visible), `${layer} hidden`).toEqual(twins().map(() => false));
      r.setDebugLayerVisible(layer, true);
      r.frame(1, 16);
      expect(twins().map((t) => t.visible), `${layer} shown`).toEqual(twins().map(() => true));
    }
    // The two layers compose: shown only while both are.
    r.setDebugLayerVisible('overlays', false);
    r.setDebugLayerVisible('outline', true);
    r.frame(1, 16);
    expect(twins().some((t) => t.visible)).toBe(false);
    r.setDebugLayerVisible('overlays', true);
    r.frame(1, 16);
    expect(twins().every((t) => t.visible)).toBe(true);
    expect(legacyOutlines(priv.scene)).toEqual([]);
    void a;
    r.dispose();
  });

  it('Review Focus 4: setTeamColors recolours the outline twins in place, with no new twin', async () => {
    const kit = await outlineKit();
    seam.kit = kit;
    const { r, priv, e } = await boot('webgl2');
    r.frame(1, 16);
    const made = kit.made.length;
    const enemyTwin = silhouettesOf((priv.vehicleMeshEntities.get(e) as VehicleMeshEntity).root)[0]?.material as THREE.MeshBasicMaterial;
    const before = enemyTwin.color.getHex();
    r.setTeamColors(['#C8B494', '#1E90FF', '#8E9491'], (k) => (k === 'team.hostile' ? '#1E90FF' : '#808080'));
    r.frame(1, 16);
    expect(enemyTwin.color.getHex()).not.toBe(before);
    expect(enemyTwin.color.getHex()).toBe(priv.silhouetteMeshMaterials[1]?.color.getHex());
    expect(kit.made.length).toBe(made);
    r.dispose();
  });
});

describe('a legacy boot', () => {
  it('never calls the outline factory, and every silhouette keeps its legacy material through smoke and a flash', async () => {
    const kit = await outlineKit();
    seam.kit = kit;
    const { r, priv, a, smoky } = await boot(undefined);
    smoky.add('6,6');
    r.frame(1, 16);
    priv.fireLinkFlashes.push({ target: a, startS: priv.fireLinkClockS });
    r.frame(1, 16);
    expect(kit.made).toHaveLength(0);
    const silhouettes = silhouettesOf(priv.scene);
    // Non-empty first: `every` over no silhouettes is true, so a boot that drew none would pass.
    expect(silhouettes.length).toBeGreaterThan(0);
    expect(silhouettes.every((m) => !isTwin(m.material as THREE.Material))).toBe(true);
    r.dispose();
  });
});
