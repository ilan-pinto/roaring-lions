/**
 * Task B4.2. Runs under plain `environment: 'node'` (`vitest.config.ts`) --
 * `fogQuadGeometry`/`writeFogInstances` touch no `THREE.*` at all;
 * `FogMesh`'s construction and `.update()` build real three.js JS-side
 * objects, which `environment: 'node'` already supports with no
 * `WebGLRenderer` (see `units/fx.test.ts`'s own top comment for the
 * precedent this follows).
 *
 * Per this project's own standard (twenty-three tests found, across three
 * phases, that passed while checking nothing -- every one caught by breaking
 * the thing rather than reading it): every assertion below that matters was
 * verified by breaking the corresponding line in `fog-mesh.ts` by hand and
 * confirming the SPECIFIC test named goes red, then reverting. Reported in
 * `task-B4.2-report.md`.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { groundWorldY } from './ground-height';
import { hexToUnit } from './terrain/shared';
import { FOG_RENDER_ORDER, FX_RENDER_ORDER_ABOVE } from './units/render-order';
import {
  FOG_COLOR,
  FOG_ALPHA_NEVER_SEEN,
  FOG_ALPHA_EXPLORED,
  fogQuadGeometry,
  writeFogInstances,
  FogMesh,
  type FogInstanceBuffers,
} from './fog-mesh';

const W = 4;
const H = 4;

/** Every tile at fog level 0 (never seen) -- the genuine boot state, and the
 *  fixture the capacity/full-map tests deliberately want. */
function emptyFog(): Uint8Array {
  return new Uint8Array(W * H);
}

/** Every tile at fog level 2 (in sight, no overlay) -- the fixture tests that
 *  care about exactly ONE or TWO specific tiles start from, so the rest of
 *  the map does not also contribute an instance and hide a wrong count or a
 *  wrong index behind a sea of default-zero (never-seen) tiles. */
function visibleFog(): Uint8Array {
  return new Uint8Array(W * H).fill(2);
}

function buffers(capacity: number): FogInstanceBuffers {
  return {
    positions: new Float32Array(capacity * 3),
    alphas: new Float32Array(capacity),
  };
}

describe('FOG_COLOR', () => {
  it('matches Pixi\'s own drawFog literal (renderer.ts:1186), #0A0A08', () => {
    expect(FOG_COLOR).toBe('#0A0A08');
  });
});

describe('fogQuadGeometry', () => {
  it('is a unit tile footprint, four verts at (0,0)-(1,1) on the ground plane, six indices', () => {
    const geo = fogQuadGeometry();
    expect(geo.positions).toHaveLength(12);
    // p0=(0,0,0), p1=(1,0,0), p2=(1,0,1), p3=(0,0,1) -- ground.ts's own
    // tile-top corner order, local y = 0 throughout (translated per
    // instance, never baked here).
    expect(Array.from(geo.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
    expect(geo.indices).toEqual(Uint32Array.from([0, 2, 1, 0, 3, 2]));
  });
});

describe('writeFogInstances', () => {
  // Break 2 (brief item 2): change `v === 0 ? FOG_ALPHA_NEVER_SEEN :
  // FOG_ALPHA_EXPLORED` to a constant (e.g. always FOG_ALPHA_EXPLORED).
  // Verified by hand: with that change, this test's second `expect(...)`
  // fails -- both tiles report the SAME alpha. This is the test that catches
  // break 2.
  it('never-seen (0) and explored (1) tiles get different alphas', () => {
    const fog = visibleFog();
    fog[0 * W + 0] = 0; // never seen
    fog[0 * W + 1] = 1; // explored, not currently observed
    const out = buffers(W * H);
    writeFogInstances(fog, W, H, null, out);
    // Never-seen is written first (row-major scan, tile (0,0) before (1,0)).
    expect(out.alphas[0]).toBeCloseTo(FOG_ALPHA_NEVER_SEEN, 6);
    expect(out.alphas[1]).toBeCloseTo(FOG_ALPHA_EXPLORED, 6);
    expect(out.alphas[0]).not.toBeCloseTo(out.alphas[1], 6);
    expect(FOG_ALPHA_NEVER_SEEN).not.toBe(FOG_ALPHA_EXPLORED);
  });

  it('a tile currently in sight (2) writes no instance at all', () => {
    const fog = visibleFog();
    fog[6] = 0;
    const out = buffers(W * H);
    const count = writeFogInstances(fog, W, H, null, out);
    // Only the level-0 tile is written -- the level-2 tile contributes
    // nothing, not a hidden/zero-alpha instance.
    expect(count).toBe(1);
  });

  it('on flat ground (no elevation layer), every instance sits at world Y 0', () => {
    const fog = visibleFog();
    fog[0] = 0;
    const out = buffers(W * H);
    writeFogInstances(fog, W, H, null, out);
    expect(out.positions[1]).toBe(0);
  });

  // Break 1 (brief item 1): replace `groundWorldY(elevation, width, height,
  // x, y)` with a flat `0` in writeFogInstances. Verified by hand: with that
  // change, this test's `toBeCloseTo(groundWorldY(...), 5)` assertion fails
  // -- the raised tile's fog quad reports Y 0 instead of its own terrace
  // height. This is the test that catches break 1 (Tel Marum's own failure
  // mode: fog silently buried inside raised terrain, invisible everywhere
  // elevation >= 1).
  it('on raised ground, the fog quad follows the tile\'s OWN elevation, not world Y 0', () => {
    // 4x4 grid, level 3 at tile (1, 1), flat everywhere else -- the same
    // fixture units/fx.test.ts's own ground-lift suite uses.
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const fog = visibleFog();
    fog[1 * W + 1] = 0; // the raised tile, never seen
    const out = buffers(W * H);
    writeFogInstances(fog, W, H, elevation, out);
    expect(out.positions[1]).toBeGreaterThan(0);
    // Cross-checked against the exact function units/particles use for the
    // same job, not merely against a hand-derived number.
    expect(out.positions[1]).toBeCloseTo(groundWorldY(elevation, W, H, 1, 1), 5);
  });

  it('positions x/z at the tile\'s own integer coordinates (the quad\'s own corner, matching ground.ts)', () => {
    const fog = visibleFog();
    fog[2 * W + 3] = 1; // tile (x=3, y=2)
    const out = buffers(W * H);
    writeFogInstances(fog, W, H, null, out);
    expect(out.positions[0]).toBe(3);
    expect(out.positions[2]).toBe(2);
  });

  it('stops at the output buffer\'s own capacity rather than overrunning it', () => {
    const fog = emptyFog(); // every tile level 0 -- W*H = 16 candidates
    const out = buffers(4);
    const count = writeFogInstances(fog, W, H, null, out);
    expect(count).toBe(4);
  });

  it('a fully-visible map (every tile level 2) writes zero instances', () => {
    const fog = visibleFog();
    const out = buffers(W * H);
    expect(writeFogInstances(fog, W, H, null, out)).toBe(0);
  });

  it('a fully-unseen map (boot state, every tile level 0) writes one instance per tile', () => {
    const fog = emptyFog(); // already all-zero
    const out = buffers(W * H);
    expect(writeFogInstances(fog, W, H, null, out)).toBe(W * H);
  });
});

describe('FogMesh construction', () => {
  it('starts with mesh.count 0 and grows to the written instance count on update', () => {
    const mesh = new FogMesh(W, H);
    expect(mesh.mesh.count).toBe(0);
    const fog = visibleFog();
    fog[0] = 0;
    fog[1] = 1;
    mesh.update(fog, null, W, H);
    expect(mesh.mesh.count).toBe(2);
  });

  it('drops back to a smaller count as tiles are revealed (in-sight tiles stop drawing)', () => {
    const mesh = new FogMesh(W, H);
    const fog = emptyFog(); // all never-seen
    mesh.update(fog, null, W, H);
    expect(mesh.mesh.count).toBe(W * H);
    fog[0] = 2; // one tile now in sight
    mesh.update(fog, null, W, H);
    expect(mesh.mesh.count).toBe(W * H - 1);
  });

  // Break 3 (brief item 3, the material half): change `depthTest: false` to
  // `true` in createFogMaterial. Verified by hand: with that change, this
  // test's `expect(m.depthTest).toBe(false)` fails. This is the test that
  // catches the material half of break 3 -- see fx.test.ts's extended
  // cross-module invariant for the renderOrder half (a fog quad sitting flat
  // on the ground needs BOTH depthTest:false and a renderOrder above every
  // unit to actually cover a unit standing on that tile; either alone is not
  // sufficient, so both are asserted, in the file that can reach every band).
  it('the material is transparent, depth-tested false, depth-written false -- an unconditional overlay', () => {
    const mesh = new FogMesh(W, H);
    const m = mesh.mesh.material as THREE.Material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
  });

  // Final whole-branch review (Fix 3a): FOG_COLOR's own describe block above
  // asserts the exported STRING, but nothing asserted the `uColor` uniform
  // the shader actually reads -- the B4.2 reviewer proved the gap by
  // swapping `hexToUnit(FOG_COLOR)` for `hexToUnit('#FFFFFF')` inside
  // `createFogMaterial` and finding every test still green. Fog's colour is
  // a palette-exactness claim this whole migration rests on
  // (`fog-mesh.ts`'s own top comment, "Ruling 1, restated for this file"),
  // and it was unguarded end to end until this assertion. Verified by hand:
  // making that exact swap fails this test's `uColor` assertions while
  // leaving `FOG_COLOR`'s own string test (above) green, then reverted.
  it('the uColor uniform holds exactly hexToUnit(FOG_COLOR), component-wise -- the value the shader actually reads', () => {
    const mesh = new FogMesh(W, H);
    const material = mesh.mesh.material as THREE.ShaderMaterial;
    const uColor = material.uniforms.uColor.value as THREE.Vector3;
    const [r, g, b] = hexToUnit(FOG_COLOR);
    expect(uColor.x).toBeCloseTo(r, 6);
    expect(uColor.y).toBeCloseTo(g, 6);
    expect(uColor.z).toBeCloseTo(b, 6);
  });

  it('draws in the FOG band, above the above-tier FX band', () => {
    const mesh = new FogMesh(W, H);
    expect(mesh.mesh.renderOrder).toBe(FOG_RENDER_ORDER);
    expect(FOG_RENDER_ORDER).toBeGreaterThan(FX_RENDER_ORDER_ABOVE);
  });

  it('mesh is exempt from frustum culling, matching every other whole-map mesh in this backend', () => {
    const mesh = new FogMesh(W, H);
    expect(mesh.mesh.frustumCulled).toBe(false);
  });

  it('writes correct per-instance position into the instance matrix, not merely the right count', () => {
    const mesh = new FogMesh(W, H);
    const fog = visibleFog();
    fog[2 * W + 3] = 0; // tile (3, 2)
    mesh.update(fog, null, W, H);
    const m = new THREE.Matrix4();
    mesh.mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(3, 5);
    expect(pos.y).toBeCloseTo(0, 5);
    expect(pos.z).toBeCloseTo(2, 5);
    // NOTE: this used to also assert `expect(scale.x).toBeCloseTo(1, 5)`.
    // Final whole-branch review (Fix 3b): that assertion can never fail --
    // `Matrix4.makeTranslation` (what `FogMesh.update` builds this matrix
    // with) always yields unit scale, so the assertion tested a property of
    // three.js's own `makeTranslation`, not of any code in this file. Removed
    // rather than kept as dead weight; the test below replaces it with real,
    // previously-missing coverage instead (fog quads lifting with terrain,
    // through this exact instance-matrix path).
  });

  // Final whole-branch review (Fix 3b): `writeFogInstances`'s own elevation
  // test above ("on raised ground, the fog quad follows...") proves the PURE
  // half -- the position `writeFogInstances` computes. It never proved the
  // other half: that `FogMesh.update` actually carries that Y into the
  // `InstancedMesh`'s own instance matrix, the thing three.js draws from.
  // Verified by hand: replacing `writeFogInstances`'s
  // `groundWorldY(elevation, width, height, x, y)` call with a flat `0`
  // (the same break `writeFogInstances`'s own elevation test above is
  // built to catch) fails this test too, since `update` calls
  // `writeFogInstances` to fill the buffer it then reads into the matrix --
  // proving this test is sensitive to the same regression through the
  // instance-matrix path specifically, not merely re-testing the pure
  // function directly.
  it('fog quads lift with terrain: FogMesh.update carries a raised tile\'s own elevation into its instance matrix', () => {
    const mesh = new FogMesh(W, H);
    // Same 4x4, level-3-at-(1,1) fixture writeFogInstances's own elevation
    // test and units/fx.test.ts's ground-lift suite both use.
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const fog = visibleFog();
    fog[1 * W + 1] = 0; // the raised tile, never seen -- the only instance written
    mesh.update(fog, elevation, W, H);
    const m = new THREE.Matrix4();
    mesh.mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(1, 5);
    expect(pos.z).toBeCloseTo(1, 5);
    expect(pos.y).toBeGreaterThan(0);
    // Cross-checked against the exact function units/particles use for the
    // same job, not merely against a hand-derived number -- same discipline
    // as writeFogInstances's own elevation test.
    expect(pos.y).toBeCloseTo(groundWorldY(elevation, W, H, 1, 1), 5);
  });
});
