/**
 * GH-1223 slice 1: the ragdoll world's determinism, against the REAL Rapier (the deterministic compat build loads in
 * Node). Design section 2: same inputs give the same bits; frame cadence changes nothing (the sim clock does); an
 * unrelated incident changes nothing (one world per incident); every incident freezes inside 240 steps.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, type Rapier } from './rapier';
import {
  MAX_STEPS,
  POSE_STRIDE,
  RagdollIncident,
  poseDigest,
  stepsOwed,
  type IncidentSpec,
  type RagdollBodySpec,
  type RagdollFigureSpec,
  type V3,
} from './ragdoll-world';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const UP_Q: readonly [number, number, number, number] = [0, 0, 0, 1];

/** A 10-body standing figure at (x, z), a stand-in for `ragdoll-rig.ts`'s output: pelvis, spine, head, two arms of
 *  two, two legs of two. Hinges at the elbows and knees. */
function figure(x: number, z: number, push: V3): RagdollFigureSpec {
  const bodies: RagdollBodySpec[] = [];
  const add = (parent: number, at: V3, len: number, r: number, hinge: V3 | null, down = false): number => {
    const cy = at[1] + (down ? -len / 2 : len / 2);
    bodies.push({
      parent,
      at,
      capsule: { centre: [at[0], cy, at[2]], rot: UP_Q, halfHeight: Math.max(0.01, len / 2 - r), radius: r },
      hinge,
      linvel: push,
      angvel: [0, 0, 0.3],
    });
    return bodies.length - 1;
  };
  const pelvis = add(-1, [x, 0.95, z], 0.2, 0.12, null);
  const spine = add(pelvis, [x, 1.1, z], 0.4, 0.13, null);
  add(spine, [x, 1.5, z], 0.25, 0.1, null);
  for (const s of [-1, 1]) {
    const ua = add(spine, [x, 1.45, z + s * 0.22], 0.3, 0.05, null, true);
    add(ua, [x, 1.15, z + s * 0.22], 0.3, 0.045, [0, 0, 1], true);
    const th = add(pelvis, [x, 0.9, z + s * 0.1], 0.42, 0.07, null, true);
    add(th, [x, 0.48, z + s * 0.1], 0.42, 0.055, [0, 0, 1], true);
  }
  return { bodies };
}

function ground(cx: number, cz: number, half = 6): IncidentSpec['ground'] {
  return {
    vertices: new Float32Array([cx - half, 0, cz - half, cx + half, 0, cz - half, cx + half, 0, cz + half, cx - half, 0, cz + half]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
  };
}

function incident(t0Ms: number, x = 0, z = 0): RagdollIncident {
  return new RagdollIncident(R, {
    t0Ms,
    figures: [figure(x, z, [1.1, 0.4, 0.2]), figure(x + 0.7, z + 0.3, [0.9, 0.5, -0.3])],
    ground: ground(x, z),
    boxes: [{ centre: [x + 1.6, 1, z], half: [0.3, 1, 1] }],
  });
}

/** The pose bits after 2 s, with the frames falling every `cadenceMs` (a list, cycled). */
function runTo(simEndMs: number, cadenceMs: readonly number[], t0Ms = 200): string {
  const inc = incident(t0Ms);
  let t = 0;
  let k = 0;
  while (t < simEndMs) {
    t = Math.min(simEndMs, t + cadenceMs[k++ % cadenceMs.length]);
    inc.advanceTo(t);
  }
  const d = poseDigest(inc.snapshot());
  inc.dispose();
  return d;
}

/** The committed bits of the steady-cadence run. `pnpm test` runs this on macOS for developers and on Linux in CI, so
 *  a platform where the deterministic build differs fails here, by name. */
const PINNED_DIGEST = '30bba41d';

describe('the step count is the sim clock in integers', () => {
  it('three steps a tick, exactly on the tick (no float landing a hair short)', () => {
    expect(stepsOwed(200, 0)).toBe(12);
    expect(stepsOwed(50 * 7919, 0)).toBe(3 * 7919);
    expect(stepsOwed(16, 0)).toBe(0);
    expect(stepsOwed(17, 0)).toBe(1);
    expect(stepsOwed(100, 200)).toBe(0);
  });
});

describe('determinism (design section 2)', () => {
  it('the same incident run twice gives bit-identical body poses, and the committed bits', () => {
    const a = runTo(2_000, [50]);
    const b = runTo(2_000, [50]);
    expect(a).toBe(b);
    expect(a).toBe(PINNED_DIGEST);
  });

  it('frame cadence changes nothing: 16.7 ms, 7 ms and a jittered 5-40 ms land on the same bits', () => {
    const steady = runTo(2_000, [50 / 3]);
    expect(runTo(2_000, [7])).toBe(steady);
    expect(runTo(2_000, [5, 40, 13, 31, 9, 22, 37, 6])).toBe(steady);
    expect(runTo(2_000, [50])).toBe(steady);
  });

  it('an unrelated death does not change an incident: its own world, whatever else is stepping', () => {
    const alone = runTo(2_000, [50]);
    const others = [incident(0, 30, 30), incident(100, -20, 5), incident(350, 3, 3)];
    const mine = incident(200);
    for (let t = 0; t <= 2_000; t += 50) {
      for (const o of others) o.advanceTo(t);
      mine.advanceTo(t);
    }
    expect(poseDigest(mine.snapshot())).toBe(alone);
    for (const o of [...others, mine]) o.dispose();
  });

  it('nothing moves before the handoff, and a step is owed only once the sim reaches it', () => {
    const inc = incident(1_000);
    const before = inc.snapshot();
    expect(inc.advanceTo(999)).toBe(0);
    expect(inc.snapshot()).toEqual(before);
    expect(inc.advanceTo(1_050)).toBe(3);
    inc.dispose();
  });
});

describe('settle and freeze (design section 2, rule 6)', () => {
  it('freezes within 240 steps, frees its world, and holds the pose after', () => {
    const inc = incident(0);
    inc.advanceTo(10_000);
    expect(inc.frozen).toBe(true);
    expect(inc.steps).toBeLessThanOrEqual(MAX_STEPS);
    const held = inc.snapshot();
    expect(inc.advanceTo(20_000)).toBe(0);
    expect(inc.poseAt(20_000, new Float64Array(held.length))).toEqual(held);
    // Every body ends above the ground (y = 0), none fallen through.
    for (let k = 0; k < inc.bodyCount; k++) expect(held[k * POSE_STRIDE + 1]).toBeGreaterThan(0);
  });

  it('the drawn pose is a pure function of the sim time, between the last two steps', () => {
    const inc = incident(0);
    inc.advanceTo(500);
    const a = inc.poseAt(500, new Float64Array(inc.bodyCount * POSE_STRIDE));
    const b = inc.poseAt(500, new Float64Array(inc.bodyCount * POSE_STRIDE));
    expect(a).toEqual(b);
    inc.dispose();
  });
});
