/**
 * Phase D readiness fix: smoke on screen. Structural template is
 * `fog-mesh.test.ts` (same `environment: 'node'` guarantee -- `writeSmokeInstances`
 * touches no `THREE.*`, `SmokeMesh` construction and `.update()` build real
 * three.js JS-side objects that need no `WebGLRenderer` to construct).
 *
 * Every assertion below that matters was verified by breaking the
 * corresponding line in `smoke-mesh.ts` by hand and confirming the SPECIFIC
 * test named goes red, then reverting -- this project's own standard
 * (`fog-mesh.test.ts`'s own top comment names the precedent).
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { groundWorldY } from './ground-height';
import { hexToUnit } from './terrain/shared';
import { fogQuadGeometry } from './fog-mesh';
import { SMOKE_RENDER_ORDER, OVERLAY_RENDER_ORDER, FOG_RENDER_ORDER } from './units/render-order';
import {
  SMOKE_COLOR,
  SMOKE_ALPHA_MAX,
  writeSmokeInstances,
  SmokeMesh,
  type SmokeInstanceBuffers,
} from './smoke-mesh';

const W = 4;
const H = 4;

/** Every tile smoke-free -- the genuine boot state. */
function emptySmoke(): Uint8Array {
  return new Uint8Array(W * H);
}

function buffers(capacity: number): SmokeInstanceBuffers {
  return {
    positions: new Float32Array(capacity * 3),
    alphas: new Float32Array(capacity),
  };
}

describe('SMOKE_COLOR / SMOKE_ALPHA_MAX', () => {
  it('matches Pixi\'s own smoke-fill literal (renderer.ts:2589), #C9CBC4', () => {
    expect(SMOKE_COLOR).toBe('#C9CBC4');
  });

  it('matches Pixi\'s own alpha multiplier, 0.72', () => {
    expect(SMOKE_ALPHA_MAX).toBe(0.72);
  });
});

describe('writeSmokeInstances', () => {
  it('a tile with smoke value 0 writes no instance at all', () => {
    const smoke = emptySmoke();
    smoke[5] = 0;
    const out = buffers(W * H);
    expect(writeSmokeInstances(smoke, W, H, null, out)).toBe(0);
  });

  it('a tile with any nonzero smoke value writes exactly one instance', () => {
    const smoke = emptySmoke();
    smoke[5] = 1; // the faintest possible trace
    const out = buffers(W * H);
    expect(writeSmokeInstances(smoke, W, H, null, out)).toBe(1);
  });

  // Break check (verified by hand): change `(d / 255) * SMOKE_ALPHA_MAX` to
  // a constant in writeSmokeInstances -- this test's two distinct-alpha
  // assertions fail.
  it('alpha scales linearly with the raw smoke byte, matching (d / 255) * SMOKE_ALPHA_MAX exactly', () => {
    const smoke = emptySmoke();
    smoke[0] = 255; // fully thick
    smoke[1] = 128; // roughly half
    const out = buffers(W * H);
    writeSmokeInstances(smoke, W, H, null, out);
    expect(out.alphas[0]).toBeCloseTo((255 / 255) * SMOKE_ALPHA_MAX, 6);
    expect(out.alphas[1]).toBeCloseTo((128 / 255) * SMOKE_ALPHA_MAX, 6);
    expect(out.alphas[0]).toBeCloseTo(SMOKE_ALPHA_MAX, 6);
    expect(out.alphas[0]).not.toBeCloseTo(out.alphas[1], 6);
  });

  it('on flat ground (no elevation layer), every instance sits at world Y 0', () => {
    const smoke = emptySmoke();
    smoke[0] = 200;
    const out = buffers(W * H);
    writeSmokeInstances(smoke, W, H, null, out);
    expect(out.positions[1]).toBe(0);
  });

  it('on raised ground, the smoke quad follows the tile\'s OWN elevation, not world Y 0', () => {
    // Same 4x4, level-3-at-(1,1) fixture fog-mesh.test.ts's own elevation
    // test uses.
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const smoke = emptySmoke();
    smoke[1 * W + 1] = 200;
    const out = buffers(W * H);
    writeSmokeInstances(smoke, W, H, elevation, out);
    expect(out.positions[1]).toBeGreaterThan(0);
    expect(out.positions[1]).toBeCloseTo(groundWorldY(elevation, W, H, 1, 1), 5);
  });

  it('positions x/z at the tile\'s own integer coordinates', () => {
    const smoke = emptySmoke();
    smoke[2 * W + 3] = 200; // tile (x=3, y=2)
    const out = buffers(W * H);
    writeSmokeInstances(smoke, W, H, null, out);
    expect(out.positions[0]).toBe(3);
    expect(out.positions[2]).toBe(2);
  });

  it('stops at the output buffer\'s own capacity rather than overrunning it', () => {
    const smoke = new Uint8Array(W * H).fill(200); // every tile smoked
    const out = buffers(4);
    expect(writeSmokeInstances(smoke, W, H, null, out)).toBe(4);
  });

  it('a fully smoke-free map writes zero instances', () => {
    const smoke = emptySmoke();
    const out = buffers(W * H);
    expect(writeSmokeInstances(smoke, W, H, null, out)).toBe(0);
  });
});

describe('SmokeMesh construction', () => {
  it('starts with mesh.count 0 and grows to the written instance count on update', () => {
    const mesh = new SmokeMesh(W, H);
    expect(mesh.mesh.count).toBe(0);
    const smoke = emptySmoke();
    smoke[0] = 100;
    smoke[1] = 200;
    mesh.update(smoke, null, W, H);
    expect(mesh.mesh.count).toBe(2);
  });

  it('drops back to a smaller count as smoke lifts', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[0] = 100;
    smoke[1] = 100;
    mesh.update(smoke, null, W, H);
    expect(mesh.mesh.count).toBe(2);
    smoke[1] = 0; // lifted
    mesh.update(smoke, null, W, H);
    expect(mesh.mesh.count).toBe(1);
  });

  it('the material is transparent, depth-tested false, depth-written false -- an unconditional overlay, matching FogMesh', () => {
    const mesh = new SmokeMesh(W, H);
    const m = mesh.mesh.material as THREE.Material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
  });

  it('the uColor uniform holds exactly hexToUnit(SMOKE_COLOR), component-wise -- the value the shader actually reads', () => {
    const mesh = new SmokeMesh(W, H);
    const material = mesh.mesh.material as THREE.ShaderMaterial;
    const uColor = material.uniforms.uColor.value as THREE.Vector3;
    const [r, g, b] = hexToUnit(SMOKE_COLOR);
    expect(uColor.x).toBeCloseTo(r, 6);
    expect(uColor.y).toBeCloseTo(g, 6);
    expect(uColor.z).toBeCloseTo(b, 6);
  });

  it('draws in the SMOKE band, above the overlay tier and below fog -- it must paint over HP bars/rings/markers, and still be hidden by fog', () => {
    const mesh = new SmokeMesh(W, H);
    expect(mesh.mesh.renderOrder).toBe(SMOKE_RENDER_ORDER);
    expect(SMOKE_RENDER_ORDER).toBeGreaterThan(OVERLAY_RENDER_ORDER);
    expect(SMOKE_RENDER_ORDER).toBeLessThan(FOG_RENDER_ORDER);
  });

  it('mesh is exempt from frustum culling, matching every other whole-map mesh in this backend', () => {
    const mesh = new SmokeMesh(W, H);
    expect(mesh.mesh.frustumCulled).toBe(false);
  });

  it('reuses fogQuadGeometry\'s own vertex layout rather than a second copy', () => {
    const mesh = new SmokeMesh(W, H);
    const geo = fogQuadGeometry();
    const posAttr = mesh.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(Array.from(posAttr.array)).toEqual(Array.from(geo.positions));
  });

  it('writes correct per-instance position into the instance matrix, not merely the right count', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[2 * W + 3] = 200; // tile (3, 2)
    mesh.update(smoke, null, W, H);
    const m = new THREE.Matrix4();
    mesh.mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(3, 5);
    expect(pos.y).toBeCloseTo(0, 5);
    expect(pos.z).toBeCloseTo(2, 5);
  });

  it('dispose() releases both geometry and material', () => {
    const mesh = new SmokeMesh(W, H);
    const geoDispose = vi.spyOn(mesh.mesh.geometry, 'dispose');
    const matDispose = vi.spyOn(mesh.mesh.material as THREE.Material, 'dispose');
    mesh.dispose();
    expect(geoDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
  });
});
