/**
 * E6 (GH-274) chunk C: the beam's draw-call count, MEASURED through three's own render lists, the way
 * chunk B measured the swarm (`swarm-drawcalls.test.ts`, whose harness this repeats verbatim - the
 * decal pools' own recipe: the REAL `WebGLRenderer` on `fake-gl.ts`, `renderBufferDirect` wrapped, a
 * shadow-casting sun, the shadow pass told apart by the null scene it is handed, the GTAO pre-pass by
 * `WorldGTAOPass`'s own `isAoOccluder` recipe).
 *
 * Spec section 4 budgets the beam at ONE draw call while any beam is live, main pass only (transparent
 * and without normals, so neither the shadow nor the AO pre-pass takes it), ZERO when none is, and the
 * heat shimmer at +0 (it is ALU inside the fog pass's existing full-screen quad). This asks all three.
 *
 * What this cannot say: whether the shaders compile on a GPU, or what a pixel looks like.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeWebGL2RenderingContext, fakeCanvas, makeFakeGl } from '../fake-gl';
import { isAoOccluder } from '../post-chain';
import { FogOfWarPass } from '../fog-pass';
import { shimmerSite } from '../shimmer';
import { BEAM_CAPACITY, BeamBatch, type BeamDraw } from './beam-batch';
import { newBeamLook, newBeamLookState, stepBeamLook } from './beam-look';

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


const beam = (i: number): BeamDraw => ({
  ox: 8 + (i % 4) * 3, oy: 1.5, oz: 8 + Math.floor(i / 4) * 3, ex: 11 + (i % 4) * 3, ey: 0.4, ez: 9 + Math.floor(i / 4) * 3,
  look: stepBeamLook(newBeamLookState(), {
    target: 1, dwell: 20, locked: false, dwellTicks: 30, alpha: 0, nowMs: 5000, struckAtMs: null, lockout: false,
  }, newBeamLook()),
});

const total = (r: Record<Pass, number> | undefined): number => (r ? r.main + r.shadow + r.ao : 0);

function setUp() {
  const h = harness();
  const batch = new BeamBatch(h.scene);
  batch.setColors('#F2E8D5', '#E8541E');
  return { h, batch };
}

function drive(batch: BeamBatch, beams: number): void {
  batch.beginFrame(1);
  for (let i = 0; i < beams; i++) batch.add(beam(i));
  batch.finish();
}

describe('draw calls, through three\'s own render lists', () => {
  beforeAll(() => {
    (globalThis as unknown as Record<string, unknown>).WebGL2RenderingContext = FakeWebGL2RenderingContext;
  });
  afterAll(() => {
    delete (globalThis as unknown as Record<string, unknown>).WebGL2RenderingContext;
  });

  it('the harness itself: a transparent mesh is 1 draw (main only), an opaque shadow caster 3', () => {
    const h = harness();
    const caster = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    caster.name = 'caster';
    caster.castShadow = true;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true }));
    glass.name = 'glass';
    for (const m of [caster, glass]) {
      m.position.set(10, 0, 10);
      h.scene.add(m);
    }
    const c = h.frame();
    expect(c.get('caster')).toEqual({ main: 1, shadow: 1, ao: 1 });
    expect(c.get('glass')).toEqual({ main: 1, shadow: 0, ao: 0 });
  });

  it('a live beam is ONE draw call: main pass, no shadow, no AO', () => {
    const { h, batch } = setUp();
    drive(batch, 1);
    expect(h.frame().get('beam-batch')).toEqual({ main: 1, shadow: 0, ao: 0 });
  });

  it('is FIXED: 1, 7 and 16 beams cost the same single draw', () => {
    const { h, batch } = setUp();
    const counts = [1, 7, BEAM_CAPACITY].map((n) => {
      drive(batch, n);
      return total(h.frame().get('beam-batch'));
    });
    expect(counts).toEqual([1, 1, 1]);
  });

  it('an empty batch costs no draw call at all', () => {
    const { h, batch } = setUp();
    drive(batch, 0);
    expect(total(h.frame().get('beam-batch'))).toBe(0);
    drive(batch, 3);
    expect(total(h.frame().get('beam-batch'))).toBe(1);
    drive(batch, 0);
    expect(total(h.frame().get('beam-batch'))).toBe(0);
  });

  it('a debug-hidden batch costs none either', () => {
    const { h, batch } = setUp();
    batch.setDebugHidden(true);
    drive(batch, 4);
    expect(total(h.frame().get('beam-batch'))).toBe(0);
  });
});

describe('the heat shimmer adds no draw call', () => {
  it('the fog pass draws exactly one full-screen quad with eight sites live and with none', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    let renders = 0;
    const renderer = {
      setRenderTarget(): void {},
      clear(): void {},
      render(): void {
        renders++;
      },
    } as unknown as THREE.WebGLRenderer;
    const target = { texture: new THREE.Texture(), depthTexture: new THREE.DepthTexture(4, 4) } as unknown as THREE.WebGLRenderTarget;
    pass.setShimmer([], 1400, 900, 0);
    pass.render(renderer, target, target);
    const none = renders;
    renders = 0;
    pass.setShimmer(Array.from({ length: 8 }, (_, i) => shimmerSite(i / 8, 0.5, 1, 1, 900)), 1400, 900, 3);
    pass.render(renderer, target, target);
    expect(none).toBe(1);
    expect(renders).toBe(1);
  });
});
