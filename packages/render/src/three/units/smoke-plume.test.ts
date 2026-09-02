import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildSmokePlumeTemplate,
  SmokePlumeManager,
  SMOKE_PLUME_CAPACITY,
  SMOKE_PLUME_BASE_SCALE,
  SMOKE_PLUME_DEFAULT_DURATION_MS,
  SMOKE_PLUME_RISE_FRACTION,
  SMOKE_PLUME_FADE_FRACTION,
  SMOKE_PLUME_FOOTPRINT_MIN,
  SMOKE_PLUME_SPREAD_MAX,
  SMOKE_PLUME_CLIMB,
  SMOKE_PLUME_LEAN_TILES,
  SMOKE_PLUME_LEAN_DIR,
  SMOKE_PLUME_ZONE_LEAN,
  SMOKE_PLUME_YAW_DRIFT_TURNS,
  SMOKE_PLUME_DENSITY,
  SMOKE_PLUME_EDGE_SOFTNESS,
  SMOKE_PLUME_TOP_DENSITY,
  createSmokePlumeMaterial,
  smokePlumeMeshHeight,
  smokePlumeRiseEnvelope,
  smokePlumeOpacity,
  smokePlumeSpread,
  smokePlumeLeanTiles,
  smokePlumeYawTurns,
  smokePlumeZoneOffset,
} from './smoke-plume';
import { SMOKE_ALPHA_MAX } from '../smoke-mesh';

describe('smokePlumeRiseEnvelope', () => {
  it('starts at 0 and ramps linearly to 1 over the rise fraction', () => {
    expect(smokePlumeRiseEnvelope(0)).toBe(0);
    expect(smokePlumeRiseEnvelope(SMOKE_PLUME_RISE_FRACTION / 2)).toBeCloseTo(0.5, 10);
    expect(smokePlumeRiseEnvelope(SMOKE_PLUME_RISE_FRACTION)).toBeCloseTo(1, 10);
  });

  it('keeps climbing after the rise, to 1 + SMOKE_PLUME_CLIMB at the end of life', () => {
    expect(smokePlumeRiseEnvelope(1)).toBeCloseTo(1 + SMOKE_PLUME_CLIMB, 10);
    const mid = SMOKE_PLUME_RISE_FRACTION + (1 - SMOKE_PLUME_RISE_FRACTION) / 2;
    expect(smokePlumeRiseEnvelope(mid)).toBeCloseTo(1 + SMOKE_PLUME_CLIMB / 2, 10);
  });

  it('NEVER shrinks -- a plume that leaves by getting shorter is one being pulled back into the ground', () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const v = smokePlumeRiseEnvelope(p);
      expect(v, `height went down at progress ${p.toFixed(3)}`).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it('clamps progress outside [0, 1] rather than reading past either end', () => {
    expect(smokePlumeRiseEnvelope(-1)).toBe(0);
    expect(smokePlumeRiseEnvelope(2)).toBeCloseTo(1 + SMOKE_PLUME_CLIMB, 10);
  });
});

describe('smokePlumeOpacity', () => {
  it('fades in across the same window the height rise uses, so nothing is stamped on at full density', () => {
    expect(smokePlumeOpacity(0)).toBe(0);
    expect(smokePlumeOpacity(SMOKE_PLUME_RISE_FRACTION / 2)).toBeCloseTo(0.5, 10);
    expect(smokePlumeOpacity(SMOKE_PLUME_RISE_FRACTION)).toBeCloseTo(1, 10);
  });

  it('holds at 1 through the persist phase', () => {
    const mid = SMOKE_PLUME_RISE_FRACTION + (1 - SMOKE_PLUME_RISE_FRACTION - SMOKE_PLUME_FADE_FRACTION) / 2;
    expect(smokePlumeOpacity(mid)).toBe(1);
    expect(smokePlumeOpacity(1 - SMOKE_PLUME_FADE_FRACTION)).toBe(1);
  });

  it('dissolves to exactly 0 at the end of life -- this, not the height, is how a plume leaves', () => {
    expect(smokePlumeOpacity(1)).toBeCloseTo(0, 10);
    const fadeStart = 1 - SMOKE_PLUME_FADE_FRACTION;
    expect(smokePlumeOpacity(fadeStart + SMOKE_PLUME_FADE_FRACTION / 2)).toBeCloseTo(0.5, 10);
  });

  it('is monotonically non-increasing once the fade has begun', () => {
    let prev = Infinity;
    for (let p = 1 - SMOKE_PLUME_FADE_FRACTION; p <= 1.0001; p += 0.005) {
      const v = smokePlumeOpacity(p);
      expect(v, `opacity rose again at progress ${p.toFixed(3)}`).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });

  it('the fade phase is longer than the rise phase -- billows up fast, thins slowly', () => {
    expect(SMOKE_PLUME_FADE_FRACTION).toBeGreaterThan(SMOKE_PLUME_RISE_FRACTION);
  });

  it('clamps progress outside [0, 1] rather than reading past either end', () => {
    expect(smokePlumeOpacity(-1)).toBe(0);
    expect(smokePlumeOpacity(2)).toBeCloseTo(0, 10);
  });
});

describe('smokePlumeSpread', () => {
  it('never collapses fully to zero, unlike the height envelope', () => {
    expect(smokePlumeSpread(0)).toBeCloseTo(SMOKE_PLUME_FOOTPRINT_MIN, 10);
  });

  it('ends WIDER than it started, and wider than nominal -- smoke disperses, it does not re-narrow', () => {
    expect(smokePlumeSpread(1)).toBeCloseTo(SMOKE_PLUME_SPREAD_MAX, 10);
    expect(SMOKE_PLUME_SPREAD_MAX).toBeGreaterThan(1);
  });

  it('is monotonically increasing across the WHOLE life, the fade included', () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const v = smokePlumeSpread(p);
      expect(v, `footprint narrowed at progress ${p.toFixed(3)}`).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('smokePlumeLeanTiles / SMOKE_PLUME_ZONE_LEAN / SMOKE_PLUME_LEAN_DIR', () => {
  it('starts planted and drifts to SMOKE_PLUME_LEAN_TILES by the end of life', () => {
    expect(smokePlumeLeanTiles(0)).toBe(0);
    expect(smokePlumeLeanTiles(1)).toBeCloseTo(SMOKE_PLUME_LEAN_TILES, 10);
    expect(smokePlumeLeanTiles(0.5)).toBeCloseTo(SMOKE_PLUME_LEAN_TILES / 2, 10);
  });

  it('clamps outside [0, 1]', () => {
    expect(smokePlumeLeanTiles(-3)).toBe(0);
    expect(smokePlumeLeanTiles(9)).toBeCloseTo(SMOKE_PLUME_LEAN_TILES, 10);
  });

  it('pins the base at zero so the column shears instead of sliding off the wreck', () => {
    expect(SMOKE_PLUME_ZONE_LEAN.base).toBe(0);
  });

  it('leans progressively more the higher the zone', () => {
    expect(SMOKE_PLUME_ZONE_LEAN.mid).toBeGreaterThan(SMOKE_PLUME_ZONE_LEAN.base);
    expect(SMOKE_PLUME_ZONE_LEAN.top).toBeGreaterThan(SMOKE_PLUME_ZONE_LEAN.mid);
    expect(SMOKE_PLUME_ZONE_LEAN.top).toBe(1);
  });

  it('drifts along the SAME bearing groveMaterial leans every tree, (+x, -z), and is a unit vector', () => {
    expect(SMOKE_PLUME_LEAN_DIR[0]).toBeGreaterThan(0);
    expect(SMOKE_PLUME_LEAN_DIR[1]).toBeLessThan(0);
    const len = Math.hypot(SMOKE_PLUME_LEAN_DIR[0], SMOKE_PLUME_LEAN_DIR[1]);
    expect(len).toBeCloseTo(1, 10);
  });
});

describe('smokePlumeYawTurns', () => {
  it('starts at the spawn seed exactly -- the drift is added, not substituted', () => {
    expect(smokePlumeYawTurns(0.37, 0)).toBeCloseTo(0.37, 10);
  });

  it('turns by SMOKE_PLUME_YAW_DRIFT_TURNS across a full life', () => {
    expect(smokePlumeYawTurns(0.37, 1) - smokePlumeYawTurns(0.37, 0)).toBeCloseTo(
      SMOKE_PLUME_YAW_DRIFT_TURNS,
      10
    );
  });

  it('two plumes with different seeds keep their offset -- the drift is shared, the pose is not', () => {
    expect(smokePlumeYawTurns(0.1, 0.5) - smokePlumeYawTurns(0.6, 0.5)).toBeCloseTo(-0.5, 10);
  });
});

describe('createSmokePlumeMaterial -- the opaque-cutout fix', () => {
  it('is transparent and writes no depth', () => {
    const m = createSmokePlumeMaterial();
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(false);
    m.dispose();
  });

  it('never pins alpha to 1.0 the way createVfxMeshMaterial does -- that IS the defect', () => {
    const m = createSmokePlumeMaterial();
    expect(m.fragmentShader).not.toMatch(/vec4\(\s*uColor\s*,\s*1\.0\s*\)/);
    expect(m.fragmentShader).toContain('vOpacity');
    m.dispose();
  });

  it('carries the three independent alpha channels the doc comment names', () => {
    const m = createSmokePlumeMaterial();
    // silhouette fade, dispersal fade, life fade
    expect(m.fragmentShader).toContain('vFacing');
    expect(m.fragmentShader).toContain('vHeight');
    expect(m.fragmentShader).toContain('vOpacity');
    m.dispose();
  });

  it('stays under the sim smoke screen\'s own density -- a dispersing plume is thinner than a laid screen', () => {
    expect(SMOKE_PLUME_DENSITY).toBeGreaterThan(0);
    expect(SMOKE_PLUME_DENSITY).toBeLessThan(SMOKE_ALPHA_MAX);
  });

  it('thins toward the top rather than holding one density up the whole column', () => {
    expect(SMOKE_PLUME_TOP_DENSITY).toBeGreaterThan(0);
    expect(SMOKE_PLUME_TOP_DENSITY).toBeLessThan(1);
  });

  it('fades a broad grazing band, not a thin fringe', () => {
    expect(SMOKE_PLUME_EDGE_SOFTNESS).toBeGreaterThan(0.3);
    expect(SMOKE_PLUME_EDGE_SOFTNESS).toBeLessThanOrEqual(1);
  });

  it('corrects the instance normal for the non-uniform scale step() composes', () => {
    const m = createSmokePlumeMaterial();
    // `normal / (s*s)` -- see the doc comment's own derivation. Without it
    // the silhouette fade lands where the surface does not face.
    expect(m.vertexShader).toContain('normal / max(s * s');
    m.dispose();
  });

  it('starts with a placeholder uHeight that load() is expected to replace', () => {
    const m = createSmokePlumeMaterial();
    expect(m.uniforms.uHeight.value).toBe(1);
    m.dispose();
  });

  it('this module no longer reaches for the forced-opaque VFX recipe at all', () => {
    // The regression this pins is not "the constant changed", it is
    // "somebody reinstated createVfxMeshMaterial here because every other
    // VFX mesh uses it". That recipe writes vec4(uColor, 1.0); smoke drawn
    // through it is a cardboard cutout stamped over the building. Source
    // text, deliberately -- the alternative is exposing the manager's
    // private materials purely so a test can look at them. The IMPORT is
    // what is asserted, not the identifier: the doc comments above name
    // that recipe repeatedly, on purpose, and a module cannot use it
    // without importing it.
    const src = readFileSync(new URL('./smoke-plume.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\/vfx-mesh-material'/);
  });
});

describe('smokePlumeZoneOffset -- the stepped shear', () => {
  it('leaves every zone exactly on the anchor at birth', () => {
    for (const role of ['base', 'mid', 'top'] as const) {
      const [dx, dz] = smokePlumeZoneOffset(role, 0);
      expect(Math.abs(dx)).toBe(0);
      expect(Math.abs(dz)).toBe(0);
    }
  });

  it('never moves the base, at any age -- it sits on the rubble', () => {
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const [dx, dz] = smokePlumeZoneOffset('base', p);
      expect(Math.abs(dx)).toBe(0);
      expect(Math.abs(dz)).toBe(0);
    }
  });

  it('displaces the top by the full lean distance along the wind bearing at end of life', () => {
    const [dx, dz] = smokePlumeZoneOffset('top', 1);
    expect(Math.hypot(dx, dz)).toBeCloseTo(SMOKE_PLUME_LEAN_TILES, 10);
    expect(dx).toBeGreaterThan(0);
    expect(dz).toBeLessThan(0);
  });

  it('displaces mid less than top, so the column shears rather than translating', () => {
    const mid = Math.hypot(...smokePlumeZoneOffset('mid', 1));
    const top = Math.hypot(...smokePlumeZoneOffset('top', 1));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(top);
  });
});

describe('smokePlumeMeshHeight', () => {
  function slab(minY: number, maxY: number): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(Float32Array.from([0, minY, 0, 1, minY, 0, 0, maxY, 0]), 3)
    );
    return g;
  }

  it('reports the tallest local Y any zone reaches, across all three', () => {
    const h = smokePlumeMeshHeight({ base: slab(0, 0.63), mid: slab(0.6, 1.28), top: slab(1.25, 1.906) });
    expect(h).toBeCloseTo(1.906, 5);
  });

  it('falls back to 1 rather than 0 for degenerate geometry -- uHeight divides', () => {
    expect(smokePlumeMeshHeight({ base: slab(0, 0), mid: slab(0, 0), top: slab(0, 0) })).toBe(1);
  });
});

describe('SMOKE_PLUME_BASE_SCALE / SMOKE_PLUME_DEFAULT_DURATION_MS', () => {
  it('are positive, finite judgment-call constants (see this file\'s own top comment for the arithmetic)', () => {
    expect(SMOKE_PLUME_BASE_SCALE).toBeGreaterThan(0);
    expect(Number.isFinite(SMOKE_PLUME_BASE_SCALE)).toBe(true);
    expect(SMOKE_PLUME_DEFAULT_DURATION_MS).toBeGreaterThan(0);
  });

  it('reads over SECONDS, not the burst\'s sub-second lifetime', () => {
    // The whole point of this asset per its own brief: "a plume reads over
    // seconds." 1000ms is a generous floor -- the actual constant is 4000.
    expect(SMOKE_PLUME_DEFAULT_DURATION_MS).toBeGreaterThan(1000);
  });
});

describe('buildSmokePlumeTemplate', () => {
  it('extracts all three stacked-slab zones by role', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'base', extrasRole: 'base' },
        { nodeName: 'mid', extrasRole: 'mid' },
        { nodeName: 'top', extrasRole: 'top' },
      ],
    });
    const template = buildSmokePlumeTemplate(gltf);
    expect(Object.keys(template.geometries).sort()).toEqual(['base', 'mid', 'top']);
  });

  it('falls back to the node name when extras.rl_role is absent', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'base', extrasRole: null },
        { nodeName: 'mid', extrasRole: null },
        { nodeName: 'top', extrasRole: null },
      ],
    });
    const template = buildSmokePlumeTemplate(gltf);
    expect(Object.keys(template.geometries).sort()).toEqual(['base', 'mid', 'top']);
  });

  it('throws loudly for a role outside the closed vocabulary', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull', extrasRole: 'hull' }],
    });
    expect(() => buildSmokePlumeTemplate(gltf)).toThrow(/no role for mesh/);
  });

  it('throws loudly for the OTHER vfx-mesh vocabulary (core/mid/outer is not this class\'s)', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'core', extrasRole: 'core' }],
    });
    expect(() => buildSmokePlumeTemplate(gltf)).toThrow(/no role for mesh/);
  });

  it('throws loudly when a zone is missing entirely, never drawing an incomplete plume', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'base', extrasRole: 'base' },
        { nodeName: 'mid', extrasRole: 'mid' },
      ],
    });
    expect(() => buildSmokePlumeTemplate(gltf)).toThrow(/missing the "top" zone/);
  });
});

describe('SmokePlumeManager', () => {
  it('is not ready until load() resolves', () => {
    const mgr = new SmokePlumeManager();
    expect(mgr.ready).toBe(false);
    mgr.dispose();
  });

  it('spawn() with zero/negative duration is a no-op', () => {
    const mgr = new SmokePlumeManager();
    mgr.spawn(0, 0, 0, 0, 1, 0);
    mgr.spawn(0, 0, 0, 0, 1, -10);
    expect(mgr.liveCount).toBe(0);
    mgr.dispose();
  });

  it('ages a spawned plume to retirement over its own declared duration', () => {
    const mgr = new SmokePlumeManager();
    mgr.spawn(1, 2, 3, 0, 1, 4000);
    expect(mgr.liveCount).toBe(1);
    mgr.step(3000);
    expect(mgr.liveCount).toBe(1);
    mgr.step(1500); // 4500ms total, past the 4000ms duration
    expect(mgr.liveCount).toBe(0);
    mgr.dispose();
  });

  it('never exceeds its own bounded capacity, evicting the oldest first', () => {
    const mgr = new SmokePlumeManager(4);
    for (let i = 0; i < 10; i++) mgr.spawn(i, 0, 0, 0, 1, 5000);
    expect(mgr.liveCount).toBe(4);
    mgr.dispose();
  });

  it('defaults to SMOKE_PLUME_CAPACITY when built with no explicit ceiling', () => {
    const mgr = new SmokePlumeManager();
    for (let i = 0; i < SMOKE_PLUME_CAPACITY + 5; i++) mgr.spawn(i, 0, 0, 0, 1, 5000);
    expect(mgr.liveCount).toBe(SMOKE_PLUME_CAPACITY);
    mgr.dispose();
  });

  it('step() is total over an empty pool and over an unloaded (meshes still null) one', () => {
    const mgr = new SmokePlumeManager();
    expect(() => mgr.step(16)).not.toThrow();
    mgr.spawn(0, 0, 0, 0, 1, 4000);
    expect(() => mgr.step(16)).not.toThrow();
    mgr.dispose();
  });

  it('setColors is safe to call before any GLB has loaded', () => {
    const mgr = new SmokePlumeManager();
    expect(() => mgr.setColors((key) => (key === 'gunmetal.3' ? '#363B39' : '#8E9491'))).not.toThrow();
    mgr.dispose();
  });

  it('dispose() on a manager that never loaded does not throw', () => {
    const mgr = new SmokePlumeManager();
    expect(() => mgr.dispose()).not.toThrow();
  });
});
