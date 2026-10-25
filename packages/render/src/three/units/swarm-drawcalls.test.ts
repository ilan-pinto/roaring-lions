/**
 * E6 (GH-274) chunk B: the swarm's draw-call count, MEASURED through three's own render lists.
 *
 * `docs/PERFORMANCE.md` measured the decal pools by wrapping `renderBufferDirect` on a browser's
 * renderer for one frame with the shadow map forced. Chunk B had no browser, and the question never
 * needed a rasteriser: how many times three submits an object is decided by `projectObject` and the
 * pass it is in, not by the GPU. So this runs the REAL `WebGLRenderer` on `fake-gl.ts` (a context that
 * accepts every call and draws nothing), wraps `renderBufferDirect` exactly as that measurement did,
 * and counts per object over one frame with a shadow-casting sun:
 *
 *  - the MAIN pass is `renderer.render(scene, camera)`;
 *  - the SHADOW pass is the same call (a sun with `castShadow`, the shadow map forced), told apart
 *    because three hands the shadow pass a `null` scene;
 *  - the AO pre-pass is `WorldGTAOPass.render`'s own recipe: hide whatever `isAoOccluder` rejects,
 *    override the material, render (`post-chain.ts`).
 *
 * What this cannot say: whether the shaders compile on a GPU, or what a pixel looks like. It says how
 * many times each object is submitted, which is the number the spec budgets (section 4).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeWebGL2RenderingContext, fakeCanvas, makeFakeGl } from '../fake-gl';
import { isAoOccluder } from '../post-chain';
import { parseGlbHeadless } from './headless-gltf';
import { buildVehicleMeshTemplate } from './mesh-vehicle';
import { SwarmBatch, extractSwarmParts, type SwarmBatchEvent, type SwarmEntityInput, type SwarmFrameEnv } from './swarm-batch';

const GLB = fileURLToPath(new URL('../../../../../art/meshes/vehicles/drone_swarm.glb', import.meta.url));

type Pass = 'main' | 'shadow' | 'ao';

interface Harness {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** `object name -> draws per pass` over the frame just rendered. */
  frame(): Map<string, Record<Pass, number>>;
}

function harness(): Harness {
  const { gl } = makeFakeGl();
  const renderer = new THREE.WebGLRenderer({ canvas: fakeCanvas(), context: gl });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = true;
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(256, 256);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -40;
  sun.shadow.camera.right = sun.shadow.camera.top = 40;
  sun.position.set(-4, 8, 4);
  scene.add(sun, sun.target);
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 200);
  camera.position.set(20, 20, 20);
  camera.lookAt(10, 0, 10);
  camera.updateMatrixWorld(true);

  let pass: Pass = 'main';
  const counts = new Map<string, Record<Pass, number>>();
  const real = renderer.renderBufferDirect.bind(renderer);
  (renderer as unknown as { renderBufferDirect: unknown }).renderBufferDirect = (
    cam: THREE.Camera,
    sc: THREE.Scene | null,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    object: THREE.Object3D,
    group: unknown
  ): unknown => {
    const p: Pass = sc === null ? 'shadow' : pass;
    const row = counts.get(object.name) ?? { main: 0, shadow: 0, ao: 0 };
    row[p]++;
    counts.set(object.name, row);
    return (real as (...a: unknown[]) => unknown)(cam, sc, geometry, material, object, group);
  };

  return {
    renderer,
    scene,
    camera,
    frame(): Map<string, Record<Pass, number>> {
      counts.clear();
      scene.updateMatrixWorld(true);
      pass = 'main';
      renderer.render(scene, camera);
      // The GTAO pre-pass, as `WorldGTAOPass.render` runs it.
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.visible && !isAoOccluder(o)) {
          o.visible = false;
          hidden.push(o);
        }
      });
      const autoUpdate = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      scene.overrideMaterial = new THREE.MeshNormalMaterial();
      pass = 'ao';
      try {
        renderer.render(scene, camera);
      } finally {
        scene.overrideMaterial = null;
        renderer.shadowMap.autoUpdate = autoUpdate;
        for (const o of hidden) o.visible = true;
        pass = 'main';
      }
      return new Map(counts);
    },
  };
}

const env = (over: Partial<SwarmFrameEnv> = {}): SwarmFrameEnv => ({
  simTick: 0, simSec: 2, groundAt: () => 0, drawnAt: () => true, exploredAt: () => true,
  bodiesHidden: false, quiet: false, ...over,
});

const entity = (id: number, live: number): SwarmEntityInput => ({
  id, side: 1, count: 12, spreadTiles: 1.5, live, x: 8 + (id % 4) * 3, z: 8 + Math.floor(id / 4) * 3, groundY: 0, liftY: 0.357, yaw: 0, drawn: true,
});

function drive(batch: SwarmBatch, swarms: number, live: number, dt = 0.016, simSec = 2): void {
  batch.beginFrame(env({ simSec }));
  const events: SwarmBatchEvent[] = [];
  for (let id = 0; id < swarms; id++) batch.updateEntity(entity(id, live), undefined, events);
  batch.stepExits(dt);
  batch.finish();
}

const total = (r: Record<Pass, number> | undefined): number => (r ? r.main + r.shadow + r.ao : 0);

describe('draw calls, through three\'s own render lists', () => {
  beforeAll(() => {
    (globalThis as unknown as Record<string, unknown>).WebGL2RenderingContext = FakeWebGL2RenderingContext;
  });
  afterAll(() => {
    delete (globalThis as unknown as Record<string, unknown>).WebGL2RenderingContext;
  });

  async function setUp() {
    const h = harness();
    const t = buildVehicleMeshTemplate(await parseGlbHeadless(readFileSync(GLB)), 'drone_swarm');
    const batch = new SwarmBatch(h.scene, extractSwarmParts(t));
    return { h, batch };
  }

  it('the harness itself: a shadow-casting opaque mesh is 3 draws (main, shadow, AO); one that casts none is 2; a transparent one is 1', () => {
    const h = harness();
    const caster = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    caster.name = 'caster';
    caster.castShadow = true;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    floor.name = 'floor';
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true }));
    glass.name = 'glass';
    for (const m of [caster, floor, glass]) {
      m.position.set(10, 0, 10);
      h.scene.add(m);
    }
    const c = h.frame();
    expect(c.get('caster')).toEqual({ main: 1, shadow: 1, ao: 1 });
    expect(c.get('floor')).toEqual({ main: 1, shadow: 0, ao: 1 });
    expect(c.get('glass')).toEqual({ main: 1, shadow: 0, ao: 0 });
  });

  it('bodies draw 3 times, the rotor discs once, the wrecks twice - whatever the member count', async () => {
    const { h, batch } = await setUp();
    // Put one wreck down so the wreck batch is live.
    drive(batch, 1, 12);
    drive(batch, 1, 11);
    drive(batch, 1, 11, 1);
    expect(batch.wreckCount).toBe(1);
    drive(batch, 1, 11, 0);
    const c = h.frame();
    expect(c.get('swarm-bodies')).toEqual({ main: 1, shadow: 1, ao: 1 });
    expect(c.get('swarm-rotors')).toEqual({ main: 1, shadow: 0, ao: 0 });
    expect(c.get('swarm-wrecks')).toEqual({ main: 1, shadow: 0, ao: 1 });
    expect(total(c.get('swarm-bodies')) + total(c.get('swarm-rotors')) + total(c.get('swarm-wrecks'))).toBe(3 + 1 + 2);
  });

  it('is FIXED: 1 swarm of 12, 16 swarms of 12 and 16 swarms plus a full wreck ring cost the same six draws', async () => {
    const { h, batch } = await setUp();
    const sum = (c: Map<string, Record<Pass, number>>): number =>
      total(c.get('swarm-bodies')) + total(c.get('swarm-rotors')) + total(c.get('swarm-wrecks'));
    drive(batch, 1, 12, 0);
    const one = sum(h.frame());
    drive(batch, 16, 12, 0);
    expect(batch.bodies.count).toBe(192);
    const sixteen = sum(h.frame());
    // Fill the wreck ring: 16 swarms x 12 members all shot down, then let the tumbles end.
    drive(batch, 16, 12);
    for (let round = 0; round < 8; round++) {
      batch.beginFrame(env());
      const events: SwarmBatchEvent[] = [];
      for (let id = 0; id < 16; id++) batch.updateEntity(entity(id + round * 16, 12), undefined, events);
      batch.stepExits(0);
      batch.finish();
      batch.beginFrame(env());
      for (let id = 0; id < 16; id++) batch.updateEntity(entity(id + round * 16, 0), undefined, events);
      batch.stepExits(1);
      batch.finish();
    }
    expect(batch.wreckCount).toBe(96);
    drive(batch, 16, 12, 0);
    const full = sum(h.frame());
    // 3 (bodies) + 1 (rotors) + 2 (wrecks, once any lie): the first two readings have no wreck yet.
    expect(one).toBe(4);
    expect(sixteen).toBe(4);
    expect(full).toBe(6);
  });

  it('an empty batch costs no draw call at all', async () => {
    const { h, batch } = await setUp();
    drive(batch, 0, 12, 0);
    const c = h.frame();
    expect(total(c.get('swarm-bodies'))).toBe(0);
    expect(total(c.get('swarm-rotors'))).toBe(0);
    expect(total(c.get('swarm-wrecks'))).toBe(0);
  });

  it('the rotor discs are never in the AO pre-pass or the shadow pass (transparent, no normals)', async () => {
    const { h, batch } = await setUp();
    drive(batch, 4, 12, 0);
    const r = h.frame().get('swarm-rotors');
    expect(r?.ao).toBe(0);
    expect(r?.shadow).toBe(0);
    expect(r?.main).toBe(1);
  });
});
