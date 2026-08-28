/**
 * Phase C: tunnel trails, the three.js counterpart of `PixiRenderer
 * .drawTrail`. Runs under plain `environment: 'node'` -- `trailQuadGeometry`/
 * `collapsedRouteLevel`/`writeTrailInstances` touch no `THREE.*` at all;
 * `TrailMesh`'s construction and `.update()` build real three.js JS-side
 * objects, which `environment: 'node'` already supports with no
 * `WebGLRenderer` (`fog-mesh.test.ts`'s own top comment is the precedent
 * this follows, line for line).
 *
 * Per this project's own standard: every assertion below that matters was
 * verified by breaking the corresponding line in `trail-mesh.ts` by hand and
 * confirming the SPECIFIC test named goes red, then reverting. Each break is
 * named in its own test's comment, and again in this task's own report.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { groundWorldY } from './ground-height';
import { hexToUnit, MARK_EPSILON } from './terrain/shared';
import { trailTileAlpha } from '../trail';
import { HULL_RENDER_ORDER, TURRET_RENDER_ORDER, TRAIL_RENDER_ORDER } from './units/render-order';
import {
  trailQuadGeometry,
  collapsedRouteLevel,
  writeTrailInstances,
  TrailMesh,
  type TrailInstanceInput,
  type TrailInstanceBuffers,
} from './trail-mesh';

const W = 4;
const H = 4;
const SPOIL = '#6E7449';

function buffers(capacity: number): TrailInstanceBuffers {
  return {
    positions: new Float32Array(capacity * 3),
    alphas: new Float32Array(capacity),
  };
}

/** A one-route input with every gate open by default -- individual tests
 *  override just the field(s) they care about, so a wrong default can never
 *  silently make an unrelated test pass. */
function baseInput(overrides: Partial<TrailInstanceInput> = {}): TrailInstanceInput {
  return {
    width: W,
    height: H,
    elevation: null,
    trail: new Uint8Array(W * H),
    routeCount: 1,
    routeLevel: () => 2,
    tunnelUnderTile: () => false,
    seenByAnyone: () => false,
    seenByCarrier: () => false,
    ...overrides,
  };
}

describe('trailQuadGeometry', () => {
  it('is the same unit tile footprint fogQuadGeometry builds, four verts on the ground plane, six indices', () => {
    const geo = trailQuadGeometry();
    expect(geo.positions).toHaveLength(12);
    expect(Array.from(geo.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
    expect(geo.indices).toEqual(Uint32Array.from([0, 2, 1, 0, 3, 2]));
  });
});

describe('collapsedRouteLevel', () => {
  // Break: change `!alive && level === 2 ? 1 : level` to always return
  // `level` unchanged. Verified by hand: this test's first expectation
  // (alive false, level 2 -> 1) fails, reporting 2 instead of 1.
  it('downgrades a collapsed route\'s identified line (level 2) to suspected (1), but nothing else', () => {
    expect(collapsedRouteLevel(false, 2)).toBe(1);
    expect(collapsedRouteLevel(false, 1)).toBe(1);
    expect(collapsedRouteLevel(false, 0)).toBe(0);
  });

  it('leaves a living route\'s level untouched at every rung', () => {
    expect(collapsedRouteLevel(true, 2)).toBe(2);
    expect(collapsedRouteLevel(true, 1)).toBe(1);
    expect(collapsedRouteLevel(true, 0)).toBe(0);
  });
});

describe('writeTrailInstances', () => {
  it('zero routes writes zero instances', () => {
    const out = buffers(W * H);
    const count = writeTrailInstances(baseInput({ routeCount: 0, tunnelUnderTile: () => true }), out);
    expect(count).toBe(0);
  });

  // NOTE on coverage, not a break claim: the `if (!any) return 0;` early
  // exit (verified by hand to be un-caught by this file -- deleting it left
  // every test here green, since the per-tile loop already lands on `lv ===
  // 0` for every tile whenever every route's level is 0, the identical
  // result the early exit produces) is intentionally NOT independently
  // pinned by this test. It is a pure short-circuit over the SAME
  // conclusion the per-tile loop already reaches; the next test below pins
  // the inner, per-route short-circuit it mirrors instead, where the
  // difference IS observable (an invocation count, not an output).
  it('every route at contact level 0 (no contact yet) writes zero instances', () => {
    const out = buffers(W * H);
    const count = writeTrailInstances(
      baseInput({ routeLevel: () => 0, tunnelUnderTile: () => true, seenByAnyone: () => true }),
      out
    );
    expect(count).toBe(0);
  });

  // Break: change `if (levels[r] === 0 || !tunnelUnderTile(r, x, y))
  // continue;` to `if (!tunnelUnderTile(r, x, y)) continue;` (drop the
  // `levels[r] === 0` half). Verified by hand: every OUTPUT-based test in
  // this file still passes with that change -- the subsequent `if
  // (levels[r] > lv) lv = levels[r];` comparison already leaves `lv`
  // unchanged when `levels[r]` is 0, so the tile-level RESULT never differs.
  // What changes is `tunnelUnderTile` getting called at all for a
  // known-zero route, on every tile in the map -- `Sim.tunnelUnderTile`'s
  // own `Set.has` lookup, and the exact per-route cost CLAUDE.md's "Known
  // scaling debts" names -- so only a call-count assertion catches this
  // line; needs a SECOND route with real contact to keep `any` true and
  // force the tile loop to run at all (a single all-zero route never gets
  // this far, per the note above).
  it('does not even CALL tunnelUnderTile for a route with no contact yet, once another route keeps the scan running', () => {
    const out = buffers(W * H);
    let zeroRouteCalls = 0;
    writeTrailInstances(
      baseInput({
        routeCount: 2,
        routeLevel: (r) => (r === 0 ? 0 : 2) as 0 | 1 | 2,
        tunnelUnderTile: (r, x, y) => {
          if (r === 0) zeroRouteCalls++;
          return r === 1 && x === 0 && y === 0;
        },
        seenByCarrier: () => true,
      }),
      out
    );
    expect(zeroRouteCalls).toBe(0);
  });

  it('a tile no route runs under writes no instance, even at full contact', () => {
    const out = buffers(W * H);
    const count = writeTrailInstances(
      baseInput({ tunnelUnderTile: () => false, seenByAnyone: () => true, seenByCarrier: () => true }),
      out
    );
    expect(count).toBe(0);
  });

  it('suspected spoil (level 1) with zero density writes nothing, even when seen', () => {
    const out = buffers(W * H);
    const count = writeTrailInstances(
      baseInput({
        routeLevel: () => 1,
        tunnelUnderTile: () => true,
        seenByAnyone: () => true,
        trail: new Uint8Array(W * H), // all zero density
      }),
      out
    );
    expect(count).toBe(0);
  });

  // Break: drop the `d > 0 &&` half of `seenA` in writeTrailInstances
  // (`const seenA = seenByAnyone(x, y)`). Verified by hand: with that
  // change this test's `count` assertion still passes (seenByAnyone is
  // already true here) -- the NEXT test (density > 0 but seenByAnyone
  // false) is the one that actually catches this break, since without the
  // `d > 0` gate the alpha computation is unaffected either way at this
  // fixture. Kept as the positive-path counterpart.
  it('spoil (level 1, density > 0, seen by anyone) writes an instance with trailTileAlpha\'s own alpha', () => {
    const trail = new Uint8Array(W * H);
    trail[0] = 40;
    const out = buffers(W * H);
    const count = writeTrailInstances(
      baseInput({ routeLevel: () => 1, tunnelUnderTile: () => true, seenByAnyone: () => true, trail }),
      out
    );
    expect(count).toBe(1);
    expect(out.alphas[0]).toBeCloseTo(trailTileAlpha(1, 40, true, false), 6);
  });

  // Break: change `const seenA = d > 0 && seenByAnyone(x, y);` to
  // `const seenA = d > 0;` (drop the seenByAnyone gate entirely). Verified
  // by hand: this test's `count` assertion fails -- an instance is written
  // even though seenByAnyone is false, when it should not be.
  it('spoil with density > 0 but NOT seen by anyone writes nothing', () => {
    const trail = new Uint8Array(W * H);
    trail[0] = 40;
    const out = buffers(W * H);
    const count = writeTrailInstances(
      baseInput({ routeLevel: () => 1, tunnelUnderTile: () => true, seenByAnyone: () => false, trail }),
      out
    );
    expect(count).toBe(0);
  });

  it('the identified line (level 2), seen by a carrier, writes an instance even with zero density', () => {
    const out = buffers(W * H);
    const count = writeTrailInstances(
      baseInput({
        routeLevel: () => 2,
        tunnelUnderTile: (_r, x, y) => x === 0 && y === 0,
        seenByCarrier: () => true,
      }),
      out
    );
    expect(count).toBe(1);
    expect(out.alphas[0]).toBeCloseTo(trailTileAlpha(2, 0, false, true), 6);
  });

  // `trailTileAlpha` itself gates LINE_ALPHA on `level === 2` internally
  // (`./trail.ts:46`), so a level-1 tile writes no instance regardless of
  // whether `writeTrailInstances`'s own `lv === 2 &&` short-circuit runs --
  // proven by hand: deleting that short-circuit (`const seenC =
  // seenByCarrier(x, y);`) left every test in this file green, this one
  // included. That short-circuit exists ONLY to skip the `seenByCarrier`
  // Sim call itself when it cannot matter (`renderer.ts`'s own comment:
  // "The live gates, evaluated only for tiles the ladder already knows
  // about (they are the costliest tests)") -- an invocation-count property,
  // not an alpha/count one, so it needs an invocation-count assertion to be
  // caught at all.
  it('does not even CALL seenByCarrier for a tile below the identified-line level -- the costliest gate stays skipped', () => {
    const out = buffers(W * H);
    let calls = 0;
    writeTrailInstances(
      baseInput({
        routeLevel: () => 1,
        tunnelUnderTile: (_r, x, y) => x === 0 && y === 0,
        seenByCarrier: () => {
          calls++;
          return true;
        },
      }),
      out
    );
    expect(calls).toBe(0);
  });

  // Break: change `if (levels[r] > lv) lv = levels[r];` to `lv =
  // levels[r];` (last route wins instead of the strongest). Verified by
  // hand: with this fixture's routes ordered [level 2, level 1] the tile's
  // resolved level becomes 1 (the LAST route processed) instead of 2 (the
  // STRONGEST) -- and at level 1, zero density and no `seenByAnyone`, both
  // rungs close, so `count` drops to 0 instead of the expected 1.
  it('two routes under the same tile take the STRONGEST contact level, regardless of route order', () => {
    const out = buffers(W * H);
    const count = writeTrailInstances(
      baseInput({
        routeCount: 2,
        routeLevel: (r) => (r === 0 ? 2 : 1) as 0 | 1 | 2,
        tunnelUnderTile: (_r, x, y) => x === 0 && y === 0,
        seenByCarrier: () => true,
      }),
      out
    );
    expect(count).toBe(1);
    expect(out.alphas[0]).toBeCloseTo(trailTileAlpha(2, 0, false, true), 6);
  });

  it('positions x/z at the tile\'s own integer coordinates', () => {
    const out = buffers(W * H);
    writeTrailInstances(
      baseInput({
        tunnelUnderTile: (_r, x, y) => x === 3 && y === 2,
        seenByCarrier: () => true,
      }),
      out
    );
    expect(out.positions[0]).toBe(3);
    expect(out.positions[2]).toBe(2);
  });

  it('on flat ground, an instance sits at MARK_EPSILON above world Y 0, not exactly on the terrain quad', () => {
    const out = buffers(W * H);
    writeTrailInstances(baseInput({ tunnelUnderTile: () => true, seenByCarrier: () => true }), out);
    expect(out.positions[1]).toBeCloseTo(MARK_EPSILON, 6);
  });

  // Break: replace `groundWorldY(elevation, width, height, x, y) +
  // MARK_EPSILON` with a flat `0` (the same class of break fog-mesh.test.ts
  // guards for `writeFogInstances`). Verified by hand: this test's
  // `toBeGreaterThan(0)` assertion fails -- the raised tile's trail instance
  // reports Y 0 instead of following its own terrace height.
  it('on raised ground, the trail instance follows the tile\'s OWN elevation, not world Y 0', () => {
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const out = buffers(W * H);
    writeTrailInstances(
      baseInput({
        elevation,
        tunnelUnderTile: (_r, x, y) => x === 1 && y === 1,
        seenByCarrier: () => true,
      }),
      out
    );
    expect(out.positions[1]).toBeGreaterThan(0);
    expect(out.positions[1]).toBeCloseTo(groundWorldY(elevation, W, H, 1, 1) + MARK_EPSILON, 5);
  });

  it('stops at the output buffer\'s own capacity rather than overrunning it', () => {
    const out = buffers(2);
    const count = writeTrailInstances(baseInput({ tunnelUnderTile: () => true, seenByCarrier: () => true }), out);
    expect(count).toBe(2);
  });
});

describe('TrailMesh construction', () => {
  it('starts with mesh.count 0', () => {
    const mesh = new TrailMesh(W, H, SPOIL);
    expect(mesh.mesh.count).toBe(0);
  });

  it('grows to the written instance count on update, and shrinks again when contact is lost', () => {
    const mesh = new TrailMesh(W, H, SPOIL);
    mesh.update(baseInput({ tunnelUnderTile: () => true, seenByCarrier: () => true }));
    expect(mesh.mesh.count).toBe(W * H);
    mesh.update(baseInput({ tunnelUnderTile: () => false }));
    expect(mesh.mesh.count).toBe(0);
  });

  // Break (renderOrder half): change `this.mesh.renderOrder =
  // TRAIL_RENDER_ORDER;` to `FX_RENDER_ORDER` in trail-mesh.ts. Verified by
  // hand: this test's first expectation fails (renderOrder reports 2, not
  // 0). The alias-not-independent-number guarantee is `render-order.test
  // .ts`'s own job (`TRAIL_RENDER_ORDER is an alias of HULL_RENDER_ORDER`);
  // this test only pins that TrailMesh actually SETS it, since a stray
  // three.js default of 0 would pass that constant-equality check by
  // coincidence with no explicit assignment at all.
  it('draws at TRAIL_RENDER_ORDER, strictly below the turret band', () => {
    const mesh = new TrailMesh(W, H, SPOIL);
    expect(mesh.mesh.renderOrder).toBe(TRAIL_RENDER_ORDER);
    expect(TRAIL_RENDER_ORDER).toBe(HULL_RENDER_ORDER);
    expect(mesh.mesh.renderOrder).toBeLessThan(TURRET_RENDER_ORDER);
  });

  // Break: change `depthTest: true` to `depthTest: false` in
  // createTrailMaterial. Verified by hand: this test's `depthTest`
  // expectation fails -- and this is the exact behavioural inverse of
  // fog-mesh.test.ts's own material assertion (fog wants depthTest false,
  // trail wants it true), which is the whole point of the divergence
  // trail-mesh.ts's top comment argues for.
  it('the material is transparent, depth-TESTED true, depth-written false -- real ground occlusion, no self-blocking translucency', () => {
    const mesh = new TrailMesh(W, H, SPOIL);
    const m = mesh.mesh.material as THREE.Material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
  });

  // Break: hardcode `hexToUnit('#FFFFFF')` in createTrailMaterial instead of
  // the caller's own `spoilColor` parameter. Verified by hand: this test's
  // uColor assertions fail while a hardcoded-literal test would not have
  // caught it -- palette exactness for a value that varies PER MAP is the
  // property this guards, not merely "some colour is set".
  it('the uColor uniform holds exactly hexToUnit(spoilColor) for the colour this instance was constructed with', () => {
    const mesh = new TrailMesh(W, H, SPOIL);
    const material = mesh.mesh.material as THREE.ShaderMaterial;
    const uColor = material.uniforms.uColor.value as THREE.Vector3;
    const [r, g, b] = hexToUnit(SPOIL);
    expect(uColor.x).toBeCloseTo(r, 6);
    expect(uColor.y).toBeCloseTo(g, 6);
    expect(uColor.z).toBeCloseTo(b, 6);

    const other = new TrailMesh(W, H, '#123456');
    const otherUColor = (other.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Vector3;
    const [or, og, ob] = hexToUnit('#123456');
    expect(otherUColor.x).toBeCloseTo(or, 6);
    expect(otherUColor.y).toBeCloseTo(og, 6);
    expect(otherUColor.z).toBeCloseTo(ob, 6);
  });

  it('mesh is exempt from frustum culling, matching every other whole-map mesh in this backend', () => {
    const mesh = new TrailMesh(W, H, SPOIL);
    expect(mesh.mesh.frustumCulled).toBe(false);
  });

  it('writes correct per-instance world position into the instance matrix, not merely the right count', () => {
    const mesh = new TrailMesh(W, H, SPOIL);
    mesh.update(
      baseInput({
        tunnelUnderTile: (_r, x, y) => x === 3 && y === 2,
        seenByCarrier: () => true,
      })
    );
    const m = new THREE.Matrix4();
    mesh.mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(3, 5);
    expect(pos.y).toBeCloseTo(MARK_EPSILON, 5);
    expect(pos.z).toBeCloseTo(2, 5);
  });
});
