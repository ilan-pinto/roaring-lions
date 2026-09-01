/**
 * The pure half of Task B3.13 -- geometry and per-instance/per-vertex
 * attribute arithmetic are plain numbers, exercised directly here, the same
 * split `instances.test.ts` draws for units. `ParticleInstancer`/
 * `TracerBatch`'s per-frame GPU wiring needs no `WebGLRenderer` to
 * *construct* (three.js's own JS-side objects build fine under
 * `environment: 'node'` -- `instances.test.ts`'s own "render-order
 * tie-break" suite already relies on this for `UnitInstancer`), so the
 * material flags that make depth resolution work are asserted directly too,
 * even though *using* either mesh end to end still needs a real renderer and
 * is covered by the browser verification in the B3.13 report instead.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem } from '../../vfx';
import type { ParticleSpec } from '../../vfx';
import { isoX, isoY, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { hexToUnit, screenOffsetToWorld, WORLD_PER_LEVEL } from '../terrain/shared';
import { groundWorldY } from '../ground-height';
import type { SheetSpec } from '../../sheet';
import { packSheet } from './atlas';
import { UnitInstancer, HULL_RENDER_ORDER, TURRET_RENDER_ORDER } from './instances';
import { spawnTracer, type TracerModel } from './tracers';
import { spawnShell, shellPointAt, shellTrailSpan, SHELL_TRAIL_SEGMENTS, type ShellModel } from './shells';
import { FOG_RENDER_ORDER } from './render-order';
import { FogMesh } from '../fog-mesh';
import {
  PARTICLE_CAPACITY,
  PARTICLE_LIFT_PX,
  TRACER_CAPACITY,
  TRACER_LIFT_PX,
  TRACER_WIDTH_PX,
  FX_RENDER_ORDER,
  FX_RENDER_ORDER_ABOVE,
  ParticleInstancer,
  TracerBatch,
  particleBillboardGeometry,
  writeParticleInstances,
  tracerQuadPositions,
  writeTracerInstances,
  tracerIndexBuffer,
  SHELL_LIFT_PX,
  SHELL_WIDTH_PX,
  SHELL_TAIL_ALPHA,
  ShellBatch,
  shellSegmentQuad,
  writeShellInstances,
  type ParticleInstanceBuffers,
  type TracerInstanceBuffers,
} from './fx';

/** A tiny, easy-to-hand-check sheet, matching `instances.test.ts`'s own --
 *  used ONLY for the cross-module renderOrder invariant tests below, which
 *  need a real `UnitInstancer` (hull and turret both) to assert against, not
 *  for anything about units themselves. */
const tinySheet: SheetSpec = {
  facings: 4,
  facingOffset: 0,
  facingReverse: false,
  scale: 1,
  layout: 'clip',
  clips: { idle: { frames: 1, fps: 0, loop: true, fileOffset: 0 } },
};

function makeSpec(overrides: Partial<ParticleSpec> = {}): ParticleSpec {
  return {
    count: 1,
    lifetime_ms: 1000,
    color_over_life: ['#000000'],
    ...overrides,
  };
}

function buffers(capacity: number): ParticleInstanceBuffers {
  return {
    positions: new Float32Array(capacity * 3),
    colors: new Float32Array(capacity * 3),
    alphas: new Float32Array(capacity),
    scales: new Float32Array(capacity),
  };
}

describe('particleBillboardGeometry', () => {
  it('is a centred quad, four verts, six indices, local coords at the unit-circle corners', () => {
    const geo = particleBillboardGeometry();
    expect(geo.positions).toHaveLength(12);
    expect(geo.local).toEqual(Float32Array.from([-1, -1, 1, -1, 1, 1, -1, 1]));
    expect(geo.indices).toEqual(Uint32Array.from([0, 1, 2, 0, 2, 3]));
  });

  it('the vertical (world-Y) span is symmetric about 0 -- centred, not feet-anchored', () => {
    const geo = particleBillboardGeometry();
    // Vertex order bl, br, tr, tl -- Y components at indices 1, 4, 7, 10.
    expect(geo.positions[1]).toBeCloseTo(-WORLD_Y_PER_LIFT_PIXEL, 5);
    expect(geo.positions[4]).toBeCloseTo(-WORLD_Y_PER_LIFT_PIXEL, 5);
    expect(geo.positions[7]).toBeCloseTo(WORLD_Y_PER_LIFT_PIXEL, 5);
    expect(geo.positions[10]).toBeCloseTo(WORLD_Y_PER_LIFT_PIXEL, 5);
  });

  it('the horizontal (X/Z) span matches screenOffsetToWorld(1,0) exactly -- not a placeholder axis', () => {
    // Round 1 tested only the Y span; a swapped or zeroed X/Z axis would
    // have passed every prior assertion here while rendering as a vertical
    // sliver instead of a circle. bl/br (indices 0-2, 3-5) are the two
    // horizontal corners at up = -1.
    const geo = particleBillboardGeometry();
    const right = screenOffsetToWorld(1, 0);
    expect(geo.positions[0]).toBeCloseTo(-right.dx, 5); // bl.x
    expect(geo.positions[2]).toBeCloseTo(-right.dy, 5); // bl.z
    expect(geo.positions[3]).toBeCloseTo(right.dx, 5); // br.x
    expect(geo.positions[5]).toBeCloseTo(right.dy, 5); // br.z
  });

  it('is square in screen space -- horizontal and vertical spans reproject to equal screen-pixel extents, not an ellipse', () => {
    // The load-bearing property this geometry exists for: a particle must
    // render as a CIRCLE (the fragment shader's own circle cutout assumes a
    // square local frame), not an ellipse stretched along one axis. bl -> br
    // is the horizontal span (ground-plane X/Z, reprojects through
    // isoX/isoY); bl -> tl is the vertical span (pure world-Y height, which
    // isoX/isoY do not touch at all -- reprojected independently through
    // the SAME WORLD_Y_PER_LIFT_PIXEL conversion the geometry itself was
    // built from, not assumed equal by construction).
    const geo = particleBillboardGeometry();
    const blX = geo.positions[0];
    const blY = geo.positions[1];
    const blZ = geo.positions[2];
    const brX = geo.positions[3];
    const brZ = geo.positions[5];
    const tlY = geo.positions[10];
    const horizontalScreenPx = Math.hypot(isoX(brX, brZ) - isoX(blX, blZ), isoY(brX, brZ) - isoY(blX, blZ));
    const verticalScreenPx = (tlY - blY) / WORLD_Y_PER_LIFT_PIXEL;
    expect(horizontalScreenPx).toBeCloseTo(verticalScreenPx, 4);
    expect(horizontalScreenPx).toBeCloseTo(2, 4); // spans -1..1 = 2 "px"
  });
});

describe('writeParticleInstances', () => {
  it('writes position, colour, alpha and radius for one freshly spawned particle', () => {
    const ps = new ParticleSystem(8, () => '#00FF80');
    ps.spawn(makeSpec({ size_px: 4, color_over_life: ['x'] }), 10, 20, 0, 1, 5, 0);
    const out = buffers(8);
    const count = writeParticleInstances(ps, 0, null, 0, 0, out);
    expect(count).toBe(1);
    expect(out.positions[0]).toBe(10);
    // size_px 4, magnitude 1 -> scale = 0.75 + 1*1.25 = 2 -> radius 8, which
    // EXCEEDS PARTICLE_LIFT_PX (3) -- the B3.14 ground-lift fix lifts by
    // max(PARTICLE_LIFT_PX, radius), not the flat PARTICLE_LIFT_PX round 1
    // used unconditionally, so the quad's own bottom edge lands exactly on
    // the ground plane (elevation null -> groundWorldY 0) instead of
    // clipping into it.
    expect(out.positions[1]).toBeCloseTo(8 * WORLD_Y_PER_LIFT_PIXEL, 5);
    expect(out.positions[2]).toBe(20);
    const [r, g, b] = hexToUnit('#00FF80');
    expect(out.colors[0]).toBeCloseTo(r, 6);
    expect(out.colors[1]).toBeCloseTo(g, 6);
    expect(out.colors[2]).toBeCloseTo(b, 6);
    // alpha_over_life absent -> sampleLerp's own fallback (1 - t), t = 0 at spawn.
    expect(out.alphas[0]).toBeCloseTo(1, 6);
    // size_px 4, magnitude 1 -> scale = 0.75 + 1*1.25 = 2 -> radius 8.
    expect(out.scales[0]).toBeCloseTo(8, 6);
  });

  it('a particle smaller than PARTICLE_LIFT_PX keeps the flat lift, comfortably clear of the ground', () => {
    // size_px 2, magnitude 0 -> scale 0.75 -> radius 1.5, below PARTICLE_LIFT_PX
    // (3) -- max(3, 1.5) = 3, the same flat lift round 1 always used for the
    // common small-arms-scale case.
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    ps.spawn(makeSpec({ size_px: 2 }), 0, 0, 0, 0, 5, 0);
    const out = buffers(8);
    writeParticleInstances(ps, 0, null, 0, 0, out);
    expect(out.positions[1]).toBeCloseTo(PARTICLE_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, 5);
  });

  it('visits only the requested layerIdx -- the two tiers no longer share one call', () => {
    // B3.14 splits the merged single-mesh read B3.13 shipped with (see this
    // file's own top comment, "The above_units split") into two instancers,
    // each visiting exactly one of ParticleSystem's draw layers -- this is
    // the direct behavioural consequence: a layer-0 particle must not appear
    // when reading layer 1, and vice versa.
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    ps.spawn(makeSpec(), 1, 1, 0, 1, 5, 0); // layer 0 (below)
    ps.spawn(makeSpec(), 2, 2, 0, 1, 5, 1); // layer 1 (above)
    const below = buffers(8);
    const above = buffers(8);
    expect(writeParticleInstances(ps, 0, null, 0, 0, below)).toBe(1);
    expect(below.positions[0]).toBe(1);
    expect(writeParticleInstances(ps, 1, null, 0, 0, above)).toBe(1);
    expect(above.positions[0]).toBe(2);
  });

  it('samples ground height at the particle\'s OWN (x, y), per frame -- not a fixed elevation', () => {
    // 4x4 grid, level 3 at tile (1, 1), flat everywhere else -- the same
    // fixture frame-state.test.ts's own "ground lift" suite uses for units.
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    ps.spawn(makeSpec({ size_px: 2 }), 1.5, 1.5, 0, 0, 5, 0); // on the raised tile
    ps.spawn(makeSpec({ size_px: 2 }), 0.5, 0.5, 0, 0, 5, 0); // flat ground
    const out = buffers(8);
    writeParticleInstances(ps, 0, elevation, 4, 4, out);
    const liftY = PARTICLE_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;
    expect(out.positions[1]).toBeCloseTo(3 * WORLD_PER_LEVEL + liftY, 5); // raised
    expect(out.positions[4]).toBeCloseTo(liftY, 5); // flat
    // Cross-checked against the exact function units use for the same job,
    // not merely against a hand-derived number. Precision 5, not 10: `out`
    // is a Float32Array (GPU-facing storage), so it cannot hold a double's
    // full precision regardless of how exactly the formula matches.
    expect(out.positions[1]).toBeCloseTo(groundWorldY(elevation, 4, 4, 1.5, 1.5) + liftY, 5);
  });

  it('stops at the output buffer\'s own capacity rather than overrunning it', () => {
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    for (let i = 0; i < 5; i++) ps.spawn(makeSpec(), i, i, 0, 1, 5, 0);
    const out = buffers(2);
    const count = writeParticleInstances(ps, 0, null, 0, 0, out);
    expect(count).toBe(2);
  });

  it('skips a particle whose alpha or radius has collapsed, matching forEachLive itself', () => {
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    ps.spawn(makeSpec({ lifetime_ms: 10 }), 5, 5, 0, 1, 5, 0);
    ps.step(1); // well past its 10ms lifetime -> retired, liveCount back to 0
    const out = buffers(8);
    expect(writeParticleInstances(ps, 0, null, 0, 0, out)).toBe(0);
  });
});

describe('PARTICLE_CAPACITY', () => {
  it('matches the capacity Pixi builds its own ParticleSystem with (renderer.ts:644)', () => {
    expect(PARTICLE_CAPACITY).toBe(2048);
  });
});

describe('tracerQuadPositions', () => {
  it('on flat ground (no elevation layer), lifts every vertex by the documented tracer lift -- one pixel more than a particle\'s', () => {
    const t = spawnTracer(0, 0, 5, 0, 0);
    const p = tracerQuadPositions(t, null, 0, 0);
    const liftY = TRACER_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;
    for (const yIdx of [1, 4, 7, 10]) expect(p[yIdx]).toBeCloseTo(liftY, 5);
    // TRACER_LIFT_PX (4) - PARTICLE_LIFT_PX (3) = 1px, converted the same way.
    expect(liftY - PARTICLE_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL).toBeCloseTo(WORLD_Y_PER_LIFT_PIXEL, 5);
  });

  it('post-review fix: on raised ground, lifts every vertex by the HIGHER of its two endpoints\' own ground height', () => {
    // 4x4 grid, level 3 at tile (1, 1), flat everywhere else -- the same
    // fixture frame-state.test.ts's "ground lift" suite and fx.test.ts's own
    // particle ground-lift test use. Shooter (0.5, 0.5) is on flat ground;
    // target (1.5, 1.5) is on the raised tile -- before this fix, every
    // vertex sat at a flat TRACER_LIFT_PX (4 lift-px), well UNDER the
    // raised tile's own 3 * WORLD_PER_LEVEL (30 lift-px) ground, which is
    // exactly the "buried, not misplaced" bug the review caught.
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const t = spawnTracer(0.5, 0.5, 1.5, 1.5, 0);
    const p = tracerQuadPositions(t, elevation, 4, 4);
    const expectedLift =
      Math.max(groundWorldY(elevation, 4, 4, 0.5, 0.5), groundWorldY(elevation, 4, 4, 1.5, 1.5)) +
      TRACER_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;
    for (const yIdx of [1, 4, 7, 10]) expect(p[yIdx]).toBeCloseTo(expectedLift, 5);
    // The higher of the two -- the raised tile's, not the flat one's -- so
    // this is strictly above the flat-ground lift, not merely different.
    expect(expectedLift).toBeGreaterThan(TRACER_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL);
  });

  it('the lift stays a SINGLE scalar shared by all four vertices -- the ribbon tilts, it does not kink', () => {
    // A "kink" would need three or more distinct Y values along the
    // ribbon's own length; a tilt needs at most two (one per end), shared
    // by both of that end's two width-offset vertices. This is the direct
    // check that the fix does the latter: s0/s1 (both at the shooter) share
    // one Y, t0/t1 (both at the target) share the other -- never four
    // independent values.
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const t = spawnTracer(0.5, 0.5, 1.5, 1.5, 0);
    const p = tracerQuadPositions(t, elevation, 4, 4);
    // Vertex layout: s0 (0,1,2), s1 (3,4,5), t1 (6,7,8), t0 (9,10,11).
    expect(p[1]).toBe(p[4]); // s0.y === s1.y
    expect(p[7]).toBe(p[10]); // t1.y === t0.y
    expect(p[1]).toBe(p[7]); // and, for THIS max()-based fix, s.y === t.y too
  });

  it('keeps a constant screen-pixel width at the source end regardless of the shot\'s bearing', () => {
    const cases: TracerModel[] = [
      spawnTracer(0, 0, 5, 0, 0), // pure +x tile direction
      spawnTracer(0, 0, 0, 5, 0), // pure +y tile direction
      spawnTracer(0, 0, 3, 4, 0), // diagonal
      spawnTracer(2, 2, -1, 6, 1), // arbitrary, negative delta
      spawnTracer(3, 3, 3, 3, 0), // degenerate: source === target
    ];
    for (const t of cases) {
      const p = tracerQuadPositions(t, null, 0, 0);
      // Vertex layout: s0 (0,1,2), s1 (3,4,5), t1 (6,7,8), t0 (9,10,11).
      const s0Screen = { x: isoX(p[0], p[2]), y: isoY(p[0], p[2]) };
      const s1Screen = { x: isoX(p[3], p[5]), y: isoY(p[3], p[5]) };
      const width = Math.hypot(s1Screen.x - s0Screen.x, s1Screen.y - s0Screen.y);
      expect(width).toBeCloseTo(TRACER_WIDTH_PX, 4);
    }
  });

  it('the target end carries the same width offset as the source end (a true rectangle)', () => {
    const t = spawnTracer(1, 1, 6, 9, 0);
    const p = tracerQuadPositions(t, null, 0, 0);
    // s1 - s0 (width vector at the source) should equal t1 - t0 (width
    // vector at the target) -- both ends offset by the identical perp.
    const sVec = [p[3] - p[0], p[5] - p[2]];
    const tVec = [p[6] - p[9], p[8] - p[11]];
    expect(sVec[0]).toBeCloseTo(tVec[0], 5);
    expect(sVec[1]).toBeCloseTo(tVec[1], 5);
  });

  it('the quad\'s length axis (s0 to t0) reaches exactly the target -- the perp offset cancels', () => {
    const t = spawnTracer(0, 0, 4, 2, 0);
    const p = tracerQuadPositions(t, null, 0, 0);
    // t0 = target - perp, s0 = source - perp -> t0 - s0 = target - source
    // exactly, regardless of the perpendicular's own magnitude or direction.
    const dx = p[9] - p[0];
    const dz = p[11] - p[2];
    expect(dx).toBeCloseTo(4, 5);
    expect(dz).toBeCloseTo(2, 5);
  });
});

describe('writeTracerInstances', () => {
  function tBuffers(capacity: number): TracerInstanceBuffers {
    return {
      positions: new Float32Array(capacity * 4 * 3),
      colors: new Float32Array(capacity * 4 * 3),
      alphas: new Float32Array(capacity * 4),
    };
  }

  it('writes one quad (4 verts) per live tracer, coloured by side', () => {
    const tracers: TracerModel[] = [spawnTracer(0, 0, 1, 1, 0), spawnTracer(2, 2, 3, 3, 1)];
    const out = tBuffers(4);
    const count = writeTracerInstances(tracers, ['#FF0000', '#00FF00'], null, 0, 0, out);
    expect(count).toBe(2);
    const [r0, g0, b0] = hexToUnit('#FF0000');
    for (let v = 0; v < 4; v++) {
      expect(out.colors[v * 3]).toBeCloseTo(r0, 6);
      expect(out.colors[v * 3 + 1]).toBeCloseTo(g0, 6);
      expect(out.colors[v * 3 + 2]).toBeCloseTo(b0, 6);
    }
    const [r1, g1, b1] = hexToUnit('#00FF00');
    for (let v = 0; v < 4; v++) {
      const base = 12 + v * 3; // second tracer's vertex block
      expect(out.colors[base]).toBeCloseTo(r1, 6);
      expect(out.colors[base + 1]).toBeCloseTo(g1, 6);
      expect(out.colors[base + 2]).toBeCloseTo(b1, 6);
    }
  });

  it('a freshly spawned tracer writes full alpha at every one of its four vertices', () => {
    const out = tBuffers(2);
    writeTracerInstances([spawnTracer(0, 0, 1, 0, 0)], ['#FFFFFF', '#FFFFFF'], null, 0, 0, out);
    for (let v = 0; v < 4; v++) expect(out.alphas[v]).toBeCloseTo(1, 10);
  });

  it('never writes more quads than the output buffer has room for', () => {
    const tracers: TracerModel[] = [
      spawnTracer(0, 0, 1, 0, 0),
      spawnTracer(0, 0, 1, 0, 0),
      spawnTracer(0, 0, 1, 0, 0),
    ];
    const out = tBuffers(2);
    expect(writeTracerInstances(tracers, ['#FFFFFF', '#FFFFFF'], null, 0, 0, out)).toBe(2);
  });

  it('over capacity, drops the OLDEST tracers and keeps the newest -- not the reverse', () => {
    // tracers is spawn-ordered (oldest at index 0, matching Array.push spawn
    // order and stepTracers's own order-preserving filter). Distinct sx per
    // tracer stands in for "which shot this is". Each kept quad's own s0.x
    // is re-derived by calling the SAME pure tracerQuadPositions -- already
    // independently tested above -- rather than assuming its exact value,
    // so this only asserts what writeTracerInstances itself decides: WHICH
    // tracers survive, not what their geometry looks like.
    const tracers: TracerModel[] = [0, 1, 2, 3, 4].map((sx) => spawnTracer(sx, 0, sx + 1, 0, 0));
    const expectedS0x = tracers.map((t) => tracerQuadPositions(t, null, 0, 0)[0]);
    const out = tBuffers(3);
    const count = writeTracerInstances(tracers, ['#FFFFFF', '#FFFFFF'], null, 0, 0, out);
    expect(count).toBe(3);
    const keptS0x = [0, 1, 2].map((i) => out.positions[i * 12]);
    // The newest three (index 2, 3, 4 -- sx 2..4) must be present, in
    // order; the oldest two (index 0, 1) must not -- a `break`-at-capacity
    // implementation keeps index 0,1,2 instead and fails this.
    expect(keptS0x).toEqual([expectedS0x[2], expectedS0x[3], expectedS0x[4]]);
  });
});

describe('tracerIndexBuffer', () => {
  it('produces two front-facing triangles per quad slot, offset by 4 vertices each', () => {
    expect(tracerIndexBuffer(2)).toEqual(
      Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
    );
  });
});

describe('TRACER_CAPACITY', () => {
  it('is the actual truncation bound writeTracerInstances enforces -- not a number that merely sits nearby', () => {
    // A vacuous ">0 and integer" check would still pass if TRACER_CAPACITY
    // were changed to a value that no longer matched what writeTracerInstances
    // (called via its own default-sized buffers) actually allows through --
    // this ties the exported constant to that real, observable behaviour:
    // TRACER_CAPACITY + 5 live tracers must truncate to EXACTLY
    // TRACER_CAPACITY, no more and no fewer.
    const tracers: TracerModel[] = Array.from({ length: TRACER_CAPACITY + 5 }, (_, i) =>
      spawnTracer(i, 0, i + 1, 0, 0)
    );
    const out: TracerInstanceBuffers = {
      positions: new Float32Array(TRACER_CAPACITY * 4 * 3),
      colors: new Float32Array(TRACER_CAPACITY * 4 * 3),
      alphas: new Float32Array(TRACER_CAPACITY * 4),
    };
    expect(writeTracerInstances(tracers, ['#FFFFFF', '#FFFFFF'], null, 0, 0, out)).toBe(TRACER_CAPACITY);
  });

  it('is the value the REAL TracerBatch is actually constructed with, not merely reused to size a fixture', () => {
    // The test above sizes `out` FROM TRACER_CAPACITY, so it only proves
    // writeTracerInstances respects whatever capacity a buffer implies --
    // it would still pass unchanged if TRACER_CAPACITY drifted from what
    // ThreeRenderer.ts actually builds TracerBatch with. `new
    // TracerBatch(TRACER_CAPACITY)` is the one place that constant reaches a
    // real allocation; pushing TRACER_CAPACITY + 5 live tracers through the
    // genuine object and reading its own geometry drawRange back out ties
    // the constant to the thing it is actually meant to size.
    const batch = new TracerBatch(TRACER_CAPACITY);
    const tracers: TracerModel[] = Array.from({ length: TRACER_CAPACITY + 5 }, (_, i) =>
      spawnTracer(i, 0, i + 1, 0, 0)
    );
    batch.update(tracers, ['#FFFFFF', '#FFFFFF'], null, 0, 0);
    expect(batch.mesh.geometry.drawRange.count).toBe(TRACER_CAPACITY * 6);
  });
});

describe('ParticleInstancer construction', () => {
  it('starts with mesh.count 0 and grows to the written instance count on update', () => {
    const instancer = new ParticleInstancer(4, 0, true);
    expect(instancer.mesh.count).toBe(0);
    const ps = new ParticleSystem(4, () => '#FFFFFF');
    ps.spawn(makeSpec(), 1, 1, 0, 1, 5, 0);
    instancer.update(ps, null, 0, 0);
    expect(instancer.mesh.count).toBe(1);
  });

  it('drops back to 0 (not a stale frame) when handed a null ParticleSystem', () => {
    const instancer = new ParticleInstancer(4, 0, true);
    const ps = new ParticleSystem(4, () => '#FFFFFF');
    ps.spawn(makeSpec(), 1, 1, 0, 1, 5, 0);
    instancer.update(ps, null, 0, 0);
    expect(instancer.mesh.count).toBe(1);
    instancer.update(null, null, 0, 0);
    expect(instancer.mesh.count).toBe(0);
  });

  it('only counts instances on its own constructed layerIdx', () => {
    const below = new ParticleInstancer(4, 0, true);
    const above = new ParticleInstancer(4, 1, false);
    const ps = new ParticleSystem(4, () => '#FFFFFF');
    ps.spawn(makeSpec(), 1, 1, 0, 1, 5, 0);
    ps.spawn(makeSpec(), 2, 2, 0, 1, 5, 1);
    below.update(ps, null, 0, 0);
    above.update(ps, null, 0, 0);
    expect(below.mesh.count).toBe(1);
    expect(above.mesh.count).toBe(1);
  });

  it('the particle material is always transparent and NOT depth-written, regardless of tier', () => {
    // depthWrite: false is the round-2 (B3.13) fix -- particles are
    // inherently translucent (alpha_over_life fades by design), and a
    // depth-WRITING particle would depth-reject an overlapping one instead
    // of letting the two blend, which is exactly what a dense burst
    // (catastrophic_kill's 18-26 overlapping discs) needs. Unaffected by the
    // B3.14 depthTest split below -- both tiers keep depthWrite false.
    for (const depthTest of [true, false]) {
      const instancer = new ParticleInstancer(4, 0, depthTest);
      const material = instancer.mesh.material;
      expect(Array.isArray(material)).toBe(false);
      const m = material as THREE.Material;
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.side).toBe(THREE.FrontSide);
    }
  });

  it('depthTest is the constructor\'s choice -- true for the below tier, false for the above tier', () => {
    // The B3.14 fix for `above_units` (see fx.ts's own top comment, "The
    // above_units split"): a below-tier instancer keeps real occlusion
    // against units/terrain; an above-tier one skips the depth test
    // entirely, matching Pixi's own unconditional `fxAboveG`.
    const below = new ParticleInstancer(4, 0, true);
    const above = new ParticleInstancer(4, 1, false);
    expect((below.mesh.material as THREE.Material).depthTest).toBe(true);
    expect((above.mesh.material as THREE.Material).depthTest).toBe(false);
  });

  it('draws after every unit via an explicit renderOrder, not an accident of construction order', () => {
    // With depthWrite off, the depth buffer no longer arbitrates FX-vs-unit
    // order -- this renderOrder is the declared replacement. UnitInstancer
    // never sets renderOrder, so its default is three.js's own default (0);
    // FX must sort strictly after that.
    const instancer = new ParticleInstancer(4, 0, true);
    expect(instancer.mesh.renderOrder).toBeGreaterThan(0);
  });

  it('the above tier draws after the below tier -- both explicit, not tied', () => {
    const below = new ParticleInstancer(4, 0, true);
    const above = new ParticleInstancer(4, 1, false);
    expect(above.mesh.renderOrder).toBeGreaterThan(below.mesh.renderOrder);
  });

  it('the below tier shares its renderOrder with TracerBatch -- both are Pixi\'s "below" layer', () => {
    // Tracers are unaffected by the B3.14 split -- Pixi's tracers live on
    // fxG (below), exactly where the below-tier particle mesh already sits.
    const below = new ParticleInstancer(4, 0, true);
    const tracers = new TracerBatch(4);
    expect(below.mesh.renderOrder).toBe(tracers.mesh.renderOrder);
  });

  it("CROSS-MODULE INVARIANT: every FX mesh's renderOrder outranks UnitInstancer's own default (0)", () => {
    // This is the invariant that makes "renderOrder 1/2" mean "above units"
    // at all -- if UnitInstancer ever started setting its own renderOrder,
    // every FX-vs-unit ordering claim in this file's top comment would break
    // silently, with no test anywhere catching it. Pinning UnitInstancer's
    // own side of the comparison here, alongside the FX side, rather than
    // trusting the two files to agree by construction.
    const sheet = tinySheet;
    const units = new UnitInstancer(sheet, new THREE.DataArrayTexture(), packSheet(sheet), 4);
    const below = new ParticleInstancer(4, 0, true);
    const above = new ParticleInstancer(4, 1, false);
    const tracers = new TracerBatch(4);
    expect(units.mesh.renderOrder).toBe(0);
    expect(below.mesh.renderOrder).toBeGreaterThan(units.mesh.renderOrder);
    expect(above.mesh.renderOrder).toBeGreaterThan(units.mesh.renderOrder);
    expect(tracers.mesh.renderOrder).toBeGreaterThan(units.mesh.renderOrder);
  });

  it('CROSS-MODULE INVARIANT: every FX mesh also outranks a TURRET instancer, not merely a hull one', () => {
    // The bug this guards: instances.ts's TURRET_RENDER_ORDER and this
    // file's own FX_RENDER_ORDER were both `1` until the band-collision fix
    // -- the test above (against a HULL instancer, renderOrder 0) could not
    // have caught that, because a hull instancer never exercises the band a
    // turret actually occupies. Reaching across both modules' real exported
    // constants (not hand-typed literals, so a future edit to either file
    // fails THIS test rather than silently drifting again) is what this
    // suite could not do before FX_RENDER_ORDER was exported.
    //
    // Task B4.2 extends this SAME test with `FogMesh` rather than adding a
    // parallel one (the brief's own instruction) -- `FOG_RENDER_ORDER` is
    // the fifth and, so far, last band in the table, and it is the one this
    // whole chain exists to protect the most directly: a fog quad that ends
    // up BELOW a unit's own renderOrder would stop hiding a hostile standing
    // on the tile it covers, which is this task's entire point. `depthTest:
    // false` (asserted separately, fog-mesh.test.ts's own "unconditional
    // overlay" test) makes fog immune to genuine depth occlusion, but immune
    // to a LOSING renderOrder it is not -- three.js still submits transparent
    // objects in renderOrder order, so the ordering half of "fog draws over
    // everything" lives here, in the one file that can reach every band at
    // once.
    const sheet = tinySheet;
    const packing = packSheet(sheet);
    const hull = new UnitInstancer(sheet, new THREE.DataArrayTexture(), packing, 4);
    const turret = new UnitInstancer(sheet, new THREE.DataArrayTexture(), packing, 4, TURRET_RENDER_ORDER);
    const below = new ParticleInstancer(4, 0, true);
    const above = new ParticleInstancer(4, 1, false);
    const tracers = new TracerBatch(4);
    const fog = new FogMesh(4, 4);

    // The full band table, asserted as a strict ascending chain rather than
    // pairwise against zero -- HULL < TURRET < FX < FX_ABOVE < FOG, with no
    // two bands equal. This is the exact shape of assertion the old
    // collision (TURRET_RENDER_ORDER === FX_RENDER_ORDER, both 1) would fail.
    const bands = [
      HULL_RENDER_ORDER,
      TURRET_RENDER_ORDER,
      FX_RENDER_ORDER,
      FX_RENDER_ORDER_ABOVE,
      FOG_RENDER_ORDER,
    ];
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]).toBeGreaterThan(bands[i - 1]);
    }

    // And against the real, constructed mesh objects -- not merely the
    // constants in isolation -- so a mesh that stopped reading its own
    // module's constant would also fail this.
    expect(hull.mesh.renderOrder).toBe(HULL_RENDER_ORDER);
    expect(turret.mesh.renderOrder).toBe(TURRET_RENDER_ORDER);
    expect(turret.mesh.renderOrder).toBeGreaterThan(hull.mesh.renderOrder);
    expect(below.mesh.renderOrder).toBeGreaterThan(turret.mesh.renderOrder);
    expect(tracers.mesh.renderOrder).toBeGreaterThan(turret.mesh.renderOrder);
    expect(above.mesh.renderOrder).toBeGreaterThan(below.mesh.renderOrder);
    expect(fog.mesh.renderOrder).toBeGreaterThan(above.mesh.renderOrder);
  });

  it('writes correct per-instance position and scale into the instance matrix, not merely the right count', () => {
    // mesh.count being right does not prove setMatrixAt wrote the right
    // transform -- an instance could be counted but placed at the origin,
    // or scaled wrong, and every existing test would still pass.
    const instancer = new ParticleInstancer(4, 0, true);
    const ps = new ParticleSystem(4, () => '#FFFFFF');
    // size_px 5, magnitude 1 -> scale = 0.75 + 1*1.25 = 2 -> radius 10.
    ps.spawn(makeSpec({ size_px: 5 }), 3, 7, 0, 1, 5, 0);
    instancer.update(ps, null, 0, 0);
    const m = new THREE.Matrix4();
    instancer.mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(3, 5);
    expect(pos.z).toBeCloseTo(7, 5);
    // radius 10 exceeds PARTICLE_LIFT_PX (3) -- lifted by its own radius,
    // per the B3.14 ground-lift fix (see writeParticleInstances's tests).
    expect(pos.y).toBeCloseTo(10 * WORLD_Y_PER_LIFT_PIXEL, 5);
    expect(scale.x).toBeCloseTo(10, 5);
    expect(scale.y).toBeCloseTo(10, 5);
    expect(scale.z).toBeCloseTo(10, 5);
  });

  it('mesh is exempt from frustum culling -- particles range across the whole map, not near the origin', () => {
    const instancer = new ParticleInstancer(4, 0, true);
    expect(instancer.mesh.frustumCulled).toBe(false);
  });
});

describe('TracerBatch construction', () => {
  it('starts with an empty draw range and grows it to match live tracers on update', () => {
    const batch = new TracerBatch(4);
    expect(batch.mesh.geometry.drawRange.count).toBe(0);
    batch.update([spawnTracer(0, 0, 1, 1, 0)], ['#FFFFFF', '#FFFFFF'], null, 0, 0);
    expect(batch.mesh.geometry.drawRange.count).toBe(6); // one quad = 6 indices
  });

  it('the tracer material is transparent and depth-tested, but NOT depth-written, and double-sided', () => {
    // depthWrite: false for the same reason as ParticleInstancer's material
    // -- a tracer fades over its lifetime (tracerAlpha) exactly like a
    // particle does, and two crossing tracers should blend rather than
    // depth-reject one of them.
    const batch = new TracerBatch(4);
    const m = batch.mesh.material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
    // Double-sided deliberately -- see fx.ts's own doc comment on
    // createTracerMaterial for why a per-frame, arbitrary-bearing quad
    // cannot reuse the fixed, once-proven winding units/particles rely on.
    expect(m.side).toBe(THREE.DoubleSide);
  });

  it('draws after every unit via an explicit renderOrder, matching ParticleInstancer', () => {
    const batch = new TracerBatch(4);
    expect(batch.mesh.renderOrder).toBeGreaterThan(0);
  });

  it('mesh is exempt from frustum culling, matching ParticleInstancer/UnitInstancer', () => {
    const batch = new TracerBatch(4);
    expect(batch.mesh.frustumCulled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GH-145: the indirect-fire arc. A shell segment is a tracer ribbon whose two
// ends sit at DIFFERENT heights -- that is the whole geometric difference,
// and every test below is about one consequence of it.
// ---------------------------------------------------------------------------

describe('shellSegmentQuad', () => {
  const flat = spawnShell(0, 0, 12, 0, 0, 'mortar');

  it('lifts each end by its own arc height, so the ribbon tilts -- unlike a tracer\'s single shared scalar', () => {
    // Vertex layout mirrors tracerQuadPositions: a0 (0,1,2), a1 (3,4,5),
    // b1 (6,7,8), b0 (9,10,11).
    const p = shellSegmentQuad(flat, 0.1, 0.3, null, 0, 0);
    expect(p[1]).toBe(p[4]); // both vertices at the tail end share one Y
    expect(p[7]).toBe(p[10]); // both at the head end share the other
    // ...and the two ends genuinely differ, which is what a tracer never does.
    expect(p[7]).toBeGreaterThan(p[1]);
  });

  it('falls again past the apex -- the segment past halfway tilts DOWN', () => {
    const p = shellSegmentQuad(flat, 0.7, 0.9, null, 0, 0);
    expect(p[7]).toBeLessThan(p[1]);
  });

  it('never lies on the ground it is drawn over: even at launch it clears SHELL_LIFT_PX', () => {
    // Launch and impact are both at arc height 0. With depthTest on, a
    // ribbon exactly ON the ground does not render -- the same "buried, not
    // misplaced" failure TRACER_LIFT_PX exists to prevent.
    const p = shellSegmentQuad(flat, 0, 0, null, 0, 0);
    expect(p[1]).toBeCloseTo(SHELL_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, 6);
  });

  it('rides between its OWN two endpoints\' ground heights, not the ground under the arc', () => {
    // 4x4 grid, level 3 at tile (1,1). A shot fired from the flat tile
    // (0.5,0.5) at the raised one (1.5,1.5): the round's baseline is the
    // launch tile's ground at u=0 and the impact tile's at u=1. Sampling the
    // ground UNDER the arc instead would make a bomb bulge over every ridge
    // it passes, which is not how a bomb flies -- and with real height and
    // real depth, terrain occlusion is the depth buffer's job, not the
    // baseline's.
    const elevation = new Uint8Array([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const s = spawnShell(0.5, 0.5, 1.5, 1.5, 0, 'mortar');
    const launchGround = groundWorldY(elevation, 4, 4, 0.5, 0.5);
    const impactGround = groundWorldY(elevation, 4, 4, 1.5, 1.5);
    expect(impactGround).toBeGreaterThan(launchGround);
    const atLaunch = shellSegmentQuad(s, 0, 0, elevation, 4, 4);
    const atImpact = shellSegmentQuad(s, 1, 1, elevation, 4, 4);
    expect(atLaunch[1]).toBeCloseTo(launchGround + SHELL_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, 6);
    expect(atImpact[1]).toBeCloseTo(impactGround + SHELL_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, 6);
  });

  it('the width offset is SHELL_WIDTH_PX and runs PERPENDICULAR to the segment on screen, height included', () => {
    // Screen Y of a lifted point is isoY(x,y) - liftPx (worldToScreen's own
    // convention), so a climbing segment's on-screen direction is NOT its
    // ground bearing. Magnitude alone cannot catch getting this wrong --
    // screenOffsetToWorld reprojects any unit screen direction to exactly
    // the length it was given, so a ribbon offset along the WRONG axis is
    // still exactly SHELL_WIDTH_PX wide. Perpendicularity is the property
    // that actually distinguishes them, and a segment steep enough for the
    // two candidate axes to differ is what makes it observable.
    const cases: [ShellModel, number, number][] = [
      [spawnShell(0, 0, 8, 0, 0, 'mortar'), 0, 0.06], // steepest: straight off the tube
      [spawnShell(0, 0, 0, 8, 0, 'mortar'), 0.4, 0.6],
      [spawnShell(0, 0, 5, 7, 1, 'rocket'), 0.88, 1], // steepest: terminal descent
      [spawnShell(3, 3, 3, 3, 0, 'mortar'), 0.2, 0.4], // degenerate: no ground track
    ];
    for (const [s, uA, uB] of cases) {
      const p = shellSegmentQuad(s, uA, uB, null, 0, 0);
      const screen = (xi: number, yi: number, zi: number) => ({
        x: isoX(p[xi], p[zi]),
        y: isoY(p[xi], p[zi]) - p[yi] / WORLD_Y_PER_LIFT_PIXEL,
      });
      const a0 = screen(0, 1, 2);
      const a1 = screen(3, 4, 5);
      const b0 = screen(9, 10, 11);
      const width = { x: a1.x - a0.x, y: a1.y - a0.y };
      expect(Math.hypot(width.x, width.y)).toBeCloseTo(SHELL_WIDTH_PX, 4);
      const along = { x: b0.x - a0.x, y: b0.y - a0.y };
      const alongLen = Math.hypot(along.x, along.y);
      if (alongLen > 1e-6) {
        expect((width.x * along.x + width.y * along.y) / alongLen).toBeCloseTo(0, 4);
      }
    }
  });

  it('tapers: the tail end is narrower than the head end, so the streak reads as a comet', () => {
    const p = shellSegmentQuad(flat, 0.1, 0.3, null, 0, 0, SHELL_WIDTH_PX * 0.25, SHELL_WIDTH_PX);
    const width = (i: number, j: number) =>
      Math.hypot(isoX(p[i], p[i + 2]) - isoX(p[j], p[j + 2]), isoY(p[i], p[i + 2]) - isoY(p[j], p[j + 2]));
    expect(width(0, 3)).toBeCloseTo(SHELL_WIDTH_PX * 0.25, 4);
    expect(width(9, 6)).toBeCloseTo(SHELL_WIDTH_PX, 4);
  });
});

describe('writeShellInstances', () => {
  function sBuffers(capacity: number): TracerInstanceBuffers {
    return {
      positions: new Float32Array(capacity * 4 * 3),
      colors: new Float32Array(capacity * 4 * 3),
      alphas: new Float32Array(capacity * 4),
    };
  }

  it('writes one quad per trail segment per live shell, coloured by side from the tracer palette', () => {
    const shells = [
      { ...spawnShell(0, 0, 12, 0, 0, 'mortar'), t: 1 },
      { ...spawnShell(2, 2, 10, 2, 1, 'rocket'), t: 1 },
    ];
    const out = sBuffers(SHELL_TRAIL_SEGMENTS * 2);
    const count = writeShellInstances(shells, ['#FF0000', '#00FF00'], null, 0, 0, out);
    expect(count).toBe(SHELL_TRAIL_SEGMENTS * 2);
    const [r0, g0, b0] = hexToUnit('#FF0000');
    expect(out.colors[0]).toBeCloseTo(r0, 6);
    expect(out.colors[1]).toBeCloseTo(g0, 6);
    expect(out.colors[2]).toBeCloseTo(b0, 6);
    const [r1] = hexToUnit('#00FF00');
    // Second shell's first quad starts after the first shell's own segments.
    expect(out.colors[SHELL_TRAIL_SEGMENTS * 12]).toBeCloseTo(r1, 6);
  });

  it('fades the streak from tail to head, reaching full alpha only at the round itself', () => {
    const shells = [{ ...spawnShell(0, 0, 12, 0, 0, 'mortar'), t: 1 }];
    const out = sBuffers(SHELL_TRAIL_SEGMENTS);
    writeShellInstances(shells, ['#FFFFFF', '#FFFFFF'], null, 0, 0, out);
    // Vertex alphas per quad: [tail, tail, head, head] (a0, a1, b1, b0).
    const tailOf = (q: number) => out.alphas[q * 4];
    const headOf = (q: number) => out.alphas[q * 4 + 2];
    expect(tailOf(0)).toBeCloseTo(SHELL_TAIL_ALPHA, 6);
    expect(headOf(SHELL_TRAIL_SEGMENTS - 1)).toBeCloseTo(1, 6);
    for (let q = 0; q < SHELL_TRAIL_SEGMENTS; q++) {
      expect(headOf(q)).toBeGreaterThan(tailOf(q));
      // Joins are continuous: one quad's head alpha IS the next one's tail,
      // so the ramp runs across the whole streak rather than resetting at
      // every segment boundary and banding it.
      if (q > 0) expect(tailOf(q)).toBeCloseTo(headOf(q - 1), 6);
    }
  });

  it('drops the OLDEST shells when the buffer cannot hold them all, for the same reason tracers do', () => {
    const capacityShells = 2;
    const shells = [0, 1, 2, 3].map((i) => ({ ...spawnShell(i, 0, i + 10, 0, 0, 'mortar'), t: 1 }));
    const out = sBuffers(SHELL_TRAIL_SEGMENTS * capacityShells);
    const count = writeShellInstances(shells, ['#FFFFFF', '#FFFFFF'], null, 0, 0, out);
    expect(count).toBe(SHELL_TRAIL_SEGMENTS * capacityShells);
    // The first quad written is the tail of shell index 2, not index 0. The
    // two width-offset vertices at one end straddle the arc symmetrically,
    // so their mean is the arc point itself whatever the taper is doing --
    // the same "the perp offset cancels" identity the tracer suite uses.
    const meanX = (out.positions[0] + out.positions[3]) / 2;
    const kept = shellPointAt(shells[2], shellTrailSpan(shells[2]).tail);
    const dropped = shellPointAt(shells[0], shellTrailSpan(shells[0]).tail);
    expect(meanX).toBeCloseTo(kept.x, 5);
    expect(meanX).not.toBeCloseTo(dropped.x, 5);
  });
});

describe('ShellBatch construction', () => {
  it('starts with an empty draw range and grows it by one quad per trail segment', () => {
    const batch = new ShellBatch(SHELL_TRAIL_SEGMENTS);
    expect(batch.mesh.geometry.drawRange.count).toBe(0);
    batch.update([{ ...spawnShell(0, 0, 12, 0, 0, 'mortar'), t: 1 }], ['#FFFFFF', '#FFFFFF'], null, 0, 0);
    expect(batch.mesh.geometry.drawRange.count).toBe(SHELL_TRAIL_SEGMENTS * 6);
  });

  it('is NOT depth-tested, unlike the tracer material it otherwise shares', () => {
    // The one flag that differs, and the reason band 3 is right. A browser
    // walk caught a mortar round 88 lift pixels up -- three tile-heights,
    // higher than any building on any shipped map -- drawing BEHIND a
    // one-storey house it was passing over. See ShellBatch's own doc
    // comment. Everything else is the tracer contract verbatim.
    const m = new ShellBatch(4).mesh.material;
    expect(m.depthTest).toBe(false);
    expect(new TracerBatch(4).mesh.material.depthTest).toBe(true);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.side).toBe(THREE.DoubleSide);
  });

  it('draws in the FX-ABOVE band -- strictly after TracerBatch, and skips frustum culling', () => {
    const batch = new ShellBatch(4);
    expect(batch.mesh.renderOrder).toBe(FX_RENDER_ORDER_ABOVE);
    expect(batch.mesh.renderOrder).toBeGreaterThan(new TracerBatch(4).mesh.renderOrder);
    expect(batch.mesh.renderOrder).toBeLessThan(FOG_RENDER_ORDER);
    expect(batch.mesh.frustumCulled).toBe(false);
  });
});
