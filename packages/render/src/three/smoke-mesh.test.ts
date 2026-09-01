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
  SMOKE_BOB_AMPLITUDE,
  SMOKE_DRIFT_AMPLITUDE,
  SMOKE_SCALE_PULSE_AMOUNT,
  SMOKE_ALPHA_NOISE_MIN,
  SMOKE_GROW_DURATION_MS,
  SMOKE_GROW_ALPHA_FLOOR,
  SMOKE_GROW_SCALE_FLOOR,
  smokeTilePhase,
  smokeBobOffset,
  smokeDriftX,
  smokeDriftZ,
  smokeScalePulse,
  smokeAlphaNoise,
  smokeGrowEase,
  smokeGrowAlphaFactor,
  smokeGrowScaleFactor,
  updateSmokeGrowStarts,
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

  // GH #144: the matrix is no longer a bare translation of the tile's own
  // integer coordinates -- it is composed from that base position plus the
  // animation offsets `SmokeMesh.update` threads through `smokeDriftX/Z`,
  // `smokeBobOffset`, `smokeScalePulse` and `smokeGrowScaleFactor`. This
  // test proves the WIRING -- that `update()` actually calls those exact
  // pure functions with the tile's own (x, z) and the given `clockMs`, not
  // that the functions themselves are correct (each has its own dedicated
  // tests below, in isolation, for that).
  it('composes the instance matrix from the tile position plus the documented animation offsets, not a bare translation', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[2 * W + 3] = 200; // tile (x=3, z=2)
    const CLOCK = 0; // first-ever update: this tile is also "born" at this clock
    mesh.update(smoke, null, W, H, CLOCK);
    const m = new THREE.Matrix4();
    mesh.mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);

    const phase = smokeTilePhase(3, 2);
    const ageMs = CLOCK - CLOCK; // this exact call is the birth frame
    const expectedScale = smokeScalePulse(CLOCK, phase) * smokeGrowScaleFactor(ageMs);
    const centerAdjust = (1 - expectedScale) * 0.5;

    expect(pos.x).toBeCloseTo(3 + centerAdjust + smokeDriftX(CLOCK, phase), 6);
    expect(pos.y).toBeCloseTo(smokeBobOffset(CLOCK, phase), 6);
    expect(pos.z).toBeCloseTo(2 + centerAdjust + smokeDriftZ(CLOCK, phase), 6);
    expect(scale.x).toBeCloseTo(expectedScale, 6);
    expect(scale.y).toBeCloseTo(expectedScale, 6);
    expect(scale.z).toBeCloseTo(expectedScale, 6);
    // No rotation -- smoke quads never yaw (see the class's own
    // `identityQuat` doc comment).
    expect(quat.x).toBeCloseTo(0, 6);
    expect(quat.y).toBeCloseTo(0, 6);
    expect(quat.z).toBeCloseTo(0, 6);
    expect(quat.w).toBeCloseTo(1, 6);
  });

  it('the animation bob is ADDED on top of the tile\'s own elevation, not a replacement for it', () => {
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[1 * W + 1] = 200; // the raised tile
    const CLOCK = 777;
    mesh.update(smoke, elevation, W, H, CLOCK);
    const m = new THREE.Matrix4();
    mesh.mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);
    const groundY = groundWorldY(elevation, W, H, 1, 1);
    const phase = smokeTilePhase(1, 1);
    expect(groundY).toBeGreaterThan(0);
    expect(pos.y).toBeCloseTo(groundY + smokeBobOffset(CLOCK, phase), 6);
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

// ---------------------------------------------------------------------------
// GH #144: presentation animation. Every function below is a plain function
// of its explicit inputs -- no THREE.*, no Math.random, no Date.now -- so
// each is exercised directly, the same `environment: 'node'` guarantee the
// rest of this file relies on.
// ---------------------------------------------------------------------------

describe('smokeTilePhase', () => {
  it('is deterministic: the same tile always yields the same phase', () => {
    expect(smokeTilePhase(5, 9)).toBe(smokeTilePhase(5, 9));
  });

  it('differs between tiles -- a whole smoke screen does not animate in lockstep', () => {
    const phases = new Set<number>();
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        phases.add(smokeTilePhase(x, y));
      }
    }
    // 16 distinct tiles; a shared or degenerate hash would collapse this set.
    expect(phases.size).toBe(16);
  });
});

describe('smokeBobOffset / smokeDriftX / smokeDriftZ / smokeScalePulse -- bounded, deterministic motion', () => {
  const phase = smokeTilePhase(2, 7);

  it('smokeBobOffset never exceeds its documented amplitude', () => {
    for (let clockMs = 0; clockMs < 20000; clockMs += 137) {
      expect(Math.abs(smokeBobOffset(clockMs, phase))).toBeLessThanOrEqual(SMOKE_BOB_AMPLITUDE + 1e-9);
    }
  });

  it('smokeDriftX and smokeDriftZ never exceed their documented amplitude', () => {
    for (let clockMs = 0; clockMs < 20000; clockMs += 149) {
      expect(Math.abs(smokeDriftX(clockMs, phase))).toBeLessThanOrEqual(SMOKE_DRIFT_AMPLITUDE + 1e-9);
      expect(Math.abs(smokeDriftZ(clockMs, phase))).toBeLessThanOrEqual(SMOKE_DRIFT_AMPLITUDE + 1e-9);
    }
  });

  it('smokeScalePulse stays within 1 +/- SMOKE_SCALE_PULSE_AMOUNT', () => {
    for (let clockMs = 0; clockMs < 20000; clockMs += 151) {
      const s = smokeScalePulse(clockMs, phase);
      expect(s).toBeGreaterThanOrEqual(1 - SMOKE_SCALE_PULSE_AMOUNT - 1e-9);
      expect(s).toBeLessThanOrEqual(1 + SMOKE_SCALE_PULSE_AMOUNT + 1e-9);
    }
  });

  it('every function above is deterministic -- same (clockMs, phase) in, same value out', () => {
    expect(smokeBobOffset(1234, phase)).toBe(smokeBobOffset(1234, phase));
    expect(smokeDriftX(1234, phase)).toBe(smokeDriftX(1234, phase));
    expect(smokeDriftZ(1234, phase)).toBe(smokeDriftZ(1234, phase));
    expect(smokeScalePulse(1234, phase)).toBe(smokeScalePulse(1234, phase));
  });

  it('is genuinely time-varying -- not a constant masquerading as motion', () => {
    expect(smokeBobOffset(0, phase)).not.toBeCloseTo(smokeBobOffset(900, phase), 4);
  });
});

describe('smokeAlphaNoise', () => {
  it('stays within [SMOKE_ALPHA_NOISE_MIN, 1] for every input', () => {
    const phase = smokeTilePhase(9, 1);
    for (let clockMs = 0; clockMs < 20000; clockMs += 97) {
      const v = smokeAlphaNoise(clockMs, phase);
      expect(v).toBeGreaterThanOrEqual(SMOKE_ALPHA_NOISE_MIN - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('actually reaches both ends of its range across a full period, rather than sitting flat', () => {
    const phase = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let clockMs = 0; clockMs < 2000; clockMs += 5) {
      const v = smokeAlphaNoise(clockMs, phase);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeCloseTo(SMOKE_ALPHA_NOISE_MIN, 2);
    expect(max).toBeCloseTo(1, 2);
  });
});

describe('smokeGrowEase / smokeGrowAlphaFactor / smokeGrowScaleFactor', () => {
  it('smokeGrowEase is 0 at birth and 1 once the grow window has fully elapsed, clamped beyond it', () => {
    expect(smokeGrowEase(0)).toBe(0);
    expect(smokeGrowEase(SMOKE_GROW_DURATION_MS)).toBeCloseTo(1, 6);
    expect(smokeGrowEase(SMOKE_GROW_DURATION_MS * 50)).toBeCloseTo(1, 6);
  });

  it('smokeGrowAlphaFactor ranges [SMOKE_GROW_ALPHA_FLOOR, 1] and is monotonically non-decreasing across the window', () => {
    expect(smokeGrowAlphaFactor(0)).toBeCloseTo(SMOKE_GROW_ALPHA_FLOOR, 6);
    expect(smokeGrowAlphaFactor(SMOKE_GROW_DURATION_MS)).toBeCloseTo(1, 6);
    let prev = -Infinity;
    for (let age = 0; age <= SMOKE_GROW_DURATION_MS; age += 10) {
      const v = smokeGrowAlphaFactor(age);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('smokeGrowScaleFactor ranges [SMOKE_GROW_SCALE_FLOOR, 1] and is monotonically non-decreasing across the window', () => {
    expect(smokeGrowScaleFactor(0)).toBeCloseTo(SMOKE_GROW_SCALE_FLOOR, 6);
    expect(smokeGrowScaleFactor(SMOKE_GROW_DURATION_MS)).toBeCloseTo(1, 6);
    let prev = -Infinity;
    for (let age = 0; age <= SMOKE_GROW_DURATION_MS; age += 10) {
      const v = smokeGrowScaleFactor(age);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('a negative age (should not occur, but growStart could equal clockMs on the exact birth frame) clamps to the floor rather than going out of range', () => {
    expect(smokeGrowAlphaFactor(-50)).toBeCloseTo(SMOKE_GROW_ALPHA_FLOOR, 6);
    expect(smokeGrowScaleFactor(-50)).toBeCloseTo(SMOKE_GROW_SCALE_FLOOR, 6);
  });
});

describe('updateSmokeGrowStarts', () => {
  function grid(): { smoke: Uint8Array; prev: Uint8Array; growStart: Float64Array } {
    return { smoke: emptySmoke(), prev: emptySmoke(), growStart: new Float64Array(W * H) };
  }

  it('stamps growStart with clockMs for a tile transitioning 0 -> nonzero', () => {
    const { smoke, prev, growStart } = grid();
    smoke[5] = 200;
    updateSmokeGrowStarts(smoke, prev, growStart, 1000, W, H);
    expect(growStart[5]).toBe(1000);
  });

  it('leaves growStart untouched for a tile that stays 0', () => {
    const { smoke, prev, growStart } = grid();
    updateSmokeGrowStarts(smoke, prev, growStart, 1000, W, H);
    expect(growStart[5]).toBe(0);
  });

  it('does NOT restamp a tile that was already nonzero last call -- ongoing smoke keeps its original birth clock', () => {
    const { smoke, prev, growStart } = grid();
    smoke[5] = 200;
    updateSmokeGrowStarts(smoke, prev, growStart, 1000, W, H); // birth at t=1000
    smoke[5] = 150; // still smoking, just decaying
    updateSmokeGrowStarts(smoke, prev, growStart, 1500, W, H);
    expect(growStart[5]).toBe(1000);
  });

  it('DOES restamp a tile that goes nonzero -> 0 -> nonzero again -- a fresh screen is a new birth', () => {
    const { smoke, prev, growStart } = grid();
    smoke[5] = 200;
    updateSmokeGrowStarts(smoke, prev, growStart, 1000, W, H); // first birth
    smoke[5] = 0;
    updateSmokeGrowStarts(smoke, prev, growStart, 2000, W, H); // fully lifted
    smoke[5] = 255;
    updateSmokeGrowStarts(smoke, prev, growStart, 3000, W, H); // reborn
    expect(growStart[5]).toBe(3000);
  });

  it('updates prevSmoke to the current frame, so the diff base always advances', () => {
    const { smoke, prev, growStart } = grid();
    smoke[5] = 200;
    updateSmokeGrowStarts(smoke, prev, growStart, 1000, W, H);
    expect(prev[5]).toBe(200);
  });
});

describe('SmokeMesh animation integration (GH #144)', () => {
  function alphaAt(mesh: SmokeMesh, index: number): number {
    const attr = mesh.mesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    return (attr.array as Float32Array)[index];
  }

  it('a smoked tile\'s rendered alpha genuinely changes frame to frame even with the sim byte completely unchanged -- the exact flatness GH #144 reports', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[5] = 180; // fixed density, never touched again below
    const seen = new Set<number>();
    for (let clockMs = 0; clockMs < 4000; clockMs += 233) {
      mesh.update(smoke, null, W, H, clockMs);
      seen.add(Number(alphaAt(mesh, 0).toFixed(6)));
    }
    // Old behaviour: one value, forever, for an unchanged `d`. New: several.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('a smoked tile\'s composed position genuinely changes frame to frame even with the sim byte completely unchanged', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[5] = 180;
    const positions = new Set<string>();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let clockMs = 0; clockMs < 8000; clockMs += 401) {
      mesh.update(smoke, null, W, H, clockMs);
      mesh.mesh.getMatrixAt(0, m);
      m.decompose(pos, quat, scale);
      positions.add(`${pos.x.toFixed(6)},${pos.y.toFixed(6)},${pos.z.toFixed(6)}`);
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it('never renders a smoked tile fully transparent, even at the exact birth frame (worst case: grow floor and alpha-noise floor both apply)', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[0] = 1; // the faintest possible nonzero density
    for (let clockMs = 0; clockMs < 6000; clockMs += 17) {
      mesh.update(smoke, null, W, H, clockMs);
      expect(alphaAt(mesh, 0)).toBeGreaterThan(0);
    }
  });

  it('a tile transitioning into smoke THIS frame renders dimmer than the identical density once fully bloomed in -- isolating the grow-in from alpha noise by comparing at the SAME clockMs and SAME tile, so the noise factor is identical in both', () => {
    const smoke = emptySmoke();
    smoke[5] = 200; // tile (1, 1) on a 4-wide grid
    const CLOCK = 12345;

    const justBorn = new SmokeMesh(W, H);
    justBorn.update(smoke, null, W, H, CLOCK); // prevSmoke was 0 -- this is the birth frame

    const longSince = new SmokeMesh(W, H);
    longSince.update(smoke, null, W, H, CLOCK - SMOKE_GROW_DURATION_MS * 10); // born long ago
    longSince.update(smoke, null, W, H, CLOCK); // sampled at the identical clock

    expect(alphaAt(justBorn, 0)).toBeLessThan(alphaAt(longSince, 0));
  });

  it('the animation is deterministic given the same tick sequence -- two freshly constructed meshes driven through the same clockMs values land on identical alpha and position, matching this codebase\'s no-Math.random VFX convention', () => {
    const smoke = emptySmoke();
    smoke[5] = 180;
    const a = new SmokeMesh(W, H);
    const b = new SmokeMesh(W, H);
    for (const clockMs of [0, 233, 466, 4000]) {
      a.update(smoke, null, W, H, clockMs);
      b.update(smoke, null, W, H, clockMs);
    }
    expect(alphaAt(a, 0)).toBe(alphaAt(b, 0));
    const ma = new THREE.Matrix4();
    const mb = new THREE.Matrix4();
    a.mesh.getMatrixAt(0, ma);
    b.mesh.getMatrixAt(0, mb);
    expect(ma.elements).toEqual(mb.elements);
  });
});
