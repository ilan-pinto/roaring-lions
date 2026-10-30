/**
 * `rain-batch.ts` (GH-871 P4 T8; S-5): the one draw, its pass membership, its geometry and
 * the GLSL that carries `rain-maths.ts`'s constants.
 *
 * The draw count is MEASURED through three's own render lists, the way the beam and the
 * swarm were (`beam-drawcalls.test.ts`, whose harness this repeats): the REAL `WebGLRenderer`
 * on `fake-gl.ts`, `renderBufferDirect` wrapped, a shadow-casting sun, the shadow pass told
 * apart by the null scene it is handed, the GTAO pre-pass by `isAoOccluder`.
 *
 * What this cannot say: whether the shaders compile on a GPU (the fake links anything) or what a
 * pixel looks like. The first real compile is the lead's S-L2 capture.
 */
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeWebGL2RenderingContext, fakeCanvas, makeFakeGl } from '../fake-gl';
import { isAoOccluder } from '../post-chain';
import { RAIN_FRAGMENT_SHADER, RAIN_SPLASH_QUAD, RAIN_VERTEX_SHADER, RainBatch, glslFloat } from './rain-batch';
import { heightTexels, streakWidthWorld } from './rain-maths';
import { RAIN_RENDER_ORDER } from './render-order';

type Pass = 'main' | 'shadow' | 'ao';

interface Harness {
  readonly scene: THREE.Scene;
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
    scene,
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

const total = (r: Record<Pass, number> | undefined): number => (r ? r.main + r.shadow + r.ao : 0);

function setUp(drops = 1000) {
  const h = harness();
  const batch = new RainBatch(h.scene, { drops, mapWidth: 24, mapHeight: 24 });
  batch.setColors([0.4, 0.4, 0.4], [0.3, 0.3, 0.3]);
  batch.update({ simSec: 1, view: { x: 12, y: 12, zoom: 1, width: 1400, height: 900 }, dpr: 1 });
  return { h, batch };
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

  it('the rain is ONE draw call: main pass, no shadow, no AO (S-5)', () => {
    const { h } = setUp();
    expect(h.frame().get('rain-batch')).toEqual({ main: 1, shadow: 0, ao: 0 });
  });

  it('is FIXED: 100, 1500 and 6000 drops cost the same single draw', () => {
    const counts = [100, 1500, 6000].map((n) => {
      const { h } = setUp(n);
      return total(h.frame().get('rain-batch'));
    });
    expect(counts).toEqual([1, 1, 1]);
  });

  it('a hidden batch (the debug layer, the minimap photograph) costs no draw call at all', () => {
    const { h, batch } = setUp();
    batch.mesh.visible = false;
    expect(total(h.frame().get('rain-batch'))).toBe(0);
    batch.mesh.visible = true;
    expect(total(h.frame().get('rain-batch'))).toBe(1);
  });

  it('is not an AO occluder: transparent and depth-write-off, so the pre-pass skips it', () => {
    const { batch } = setUp();
    expect(isAoOccluder(batch.mesh)).toBe(false);
  });
});

describe('the geometry and the material (S-5)', () => {
  it('has NO normal attribute, casts no shadow, tests depth and never writes it', () => {
    const { batch } = setUp();
    const m = batch.mesh;
    expect(m.geometry.getAttribute('normal')).toBeUndefined();
    expect(Object.keys(m.geometry.attributes).sort()).toEqual(['aSeed', 'position']);
    expect(m.castShadow).toBe(false);
    expect(m.receiveShadow).toBe(false);
    expect(m.material.transparent).toBe(true);
    expect(m.material.depthTest).toBe(true);
    expect(m.material.depthWrite).toBe(false);
    expect(m.frustumCulled).toBe(false);
    expect(m.renderOrder).toBe(RAIN_RENDER_ORDER);
    expect(m.renderOrder).toBe(3);
    expect(m.name).toBe('rain-batch');
  });

  it('holds a streak quad and a splash quad per instance: 8 vertices, 12 indices', () => {
    const { batch } = setUp();
    const pos = batch.mesh.geometry.getAttribute('position');
    expect(pos.count).toBe(8);
    expect(batch.mesh.geometry.index?.count).toBe(12);
    const kinds = Array.from({ length: 8 }, (_, i) => pos.getZ(i));
    expect(kinds).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it('draws the instance count it was given, each with three seed values in [0,1)', () => {
    const { batch } = setUp(1234);
    expect(batch.drops).toBe(1234);
    expect(batch.mesh.geometry.instanceCount).toBe(1234);
    const seeds = batch.mesh.geometry.getAttribute('aSeed');
    expect(seeds.count).toBe(1234);
    expect(seeds.itemSize).toBe(3);
    for (let i = 0; i < seeds.count; i++) {
      for (const v of [seeds.getX(i), seeds.getY(i), seeds.getZ(i)]) expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe('the sim clock: nothing here reads the wall', () => {
  const view = { x: 12, y: 12, zoom: 1, width: 1400, height: 900 };
  const fallOf = (b: RainBatch): number => b.mesh.material.uniforms.uFall.value as number;

  it('two updates at one sim time read identical uniforms; a later time moves the fall', () => {
    const { batch } = setUp();
    batch.update({ simSec: 3.7, view, dpr: 1 });
    const a = { fall: fallOf(batch), low: (batch.mesh.material.uniforms.uLow.value as THREE.Vector2).clone(), period: batch.period };
    batch.update({ simSec: 3.7, view, dpr: 1 });
    expect(fallOf(batch)).toBe(a.fall);
    expect((batch.mesh.material.uniforms.uLow.value as THREE.Vector2).equals(a.low)).toBe(true);
    expect(batch.period).toBe(a.period);
    batch.update({ simSec: 3.75, view, dpr: 1 });
    expect(fallOf(batch)).not.toBe(a.fall);
  });

  it('uFall is mod(4 * t, 6): 3.7 s -> 14.8 mod 6 = 2.8; 1.5 s is one whole fall -> 0', () => {
    const { batch } = setUp();
    batch.update({ simSec: 3.7, view, dpr: 1 });
    expect(fallOf(batch)).toBeCloseTo(2.8, 9);
    batch.update({ simSec: 1.5, view, dpr: 1 });
    expect(fallOf(batch)).toBeCloseTo(0, 9);
    batch.update({ simSec: 0.25, view, dpr: 1 });
    expect(fallOf(batch)).toBeCloseTo(1, 9);
  });

  it('the source reads neither performance.now nor Date nor Math.random', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'rain-batch.ts'), 'utf8');
    expect(src).not.toMatch(/performance\.now|Date\.|Math\.random/);
  });
});

describe('the frame feeds the lattice and the streak width', () => {
  it('picks the period from the view and the window from the box; the half width follows the zoom and DPR', () => {
    const { batch } = setUp();
    const u = batch.mesh.material.uniforms;
    batch.update({ simSec: 0, view: { x: 12, y: 12, zoom: 2.5, width: 1400, height: 900 }, dpr: 1 });
    const p25 = batch.period;
    const w25 = u.uStreakHalfWidth.value as number;
    batch.update({ simSec: 0, view: { x: 12, y: 12, zoom: 0.35, width: 1400, height: 900 }, dpr: 2 });
    expect(batch.period).toBeGreaterThan(p25);
    expect(u.uPeriod.value).toBe(batch.period);
    expect(w25).toBeCloseTo(streakWidthWorld(2.5, 1) / 2, 12);
    expect(u.uStreakHalfWidth.value as number).toBeCloseTo(streakWidthWorld(0.35, 2) / 2, 12);
    // A 24-tile map is 40 across with its 8-tile skirts: 64 covers it, 32 does not.
    expect(batch.period).toBe(64);
  });
});

describe('the height texture', () => {
  it('is R16F-shaped data, four texels a tile, linear and clamped', () => {
    const { batch } = setUp();
    const tex = batch.mesh.material.uniforms.uHeight.value as THREE.DataTexture;
    expect(tex.type).toBe(THREE.HalfFloatType);
    expect(tex.format).toBe(THREE.RedFormat);
    expect(tex.image.width).toBe(96);
    expect(tex.image.height).toBe(96);
    expect(tex.image.width).toBe(heightTexels(24));
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.generateMipmaps).toBe(false);
    // 74 KB on 48x48 (point 17): 192 * 192 * 2 bytes.
    expect(heightTexels(48) ** 2 * 2).toBe(73728);
  });

  it('bakes a sampler into half floats at the texel centres, within 1e-3 (row = z, column = x)', () => {
    const { batch } = setUp();
    const sampler = (x: number, z: number): number => 0.04 * x + 0.02 * z;
    batch.bakeHeights(sampler);
    const tex = batch.mesh.material.uniforms.uHeight.value as THREE.DataTexture;
    const data = tex.image.data as Uint16Array;
    for (const [i, j] of [[0, 0], [5, 3], [95, 0], [0, 95], [40, 71], [95, 95]] as const) {
      const got = THREE.DataUtils.fromHalfFloat(data[j * 96 + i]);
      expect(got, `texel ${i},${j}`).toBeCloseTo(sampler((i + 0.5) / 4, (j + 0.5) / 4), 3);
    }
    // And a second bake overwrites in place (a terrain rebuild): same texture, new values.
    batch.bakeHeights(() => 1);
    expect(batch.mesh.material.uniforms.uHeight.value).toBe(tex);
    expect(THREE.DataUtils.fromHalfFloat(data[40 * 96 + 40])).toBeCloseTo(1, 3);
  });
});

describe('the GLSL carries the maths` constants (G-6)', () => {
  it('interpolates every number from the same exports, as fixed-point literals', () => {
    for (const [name, v] of [
      ['RAIN_H', 6],
      ['RAIN_V', 4],
      ['RAIN_LEN', 0.42],
      ['RAIN_TAN', Math.tan((12 * Math.PI) / 180)],
      ['RAIN_SIN', Math.sin((12 * Math.PI) / 180)],
      ['RAIN_COS', Math.cos((12 * Math.PI) / 180)],
      ['RAIN_STREAK_A', 0.28],
      ['RAIN_SPLASH_A', 0.35],
      ['RAIN_SPLASH_MS', 150],
      ['RAIN_SPLASH_R0', 0.04],
      ['RAIN_SPLASH_R1', 0.1],
      ['RAIN_SPLASH_LIFT', 0.04],
      ['RAIN_SPLASH_QUAD', 1.25],
    ] as const) {
      expect(RAIN_VERTEX_SHADER, name).toContain(`const float ${name} = ${v.toFixed(8)};`);
    }
    // The wind is the foliage sway's axis (0.70710678, -0.70710678).
    expect(RAIN_VERTEX_SHADER).toContain('const vec2 RAIN_WIND = vec2(0.70710678, -0.70710678);');
    expect(RAIN_FRAGMENT_SHADER).toContain('const float RAIN_SPLASH_QUAD = 1.25000000;');
    expect(RAIN_SPLASH_QUAD).toBe(1.25);
    expect(glslFloat(0.42)).toBe('0.42000000');
  });

  it('keeps the maths shape: world-anchored wrap, the sampled ground, the fall phase and the splash age', () => {
    expect(RAIN_VERTEX_SHADER).toContain('mod(aSeed.x * uPeriod - uLow.x, uPeriod)');
    expect(RAIN_VERTEX_SHADER).toContain('mod(aSeed.z * uPeriod - uLow.y, uPeriod)');
    expect(RAIN_VERTEX_SHADER).toContain('mod(aSeed.y * RAIN_H + uFall, RAIN_H)');
    expect(RAIN_VERTEX_SHADER).toContain('float ageMs = phase / RAIN_V * 1000.0;');
    expect(RAIN_VERTEX_SHADER).toContain('texture2D(uHeight');
    // It reads no clock of its own: the only time is the CPU-built fall offset.
    expect(RAIN_VERTEX_SHADER).not.toMatch(/uTime|uNow/);
  });
});

describe('dispose', () => {
  it('removes the mesh and releases the geometry, material and height texture', () => {
    const { h, batch } = setUp();
    const tex = batch.mesh.material.uniforms.uHeight.value as THREE.DataTexture;
    let disposed = 0;
    for (const o of [batch.mesh.geometry, batch.mesh.material, tex]) o.addEventListener('dispose', () => disposed++);
    batch.dispose();
    batch.dispose();
    expect(disposed).toBe(3);
    expect(h.scene.children).not.toContain(batch.mesh);
  });
});
