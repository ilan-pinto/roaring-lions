/**
 * Structural template is `fog-mesh.test.ts` (same `environment: 'node'`
 * guarantee -- `writeSmokeInstances`/`writeSmokePuffPlacement` touch no
 * `THREE.*`, `SmokeMesh` construction and `.update()` build real three.js
 * JS-side objects that need no `WebGLRenderer` to construct).
 *
 * This task (2026-09-06, "improve smoke animation") replaced the old
 * one-quad-per-tile draw with `SMOKE_PUFFS_PER_TILE` soft-edged puffs per
 * tile and the old linear alpha with a density curve -- see `smoke-mesh.ts`'s
 * own top comment for the full account. Tests below that exercised the OLD
 * single-quad-per-tile geometry (matrix composition, `fogQuadGeometry`
 * reuse, `SMOKE_COLOR`/`SMOKE_ALPHA_MAX` literals) are rewritten for the new
 * shape, with a note at each explaining why. Every other test -- the pure
 * bob/drift/alpha-noise/grow-in functions, and the animation-integration
 * tests that only ever inspect PUFF 0 OF THE ONLY SMOKED TILE (whose alpha
 * is still the tile-level value, computed exactly as before) -- is
 * unchanged, because the underlying computation is unchanged.
 *
 * Every assertion below that matters was verified by breaking the
 * corresponding line in `smoke-mesh.ts` by hand and confirming the SPECIFIC
 * test named goes red, then reverting -- this project's own standard.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { groundWorldY } from './ground-height';
import { hexToUnit } from './terrain/shared';
import { SOFT_PARTICLE_CORE } from './units/fx';
import { SMOKE_RENDER_ORDER, OVERLAY_RENDER_ORDER, FOG_RENDER_ORDER } from './units/render-order';
import {
  SMOKE_COLOR,
  SMOKE_ALPHA_CEIL,
  SMOKE_ALPHA_GAMMA,
  smokeDensityAlpha,
  writeSmokeInstances,
  SmokeMesh,
  type SmokeInstanceBuffers,
  SMOKE_PUFFS_PER_TILE,
  SMOKE_PUFF_RADIUS_MIN,
  SMOKE_PUFF_RADIUS_MAX,
  SMOKE_PUFF_OFFSET_MAX,
  SMOKE_PUFF_ELONGATION,
  SMOKE_PUFF_SPIN_MAX_RATE,
  SMOKE_TILE_CAPACITY,
  smokePuffQuadGeometry,
  writeSmokePuffPlacement,
  type SmokePuffPlacement,
  SMOKE_BOB_AMPLITUDE,
  SMOKE_DRIFT_AMPLITUDE,
  SMOKE_GROW_SCALE_OVERSHOOT,
  SMOKE_ALPHA_NOISE_MIN,
  SMOKE_ALPHA_NOISE_PERIOD_MS,
  SMOKE_GROW_DURATION_MS,
  SMOKE_GROW_ALPHA_FLOOR,
  smokeTilePhase,
  smokeBobOffset,
  smokeDriftX,
  smokeDriftZ,
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

function placement(): SmokePuffPlacement {
  return { offsetX: 0, offsetZ: 0, radius: 0, baseAngle: 0, spinRate: 0 };
}

describe('SMOKE_COLOR', () => {
  it('is gunmetal.0 exactly (#C3C7C4), not Pixi\'s own #C9CBC4 literal -- see smoke-mesh.ts\'s own top comment for why this moved onto the palette', () => {
    expect(SMOKE_COLOR).toBe('#C3C7C4');
  });
});

describe('smokeDensityAlpha', () => {
  it('hits the brief\'s two stated targets within the documented tolerance', () => {
    // Documented in smoke-mesh.ts's own top comment: 0.2977 and 0.7661.
    expect(smokeDensityAlpha(68)).toBeCloseTo(0.2977, 3);
    expect(smokeDensityAlpha(224)).toBeCloseTo(0.7661, 3);
  });

  it('is dramatically more visible than the old linear formula at low density -- the exact defect this curve fixes', () => {
    const oldLinear = (68 / 255) * 0.72; // Pixi's own formula, for comparison only
    expect(smokeDensityAlpha(68)).toBeGreaterThan(oldLinear * 1.5);
  });

  it('never exceeds SMOKE_ALPHA_CEIL, and the ceiling itself is strictly below 1 -- never so opaque a rifleman standing inside cannot be seen', () => {
    expect(SMOKE_ALPHA_CEIL).toBeLessThan(1);
    for (let d = 0; d <= 255; d += 5) {
      expect(smokeDensityAlpha(d)).toBeLessThanOrEqual(SMOKE_ALPHA_CEIL + 1e-9);
    }
    expect(smokeDensityAlpha(255)).toBeCloseTo(SMOKE_ALPHA_CEIL, 6);
  });

  it('is monotonically non-decreasing in d', () => {
    let prev = -Infinity;
    for (let d = 0; d <= 255; d++) {
      const a = smokeDensityAlpha(d);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
  });

  it('is 0 at d=0 and strictly positive for the faintest nonzero density', () => {
    expect(smokeDensityAlpha(0)).toBe(0);
    expect(smokeDensityAlpha(1)).toBeGreaterThan(0);
  });

  it('SMOKE_ALPHA_GAMMA is greater than 1 -- the "front-loaded" shape the fix actually depends on; at exactly 1 this degenerates to a rescaled LINEAR formula, the shape that under-served density 68 in the first place', () => {
    expect(SMOKE_ALPHA_GAMMA).toBeGreaterThan(1);
  });

  it('stays clear of units/collapse-shroud.ts\'s own COLLAPSE_SHROUD_DENSITY (0.82) -- see smoke-mesh.ts\'s own "Why 0.80, not 0.85" section', () => {
    expect(SMOKE_ALPHA_CEIL).toBeLessThan(0.82);
  });
});

describe('writeSmokeInstances', () => {
  it('a tile with smoke value 0 writes no instance at all', () => {
    const smoke = emptySmoke();
    smoke[5] = 0;
    const out = buffers(W * H);
    expect(writeSmokeInstances(smoke, W, H, null, out)).toBe(0);
  });

  it('a tile with any nonzero smoke value writes exactly one TILE instance (before per-puff expansion)', () => {
    const smoke = emptySmoke();
    smoke[5] = 1; // the faintest possible trace
    const out = buffers(W * H);
    expect(writeSmokeInstances(smoke, W, H, null, out)).toBe(1);
  });

  // Break check (verified by hand): change smokeDensityAlpha's formula in
  // writeSmokeInstances back to a bare linear one -- this test's two
  // distinct-alpha assertions fail to match the curve's own values.
  it('alpha is smokeDensityAlpha(d), not a bare linear formula', () => {
    const smoke = emptySmoke();
    smoke[0] = 255; // fully thick
    smoke[1] = 128; // roughly half
    const out = buffers(W * H);
    writeSmokeInstances(smoke, W, H, null, out);
    expect(out.alphas[0]).toBeCloseTo(smokeDensityAlpha(255), 6);
    expect(out.alphas[1]).toBeCloseTo(smokeDensityAlpha(128), 6);
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

// ---------------------------------------------------------------------------
// Puff placement (this task).
// ---------------------------------------------------------------------------

describe('writeSmokePuffPlacement', () => {
  it('is deterministic: the same (tileIndex, puffIndex) always yields the same five values', () => {
    const a = placement();
    const b = placement();
    writeSmokePuffPlacement(37, 1, a);
    writeSmokePuffPlacement(37, 1, b);
    expect(a).toEqual(b);
  });

  it('differs between the three puffs of the SAME tile -- otherwise they would stack rather than read as a cluster', () => {
    const p0 = placement();
    const p1 = placement();
    const p2 = placement();
    writeSmokePuffPlacement(12, 0, p0);
    writeSmokePuffPlacement(12, 1, p1);
    writeSmokePuffPlacement(12, 2, p2);
    const key = (p: SmokePuffPlacement): string => `${p.offsetX},${p.offsetZ},${p.radius},${p.baseAngle}`;
    const keys = new Set([key(p0), key(p1), key(p2)]);
    expect(keys.size).toBe(3);
  });

  it('differs between neighbouring tiles -- an uncorrelated hash, not a repeating stamp', () => {
    const seen = new Set<string>();
    for (let tileIndex = 0; tileIndex < 64; tileIndex++) {
      const p = placement();
      writeSmokePuffPlacement(tileIndex, 0, p);
      seen.add(`${p.offsetX.toFixed(6)},${p.offsetZ.toFixed(6)}`);
    }
    expect(seen.size).toBe(64);
  });

  it('offsetX/offsetZ stay within [-SMOKE_PUFF_OFFSET_MAX, SMOKE_PUFF_OFFSET_MAX] and radius within [SMOKE_PUFF_RADIUS_MIN, SMOKE_PUFF_RADIUS_MAX] for a large sample', () => {
    const p = placement();
    for (let tileIndex = 0; tileIndex < 2304; tileIndex += 7) {
      // every shipped map is 48x48 = 2304 tiles
      for (let puffIndex = 0; puffIndex < SMOKE_PUFFS_PER_TILE; puffIndex++) {
        writeSmokePuffPlacement(tileIndex, puffIndex, p);
        expect(Math.abs(p.offsetX)).toBeLessThanOrEqual(SMOKE_PUFF_OFFSET_MAX + 1e-9);
        expect(Math.abs(p.offsetZ)).toBeLessThanOrEqual(SMOKE_PUFF_OFFSET_MAX + 1e-9);
        expect(p.radius).toBeGreaterThanOrEqual(SMOKE_PUFF_RADIUS_MIN - 1e-9);
        expect(p.radius).toBeLessThanOrEqual(SMOKE_PUFF_RADIUS_MAX + 1e-9);
        expect(Math.abs(p.spinRate)).toBeLessThanOrEqual(SMOKE_PUFF_SPIN_MAX_RATE + 1e-12);
      }
    }
  });

  // The load-bearing inequality itself -- see smoke-mesh.ts's own top
  // comment, "Defect #1 (shape)", point 1.
  it('SMOKE_PUFF_RADIUS_MIN - SMOKE_PUFF_OFFSET_MAX clears a tile\'s own half-width (0.5) with a real margin', () => {
    expect(SMOKE_PUFF_RADIUS_MIN - SMOKE_PUFF_OFFSET_MAX).toBeGreaterThan(0.5);
  });

  it('the overlap/reach guarantee holds for every sampled puff: radius minus its own worst-case offset on EITHER axis still crosses the tile boundary (0.5)', () => {
    const p = placement();
    for (let tileIndex = 0; tileIndex < 2304; tileIndex += 11) {
      for (let puffIndex = 0; puffIndex < SMOKE_PUFFS_PER_TILE; puffIndex++) {
        writeSmokePuffPlacement(tileIndex, puffIndex, p);
        expect(p.radius - Math.abs(p.offsetX)).toBeGreaterThan(0.5);
        expect(p.radius - Math.abs(p.offsetZ)).toBeGreaterThan(0.5);
      }
    }
  });

  it('SMOKE_PUFF_ELONGATION is >= 1 -- the minor axis stays at exactly `radius`, so elongation only ever ADDS reach and cannot spend the guarantee above at any rotation angle', () => {
    expect(SMOKE_PUFF_ELONGATION).toBeGreaterThanOrEqual(1);
  });
});

describe('smokePuffQuadGeometry', () => {
  it('is a centred -1..1 quad on the ground plane (y=0), four vertices', () => {
    const geo = smokePuffQuadGeometry();
    expect(geo.positions.length).toBe(12);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(geo.positions[i * 3])).toBe(1);
      expect(geo.positions[i * 3 + 1]).toBe(0);
      expect(Math.abs(geo.positions[i * 3 + 2])).toBe(1);
    }
  });

  it('is deterministic and side-effect-free -- two calls give equal output', () => {
    const a = smokePuffQuadGeometry();
    const b = smokePuffQuadGeometry();
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });
});

describe('SmokeMesh construction', () => {
  it('starts with mesh.count 0 and grows to tileCount * SMOKE_PUFFS_PER_TILE puff instances on update', () => {
    const mesh = new SmokeMesh(W, H);
    expect(mesh.mesh.count).toBe(0);
    const smoke = emptySmoke();
    smoke[0] = 100;
    smoke[1] = 200;
    mesh.update(smoke, null, W, H);
    expect(mesh.mesh.count).toBe(2 * SMOKE_PUFFS_PER_TILE);
  });

  it('drops back to a smaller (still-a-multiple-of-SMOKE_PUFFS_PER_TILE) count as smoke lifts', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[0] = 100;
    smoke[1] = 100;
    mesh.update(smoke, null, W, H);
    expect(mesh.mesh.count).toBe(2 * SMOKE_PUFFS_PER_TILE);
    smoke[1] = 0; // lifted
    mesh.update(smoke, null, W, H);
    expect(mesh.mesh.count).toBe(1 * SMOKE_PUFFS_PER_TILE);
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

  it('the fragment shader\'s feather threshold is units/fx.ts\'s own SOFT_PARTICLE_CORE, reused rather than re-authored', () => {
    const mesh = new SmokeMesh(W, H);
    const material = mesh.mesh.material as THREE.ShaderMaterial;
    expect(material.fragmentShader).toContain(SOFT_PARTICLE_CORE.toFixed(2));
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

  it('reuses its own smokePuffQuadGeometry vertex layout, not fog-mesh.ts\'s corner-anchored one -- a puff needs to scale/rotate about its own centre, a fog quad does not', () => {
    const mesh = new SmokeMesh(W, H);
    const geo = smokePuffQuadGeometry();
    const posAttr = mesh.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(Array.from(posAttr.array)).toEqual(Array.from(geo.positions));
  });

  it('total instance capacity is tileCapacity * SMOKE_PUFFS_PER_TILE, where tileCapacity is min(SMOKE_TILE_CAPACITY, width*height)', () => {
    const bigMesh = new SmokeMesh(48, 48); // every shipped map's own size, 2304 tiles > SMOKE_TILE_CAPACITY
    const bigAttr = bigMesh.mesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    expect(bigAttr.count).toBe(SMOKE_TILE_CAPACITY * SMOKE_PUFFS_PER_TILE);

    const tinyMesh = new SmokeMesh(2, 2); // 4 tiles, well under SMOKE_TILE_CAPACITY
    const tinyAttr = tinyMesh.mesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    expect(tinyAttr.count).toBe(4 * SMOKE_PUFFS_PER_TILE);
  });

  // GH #144 (position/scale/rotation wiring, rewritten for per-puff
  // placement): proves SmokeMesh.update calls writeSmokePuffPlacement and
  // the documented animation functions with the tile's own (x, z) and the
  // given clockMs for puff 0 of a smoked tile -- not that those functions
  // are correct in isolation (each has its own dedicated tests above/below).
  it('composes puff 0\'s instance matrix from its own placement plus the documented animation offsets, not a bare tile translation', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[2 * W + 3] = 200; // tile (x=3, z=2), tileIndex = 2*4+3 = 11
    const CLOCK = 0; // first-ever update: this tile is also "born" at this clock
    mesh.update(smoke, null, W, H, CLOCK);
    const m = new THREE.Matrix4();
    mesh.mesh.getMatrixAt(0, m); // puff 0 of the only smoked tile
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);

    const tileIndex = 2 * W + 3;
    const p = placement();
    writeSmokePuffPlacement(tileIndex, 0, p);
    const phase = smokeTilePhase(3, 2);
    const ageMs = CLOCK - CLOCK; // birth frame
    const growScale = smokeGrowScaleFactor(ageMs);
    const expectedRadius = p.radius * growScale;

    expect(pos.x).toBeCloseTo(3 + p.offsetX + smokeDriftX(CLOCK), 6);
    expect(pos.y).toBeCloseTo(smokeBobOffset(CLOCK, phase), 6);
    expect(pos.z).toBeCloseTo(2 + p.offsetZ + smokeDriftZ(CLOCK), 6);
    expect(scale.z).toBeCloseTo(expectedRadius, 6); // minor axis: unelongated
    expect(scale.x).toBeCloseTo(expectedRadius * SMOKE_PUFF_ELONGATION, 6); // major axis: elongated
    // Rotation about world Y by exactly p.baseAngle at clockMs=0 (spinRate * 0 = 0).
    const expectedQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.baseAngle);
    expect(quat.x).toBeCloseTo(expectedQuat.x, 6);
    expect(quat.y).toBeCloseTo(expectedQuat.y, 6);
    expect(quat.z).toBeCloseTo(expectedQuat.z, 6);
    expect(quat.w).toBeCloseTo(expectedQuat.w, 6);
  });

  it('a tile\'s three puffs are drawn at three genuinely different world positions (not stacked)', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[5] = 180;
    mesh.update(smoke, null, W, H, 0);
    const positions: string[] = [];
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < SMOKE_PUFFS_PER_TILE; i++) {
      mesh.mesh.getMatrixAt(i, m);
      m.decompose(pos, quat, scale);
      positions.push(`${pos.x.toFixed(6)},${pos.z.toFixed(6)}`);
    }
    expect(new Set(positions).size).toBe(SMOKE_PUFFS_PER_TILE);
  });

  it('rotation genuinely advances with clockMs, at a per-puff-independent rate', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[5] = 180;
    const m = new THREE.Matrix4();
    const posA = new THREE.Vector3();
    const scaleA = new THREE.Vector3();
    const posB = new THREE.Vector3();
    const scaleB = new THREE.Vector3();

    // Some puffs roll very slowly (spinRate near 0 is a valid hash output),
    // so assert across all three puffs of the tile that AT LEAST one
    // genuinely rotated, rather than asserting it of puff 0 specifically.
    let anyRotated = false;
    for (let i = 0; i < SMOKE_PUFFS_PER_TILE; i++) {
      const qBefore = new THREE.Quaternion();
      mesh.update(smoke, null, W, H, 0);
      mesh.mesh.getMatrixAt(i, m);
      m.decompose(posA, qBefore, scaleA);
      const qAfter = new THREE.Quaternion();
      mesh.update(smoke, null, W, H, 20000);
      mesh.mesh.getMatrixAt(i, m);
      m.decompose(posB, qAfter, scaleB);
      if (Math.abs(qBefore.y - qAfter.y) > 1e-6 || Math.abs(qBefore.w - qAfter.w) > 1e-6) anyRotated = true;
    }
    expect(anyRotated).toBe(true);
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
// rest of this file relies on. Unchanged by this task.
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
    expect(phases.size).toBe(16);
  });

  it('is SPATIALLY SMOOTH -- adjacent tiles are close in phase, which is what stops a screen reading as a chequerboard', () => {
    const gap = (a: number, b: number): number => {
      const d = Math.abs(a - b) % (Math.PI * 2);
      return Math.min(d, Math.PI * 2 - d);
    };
    let worst = 0;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        worst = Math.max(worst, gap(smokeTilePhase(x, y), smokeTilePhase(x + 1, y)));
        worst = Math.max(worst, gap(smokeTilePhase(x, y), smokeTilePhase(x, y + 1)));
      }
    }
    expect(worst).toBeLessThan(0.8);
  });
});

describe('smokeBobOffset / smokeDriftX / smokeDriftZ -- bounded, deterministic motion', () => {
  const phase = smokeTilePhase(2, 7);

  it('smokeBobOffset never exceeds its documented amplitude', () => {
    for (let clockMs = 0; clockMs < 20000; clockMs += 137) {
      expect(Math.abs(smokeBobOffset(clockMs, phase))).toBeLessThanOrEqual(SMOKE_BOB_AMPLITUDE + 1e-9);
    }
  });

  it('smokeDriftX and smokeDriftZ never exceed their documented amplitude', () => {
    for (let clockMs = 0; clockMs < 20000; clockMs += 149) {
      expect(Math.abs(smokeDriftX(clockMs))).toBeLessThanOrEqual(SMOKE_DRIFT_AMPLITUDE + 1e-9);
      expect(Math.abs(smokeDriftZ(clockMs))).toBeLessThanOrEqual(SMOKE_DRIFT_AMPLITUDE + 1e-9);
    }
  });

  it('NOTHING varies the steady-state grow scale -- any scale but exactly 1 past the grow window would still be a size change on a shape that is otherwise stable', () => {
    for (let ageMs = SMOKE_GROW_DURATION_MS; ageMs < 20000; ageMs += 151) {
      expect(smokeGrowScaleFactor(ageMs), `settled scale must be exactly 1 at age ${ageMs}ms`).toBe(1);
    }
  });

  it('drift is COHERENT on the wire -- two far-apart puffs get the SAME drift offset, because wind is one bearing and not per-tile jitter', () => {
    const mesh = new SmokeMesh(24, 24);
    const smoke = new Uint8Array(24 * 24);
    smoke[3 * 24 + 2] = 200; // tile (2, 3)
    smoke[19 * 24 + 21] = 200; // tile (21, 19), far away
    mesh.update(smoke, null, 24, 24, 4321);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    // Puff 0 of each of the two smoked tiles -- tiles are visited in
    // row-major scan order by writeSmokeInstances, so tile (2,3)'s puffs
    // come first.
    mesh.mesh.getMatrixAt(0, m);
    m.decompose(pos, quat, scale);
    const p0 = placement();
    writeSmokePuffPlacement(3 * 24 + 2, 0, p0);
    const firstOffset = [pos.x - 2 - p0.offsetX, pos.z - 3 - p0.offsetZ];

    mesh.mesh.getMatrixAt(SMOKE_PUFFS_PER_TILE, m);
    m.decompose(pos, quat, scale);
    const p1 = placement();
    writeSmokePuffPlacement(19 * 24 + 21, 0, p1);
    const secondOffset = [pos.x - 21 - p1.offsetX, pos.z - 19 - p1.offsetZ];

    // 5, not 6: these coordinates run up to 21 and pass through a
    // THREE.Matrix4 (internally Float32Array) round-trip via
    // decompose() -- float32's ~7 significant digits cost about 1e-6 of
    // absolute precision at this magnitude, which is not a logic error.
    expect(firstOffset[0]).toBeCloseTo(secondOffset[0], 5);
    expect(firstOffset[1]).toBeCloseTo(secondOffset[1], 5);
    expect(Math.abs(firstOffset[0]) + Math.abs(firstOffset[1])).toBeGreaterThan(1e-6);
  });

  it('every function above is deterministic -- same (clockMs, phase) in, same value out', () => {
    expect(smokeBobOffset(1234, phase)).toBe(smokeBobOffset(1234, phase));
    expect(smokeDriftX(1234)).toBe(smokeDriftX(1234));
    expect(smokeDriftZ(1234)).toBe(smokeDriftZ(1234));
  });

  it('is genuinely time-varying -- not a constant masquerading as motion', () => {
    expect(smokeBobOffset(0, phase)).not.toBeCloseTo(smokeBobOffset(900, phase), 4);
  });
});

describe('smokeAlphaNoise', () => {
  it('is the ONLY per-tile billow channel now, so its swing has to be real', () => {
    expect(SMOKE_ALPHA_NOISE_MIN).toBeLessThan(0.9);
    expect(SMOKE_ALPHA_NOISE_MIN).toBeGreaterThan(0.5);
  });

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
    for (let clockMs = 0; clockMs < SMOKE_ALPHA_NOISE_PERIOD_MS * 2; clockMs += 5) {
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

  it('smokeGrowScaleFactor OVERSHOOTS and settles down to exactly 1 -- never below it', () => {
    expect(smokeGrowScaleFactor(0)).toBeCloseTo(SMOKE_GROW_SCALE_OVERSHOOT, 6);
    expect(smokeGrowScaleFactor(SMOKE_GROW_DURATION_MS)).toBeCloseTo(1, 6);
    expect(SMOKE_GROW_SCALE_OVERSHOOT).toBeGreaterThan(1);
    let prev = Infinity;
    for (let age = 0; age <= SMOKE_GROW_DURATION_MS; age += 10) {
      const v = smokeGrowScaleFactor(age);
      expect(v, `grow scale rose again at age ${age}`).toBeLessThanOrEqual(prev + 1e-9);
      expect(v, `grow scale dipped under 1 at age ${age}`).toBeGreaterThanOrEqual(1 - 1e-9);
      prev = v;
    }
  });

  it('a negative age (should not occur, but growStart could equal clockMs on the exact birth frame) clamps to the floor rather than going out of range', () => {
    expect(smokeGrowAlphaFactor(-50)).toBeCloseTo(SMOKE_GROW_ALPHA_FLOOR, 6);
    expect(smokeGrowScaleFactor(-50)).toBeCloseTo(SMOKE_GROW_SCALE_OVERSHOOT, 6);
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

describe('SmokeMesh animation integration (GH #144) -- exercised through puff 0 of the only smoked tile, whose alpha is still the tile-level value', () => {
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

  it('never renders a smoked tile\'s puffs fully transparent, even at the exact birth frame (worst case: grow floor and alpha-noise floor both apply)', () => {
    const mesh = new SmokeMesh(W, H);
    const smoke = emptySmoke();
    smoke[0] = 1; // the faintest possible nonzero density
    for (let clockMs = 0; clockMs < 6000; clockMs += 17) {
      mesh.update(smoke, null, W, H, clockMs);
      for (let p = 0; p < SMOKE_PUFFS_PER_TILE; p++) {
        expect(alphaAt(mesh, p)).toBeGreaterThan(0);
      }
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
