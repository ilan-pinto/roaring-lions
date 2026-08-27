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
import { hexToUnit } from '../terrain/shared';
import { spawnTracer, type TracerModel } from './tracers';
import {
  PARTICLE_CAPACITY,
  PARTICLE_LIFT_PX,
  TRACER_CAPACITY,
  TRACER_LIFT_PX,
  TRACER_WIDTH_PX,
  ParticleInstancer,
  TracerBatch,
  particleBillboardGeometry,
  writeParticleInstances,
  tracerQuadPositions,
  writeTracerInstances,
  tracerIndexBuffer,
  type ParticleInstanceBuffers,
  type TracerInstanceBuffers,
} from './fx';

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
});

describe('writeParticleInstances', () => {
  it('writes position, colour, alpha and radius for one freshly spawned particle', () => {
    const ps = new ParticleSystem(8, () => '#00FF80');
    ps.spawn(makeSpec({ size_px: 4, color_over_life: ['x'] }), 10, 20, 0, 1, 5, 0);
    const out = buffers(8);
    const count = writeParticleInstances(ps, out);
    expect(count).toBe(1);
    expect(out.positions[0]).toBe(10);
    expect(out.positions[1]).toBeCloseTo(PARTICLE_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, 5);
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

  it('visits both draw layers into the same buffer -- Pixi\'s below/above split does not survive here', () => {
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    ps.spawn(makeSpec(), 1, 1, 0, 1, 5, 0); // layer 0 (below)
    ps.spawn(makeSpec(), 2, 2, 0, 1, 5, 1); // layer 1 (above)
    const out = buffers(8);
    const count = writeParticleInstances(ps, out);
    expect(count).toBe(2);
    const xs = [out.positions[0], out.positions[3]];
    expect(xs).toContain(1);
    expect(xs).toContain(2);
  });

  it('stops at the output buffer\'s own capacity rather than overrunning it', () => {
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    for (let i = 0; i < 5; i++) ps.spawn(makeSpec(), i, i, 0, 1, 5, 0);
    const out = buffers(2);
    const count = writeParticleInstances(ps, out);
    expect(count).toBe(2);
  });

  it('skips a particle whose alpha or radius has collapsed, matching forEachLive itself', () => {
    const ps = new ParticleSystem(8, () => '#FFFFFF');
    ps.spawn(makeSpec({ lifetime_ms: 10 }), 5, 5, 0, 1, 5, 0);
    ps.step(1); // well past its 10ms lifetime -> retired, liveCount back to 0
    const out = buffers(8);
    expect(writeParticleInstances(ps, out)).toBe(0);
  });
});

describe('PARTICLE_CAPACITY', () => {
  it('matches the capacity Pixi builds its own ParticleSystem with (renderer.ts:644)', () => {
    expect(PARTICLE_CAPACITY).toBe(2048);
  });
});

describe('tracerQuadPositions', () => {
  it('lifts every vertex by the documented tracer lift, and by exactly one pixel more than a particle\'s', () => {
    const t = spawnTracer(0, 0, 5, 0, 0);
    const p = tracerQuadPositions(t);
    const liftY = TRACER_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;
    for (const yIdx of [1, 4, 7, 10]) expect(p[yIdx]).toBeCloseTo(liftY, 5);
    // TRACER_LIFT_PX (4) - PARTICLE_LIFT_PX (3) = 1px, converted the same way.
    expect(liftY - PARTICLE_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL).toBeCloseTo(WORLD_Y_PER_LIFT_PIXEL, 5);
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
      const p = tracerQuadPositions(t);
      // Vertex layout: s0 (0,1,2), s1 (3,4,5), t1 (6,7,8), t0 (9,10,11).
      const s0Screen = { x: isoX(p[0], p[2]), y: isoY(p[0], p[2]) };
      const s1Screen = { x: isoX(p[3], p[5]), y: isoY(p[3], p[5]) };
      const width = Math.hypot(s1Screen.x - s0Screen.x, s1Screen.y - s0Screen.y);
      expect(width).toBeCloseTo(TRACER_WIDTH_PX, 4);
    }
  });

  it('the target end carries the same width offset as the source end (a true rectangle)', () => {
    const t = spawnTracer(1, 1, 6, 9, 0);
    const p = tracerQuadPositions(t);
    // s1 - s0 (width vector at the source) should equal t1 - t0 (width
    // vector at the target) -- both ends offset by the identical perp.
    const sVec = [p[3] - p[0], p[5] - p[2]];
    const tVec = [p[6] - p[9], p[8] - p[11]];
    expect(sVec[0]).toBeCloseTo(tVec[0], 5);
    expect(sVec[1]).toBeCloseTo(tVec[1], 5);
  });

  it('the quad\'s length axis (s0 to t0) reaches exactly the target -- the perp offset cancels', () => {
    const t = spawnTracer(0, 0, 4, 2, 0);
    const p = tracerQuadPositions(t);
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
    const count = writeTracerInstances(tracers, ['#FF0000', '#00FF00'], out);
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
    writeTracerInstances([spawnTracer(0, 0, 1, 0, 0)], ['#FFFFFF', '#FFFFFF'], out);
    for (let v = 0; v < 4; v++) expect(out.alphas[v]).toBeCloseTo(1, 10);
  });

  it('stops at capacity rather than overrunning the output buffers', () => {
    const tracers: TracerModel[] = [
      spawnTracer(0, 0, 1, 0, 0),
      spawnTracer(0, 0, 1, 0, 0),
      spawnTracer(0, 0, 1, 0, 0),
    ];
    const out = tBuffers(2);
    expect(writeTracerInstances(tracers, ['#FFFFFF', '#FFFFFF'], out)).toBe(2);
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
  it('is a fixed, positive ceiling (Pixi\'s own tracer array is unbounded; an InstancedMesh/BufferGeometry cannot be)', () => {
    expect(TRACER_CAPACITY).toBeGreaterThan(0);
    expect(Number.isInteger(TRACER_CAPACITY)).toBe(true);
  });
});

describe('ParticleInstancer construction', () => {
  it('starts with mesh.count 0 and grows to the written instance count on update', () => {
    const instancer = new ParticleInstancer(4);
    expect(instancer.mesh.count).toBe(0);
    const ps = new ParticleSystem(4, () => '#FFFFFF');
    ps.spawn(makeSpec(), 1, 1, 0, 1, 5, 0);
    instancer.update(ps);
    expect(instancer.mesh.count).toBe(1);
  });

  it('drops back to 0 (not a stale frame) when handed a null ParticleSystem', () => {
    const instancer = new ParticleInstancer(4);
    const ps = new ParticleSystem(4, () => '#FFFFFF');
    ps.spawn(makeSpec(), 1, 1, 0, 1, 5, 0);
    instancer.update(ps);
    expect(instancer.mesh.count).toBe(1);
    instancer.update(null);
    expect(instancer.mesh.count).toBe(0);
  });

  it('the particle material is transparent, depth-tested, depth-written and single-sided', () => {
    const instancer = new ParticleInstancer(4);
    const material = instancer.mesh.material;
    expect(Array.isArray(material)).toBe(false);
    const m = material as THREE.Material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(true);
    expect(m.side).toBe(THREE.FrontSide);
  });

  it('mesh is exempt from frustum culling -- particles range across the whole map, not near the origin', () => {
    const instancer = new ParticleInstancer(4);
    expect(instancer.mesh.frustumCulled).toBe(false);
  });
});

describe('TracerBatch construction', () => {
  it('starts with an empty draw range and grows it to match live tracers on update', () => {
    const batch = new TracerBatch(4);
    expect(batch.mesh.geometry.drawRange.count).toBe(0);
    batch.update([spawnTracer(0, 0, 1, 1, 0)], ['#FFFFFF', '#FFFFFF']);
    expect(batch.mesh.geometry.drawRange.count).toBe(6); // one quad = 6 indices
  });

  it('the tracer material is transparent, depth-tested, depth-written and double-sided', () => {
    const batch = new TracerBatch(4);
    const m = batch.mesh.material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(true);
    // Double-sided deliberately -- see fx.ts's own doc comment on
    // createTracerMaterial for why a per-frame, arbitrary-bearing quad
    // cannot reuse the fixed, once-proven winding units/particles rely on.
    expect(m.side).toBe(THREE.DoubleSide);
  });

  it('mesh is exempt from frustum culling, matching ParticleInstancer/UnitInstancer', () => {
    const batch = new TracerBatch(4);
    expect(batch.mesh.frustumCulled).toBe(false);
  });
});
