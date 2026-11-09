/**
 * GH-943 P2 (T7): the node foliage twin's disturbers are built from the TICK, read AT THE TWIN.
 * (`ThreeRenderer.disturb-clock.test.ts` proves it for the legacy record; this proves the twin reads that record and nothing
 * frame-built.)
 *
 * A node renderer (the backend mocked, as in `ThreeRenderer.foliage-twin-clock.test.ts`) with the REAL `foliage` factory, a moving
 * tank and a high preset. Every frame's `render` runs the twin's uniform render updates, as three's NodeFrame does (the
 * slot arrays get the buffer `setup` would have made, so their copy can run). Then the nodes the twin holds (`uDisturbA`,
 * `uDisturbB`, `uDisturbBox`, `uDisturbN`, `uDisturbAmp`, `uDisturbSpring`):
 *  - are bit-identical after two frame cadences that reach the same tick (and anti-vacuity: a real wake sits in them, equal to the
 *    record's own lanes, so a twin that never copied them cannot pass);
 *  - move with a tick, and ignore a zero-time repaint, a long frame and a paused loop;
 *  - follow the `disturb` layer (amp 0 and back).
 *
 * Falsify (by hand, commit message):
 *  - build the ring from `frame()`: `this.disturbField.ring.record(0, this.sim.tickCount, alpha * 10, 0)` at the top of `updateDisturbers` (red);
 *  - bind `uDisturbA` by value at build time: drop its `onRenderUpdate` in `disturbNodes` (red: the twin keeps the first frame's slots).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import { nodeDisturbBindings, type DisturbBindings } from './terrain/decor-mesh.node';
import type { DisturbUniformSet } from './terrain/disturb-uniforms';
import { ThreeRenderer } from './ThreeRenderer';
import { NULL_P3_SLOTS } from './node-material-adoption';

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

const seam = vi.hoisted(() => ({ kit: null as MaterialKit | null }));

vi.mock('./backend/node-backend', async () => {
  const { censusUnported: census } = await vi.importActual<typeof import('./backend/unported')>('./backend/unported');
  const { nodeDisturbBindings: bindingsOf } = await vi.importActual<typeof import('./terrain/decor-mesh.node')>('./terrain/decor-mesh.node');
  /** Each disturbance node's render update, once per render. A slot array gets the buffer `UniformArrayNode.setup` allocates at build. */
  const runUpdates = (scene: THREE.Object3D): void => {
    const done = new Set<unknown>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      const list = m === undefined ? [] : Array.isArray(m) ? m : [m];
      for (const mat of list) {
        const b = bindingsOf(mat);
        if (b === null || done.has(b)) continue;
        done.add(b);
        for (const n of Object.values(b)) {
          const node = n as unknown as { update(frame: unknown): void; array?: unknown[]; value: unknown };
          if (node.array !== undefined && node.value === null) node.value = new Float32Array(node.array.length * 4);
          node.update({ deltaTime: 0.016 });
        }
      }
    });
  };
  return {
    createNodeBackend: async (): Promise<{ backend: RenderBackend }> => {
      const kit = seam.kit;
      if (kit === null) throw new Error('spec: no kit');
      const backend = {
        kind: 'node-webgl2',
        adapter: 'webgl2',
        domElement: {} as HTMLCanvasElement,
        setPixelRatio(): void {},
        getPixelRatio: () => 1,
        setSize(): void {},
        kit: { fog: null, ao: null, bloom: null },
        materials: kit,
        setFog(): void {},
        setOutputMaths(): void {},
        bloom: { setEnabled: () => false, setFade(): void {}, strength: 0, built: false, readPreBloom: async () => null },
        pmrem: {},
        ao: null,
        configure(): void {},
        post: null,
        async prepare(scene: THREE.Scene): Promise<void> {
          census(scene);
        },
        render(scene: THREE.Scene): void {
          census(scene);
          runUpdates(scene);
        },
        photographGround: async () => null,
        captureView: async () => null,
        whenSubmitted: async () => {},
        unported: () => [],
        stats: () => ({ calls: 0, triangles: 0 }),
        dispose(): void {},
      };
      return { backend: backend as unknown as RenderBackend };
    },
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

const OPTS: RendererOptions = {
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
  quality: QUALITY_PRESETS.high,
  environmentLight: false,
  gpu: 'webgl2',
};

const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};

interface Private {
  decorGroup: THREE.Group | null;
  decorSet: { parts: Map<string, { role: string; geometry: THREE.BufferGeometry }[]> };
  disturbU: DisturbUniformSet;
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;
const W = 40;
const H = 24;

interface World {
  r: ThreeRenderer;
  sim: Sim;
  priv: Private;
  tick(n?: number): void;
}

async function boot(): Promise<World> {
  const WG = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { createFoliageTwinFactory } = await import('./terrain/decor-mesh.node');
  const { MATERIAL_MATHS } = await import('./material-maths');
  seam.kit = { ...NULL_P3_SLOTS, ground: null, ring: null, foliage: createFoliageTwinFactory({ W: WG, TSL, maths: MATERIAL_MATHS.foliage }) };
  const sim = new Sim({ seed: 1, width: W, height: H, capacity: 16 });
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) sim.cover[y * W + x] = 1;
  const tank = sim.spawn(sim.addUnitType(TANK), 0, fx.from(5.5), fx.from(11.5));
  const r = new ThreeRenderer(sim, OPTS);
  const priv = r as unknown as Private;
  const tri = (): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    return g;
  };
  for (const family of ['grass', 'bush', 'tree', 'desert_tree']) {
    for (let v = 0; v < 3; v++) priv.decorSet.parts.set(`${family}_${v}`, [{ role: 'foliage', geometry: tri() }, { role: 'trunk', geometry: tri() }]);
  }
  await r.init(HOST);
  r.camera.x = 12;
  r.camera.y = 12;
  r.snapshot();
  r.frame(1, 0);
  sim.queueCommand({ kind: 'move', ids: [tank], x: fx.from(34.5), y: fx.from(11.5) });
  return {
    r,
    sim,
    priv,
    tick(n = 1): void {
      for (let i = 0; i < n; i++) {
        sim.tick();
        r.snapshot();
      }
    },
  };
}

/** The first decor batch's twin disturbance nodes (the sets are shared by every twin of a record). */
function nodes(w: World): DisturbBindings {
  for (const b of (w.priv.decorGroup as THREE.Group).children as THREE.Mesh[]) {
    const d = nodeDisturbBindings(b.material as THREE.Material);
    if (d !== null) return d;
  }
  throw new Error('spec: no decor batch draws a foliage twin');
}

const val = (n: unknown): unknown => {
  const v = (n as { value: unknown }).value;
  return v instanceof THREE.Vector4 ? v.toArray() : v;
};

/** Every value the twin's nodes hold, as exact bits: all 24 slots of both arrays, the box, the count, the layer and the spring. */
function twinBits(d: DisturbBindings): string {
  return JSON.stringify([
    d.uDisturbA.array.map((v) => [v.x, v.y, v.z, v.w]),
    d.uDisturbB.array.map((v) => [v.x, v.y, v.z]),
    val(d.uDisturbBox),
    val(d.uDisturbN),
    val(d.uDisturbAmp),
    val(d.uDisturbSpring),
  ]);
}

beforeEach(() => {
  seam.kit = null;
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

describe('the node foliage twin builds its disturbers from the tick, at the twin', () => {
  it('two frame cadences that reach one tick leave every node the twin holds bit-identical, and the wake is real', async () => {
    const a = await boot();
    const b = await boot();
    for (let t = 0; t < 75; t++) {
      a.tick();
      for (const alpha of [0.2, 0.55, 0.9]) a.r.frame(alpha, 16 + t);
    }
    b.tick(75);
    a.r.frame(0.4, 3);
    b.r.frame(0.4, 5000);
    const da = nodes(a);
    const db = nodes(b);
    expect(twinBits(da)).toBe(twinBits(db));
    // Anti-vacuity: the tank's wake is in the twin's own nodes (a capsule over a tile long), not an empty array, and it is the record's lane.
    expect(val(da.uDisturbN)).toBeGreaterThanOrEqual(1);
    const slot = da.uDisturbA.array[0];
    expect(Math.hypot(slot.x - slot.z, slot.y - slot.w)).toBeGreaterThan(1.2);
    const rec = a.priv.disturbU;
    expect([slot.x, slot.y, slot.z, slot.w]).toEqual(Array.from(rec.a.value.subarray(0, 4)));
    expect(da.uDisturbB.array[0].x).toBe(rec.b.value[0]);
    expect(val(da.uDisturbN)).toBe(rec.n.value);
    a.r.dispose();
    b.r.dispose();
  });

  it('a zero-time repaint, a long frame and a paused loop change none; a tick moves them', async () => {
    const w = await boot();
    w.tick(60);
    w.r.frame(0.5, 0);
    const base = twinBits(nodes(w));
    for (const dt of [0, 16, 5000]) {
      w.r.frame(0.5, dt);
      expect(twinBits(nodes(w))).toBe(base);
    }
    w.tick(1);
    w.r.frame(0.5, 0);
    expect(twinBits(nodes(w)), 'a tick moves it (the compared values are not constants)').not.toBe(base);
    w.r.dispose();
  });

  it('the disturb layer reaches the twin (amp 0 and back)', async () => {
    const w = await boot();
    w.tick(10);
    expect(w.r.setDebugLayerVisible('disturb', false)).toBe(1);
    w.r.frame(1, 0);
    expect(val(nodes(w).uDisturbAmp)).toBe(0);
    expect(val(nodes(w).uDisturbN)).toBe(0);
    expect(w.r.setDebugLayerVisible('disturb', true)).toBe(1);
    w.r.frame(1, 0);
    expect(val(nodes(w).uDisturbAmp)).toBe(1);
    expect(val(nodes(w).uDisturbN)).toBeGreaterThanOrEqual(1);
    w.r.dispose();
  });
});
