// GH-943 P3 T13 (GH-1152): the submit probe's decisions, each refusal fed the input that trips it. Oracles are literals.
//
// Falsifications (run by hand, in the commit message):
//  - G2: stub the H3 toggle to do nothing (`webgpu-page.ts` `applyVariant`'s 'unit-shadow-off' returns 0 without writing): the page's H3
//    reading then equals the base on every arm, which is `stubbedH3` below, and `deadHypotheses` must name H3. The one-line library
//    mutation `if (base !== undefined && countMoved(base, v)) moved = true;` -> `... moved = false;` turns the "moves on one arm" spec red.
//  - G3: start the profiler after the timed frames: the window then holds only the idle and program lines, which is `idleOnly` below.
//    The library mutation `if (!(frameMs > 0))` -> `if (frameMs < 0)` turns the idle-only spec red.
import { describe, expect, it } from 'vitest';
import type { CpuProfile } from './cpu-profile';
import {
  countsRefusal,
  deadHypotheses,
  drawTypeOf,
  emptyByType,
  fullRefreshSlope,
  hypothesisRows,
  missingHypotheses,
  perPassRefusals,
  settledByCount,
  unsettledRefusals,
  profileRefusal,
  profileTopOf,
  recommendLever,
  timedCells,
  toggleVerdict,
  type PerPass,
  type SubmitArm,
  type SubmitReading,
  type TimedCell,
  type VariantId,
} from './webgpu-submit-probe-lib';

const pp = (shadow: number, scene: number, ao: number, post: number): PerPass => ({
  shadow: { calls: shadow, objects: shadow },
  scene: { calls: scene, objects: scene },
  ao: { calls: ao, objects: ao },
  post: { calls: post, objects: post },
});

function reading(arm: SubmitArm, n: number, variant: VariantId, perPass: PerPass, extra: Partial<SubmitReading> = {}): SubmitReading {
  const calls = perPass.shadow.calls + perPass.scene.calls + perPass.ao.calls + perPass.post.calls;
  return {
    arm,
    n,
    living: n,
    variant,
    applied: variant === 'base' ? 0 : 1,
    settleFrames: 81,
    settled: true,
    perPass,
    calls,
    triangles: calls * 100,
    byType: emptyByType(),
    fullRefresh: null,
    fullReason: null,
    cpuRenderMs: null,
    cpuRenderInclCensusMs: null,
    censusMs: null,
    gpuMs: null,
    profileTop: [],
    ...extra,
  };
}

/** Every arm and count read with every variant, each toggle moving its own pass. */
function healthy(): SubmitReading[] {
  const out: SubmitReading[] = [];
  for (const arm of ['L', 'G'] as const) {
    for (const n of [300, 600]) {
      out.push(reading(arm, n, 'base', pp(n, 2 * n, n, 9)));
      out.push(reading(arm, n, 'decor-props-hidden', pp(n - 50, 2 * n - 100, n - 50, 9)));
      out.push(reading(arm, n, 'unit-shadow-off', pp(40, 2 * n, n, 9)));
      out.push(reading(arm, n, 'ao-hidden', pp(n, 2 * n, 0, 8)));
    }
  }
  return out;
}

/** What the page reads when the H3 toggle is stubbed: its rows are the base's, on every arm and count. */
function stubbedH3(): SubmitReading[] {
  const rows = healthy();
  return rows.map((r) => (r.variant === 'unit-shadow-off' ? { ...(rows.find((b) => b.arm === r.arm && b.n === r.n && b.variant === 'base') as SubmitReading), variant: 'unit-shadow-off' as const, applied: 0 } : r));
}

const cell = (arm: SubmitArm, n: number, variant: VariantId, value: number, spread = 0.1): TimedCell => ({ arm, n, variant, cpuRender: { value, spread, rounds: 6 } });

describe('drawTypeOf', () => {
  it('batched before skinned before instanced before the material', () => {
    const node = { isNodeMaterial: true };
    expect(drawTypeOf({ isBatchedMesh: true, material: node })).toBe('batchedEntry');
    expect(drawTypeOf({ isSkinnedMesh: true, material: node })).toBe('skinned');
    expect(drawTypeOf({ isInstancedMesh: true, material: node })).toBe('instanced');
    expect(drawTypeOf({ material: node })).toBe('nodeMesh');
    expect(drawTypeOf({ material: [node] })).toBe('nodeMesh');
    expect(drawTypeOf({ material: {} })).toBe('stockMesh');
    expect(drawTypeOf({})).toBe('stockMesh');
  });
});

describe('perPassRefusals (G1 at run time)', () => {
  it('a node reading whose passes sum to the frame counter passes; L is not read', () => {
    expect(perPassRefusals(healthy())).toEqual([]);
  });
  it('a node reading whose passes do not add up refuses, naming both numbers', () => {
    const bad = { ...reading('G', 600, 'base', pp(600, 1200, 600, 9)), calls: 2400 };
    expect(perPassRefusals([bad])).toEqual(['G n600 base: the per-pass calls sum to 2409, the frame counter reads 2400 (the passes do not add up)']);
  });
  it('a node reading with no per-pass counts refuses', () => {
    expect(perPassRefusals([{ ...reading('G', 300, 'base', pp(1, 1, 1, 1)), perPass: null }])).toEqual(['G n300 base: no per-pass counts on a node arm']);
  });
});

describe('deadHypotheses (G2: each hypothesis moves the frame)', () => {
  it('every toggle moved its pass: none is dead', () => {
    expect(deadHypotheses(healthy())).toEqual([]);
  });
  it('the H3 toggle stubbed to do nothing: H3 is dead', () => {
    expect(deadHypotheses(stubbedH3())).toEqual(['H3']);
  });
  it('a toggle that moved the count on ONE arm and count is alive', () => {
    const rows = stubbedH3().map((r) => (r.arm === 'G' && r.n === 600 && r.variant === 'unit-shadow-off' ? reading('G', 600, 'unit-shadow-off', pp(40, 1200, 600, 9)) : r));
    expect(deadHypotheses(rows)).toEqual([]);
  });
  it('a toggle that moved only the COST (outside both spreads) is alive', () => {
    const cells = [cell('G', 600, 'base', 16), cell('G', 600, 'unit-shadow-off', 14)];
    expect(deadHypotheses(stubbedH3(), cells)).toEqual([]);
  });
  it('a cost change inside the spread does not count', () => {
    const cells = [cell('G', 600, 'base', 16, 0.5), cell('G', 600, 'unit-shadow-off', 15.8, 0.5)];
    expect(deadHypotheses(stubbedH3(), cells)).toEqual(['H3']);
  });
  it('a hypothesis never read is missing, not dead', () => {
    const rows = healthy().filter((r) => r.variant !== 'ao-hidden');
    expect(deadHypotheses(rows)).toEqual([]);
    expect(missingHypotheses(rows)).toEqual(['H4']);
    expect(missingHypotheses(healthy())).toEqual([]);
  });
});

/** The z0.5 shape: the AO pre-pass is skipped (zoom fade weight 0), so every base draws 0 AO calls and the H4 toggle moves nothing. */
function aoSkipped(): SubmitReading[] {
  return healthy().map((r) => {
    if (r.perPass === null) return r;
    const p = { ...r.perPass, ao: { calls: 0, objects: 0 } };
    const fixed = reading(r.arm, r.n, r.variant, p);
    return r.variant === 'ao-hidden' ? reading(r.arm, r.n, 'ao-hidden', { ...(healthy().find((b) => b.arm === r.arm && b.n === r.n && b.variant === 'base')?.perPass as PerPass), ao: { calls: 0, objects: 0 } }) : fixed;
  });
}

describe('settledByCount (a toggle whose pass is already empty) and the settle refusal', () => {
  it('every base draws 0 AO calls: H4 is settled by the count, not dead, and its row says so', () => {
    const rows = aoSkipped();
    expect(settledByCount(rows)).toEqual(['H4']);
    expect(deadHypotheses(rows)).toEqual([]);
    const table = hypothesisRows({ readings: rows, cells: [], counts: [300, 600] });
    expect(table.find((r) => r.hypothesis === 'H4' && r.n === 600)?.verdict).toMatch(/^settled by the count: the ao pass draws 0 calls in every base reading/);
  });
  it('one base with an AO call and the same silent toggle: H4 is dead', () => {
    // L n300 draws one AO call in its base AND under the toggle (the toggle is silent there too).
    const rows = aoSkipped().map((r) => (r.arm === 'L' && r.n === 300 && (r.variant === 'base' || r.variant === 'ao-hidden') ? reading('L', 300, r.variant, { ...(r.perPass as PerPass), ao: { calls: 1, objects: 1 } }) : r));
    expect(settledByCount(rows)).toEqual([]);
    expect(deadHypotheses(rows)).toContain('H4');
  });
  it('the H3 toggle stubbed is still dead on the z0.5 shape (the exemption is per pass)', () => {
    const rows = aoSkipped().map((r) => (r.variant === 'unit-shadow-off' ? { ...(aoSkipped().find((b) => b.arm === r.arm && b.n === r.n && b.variant === 'base') as SubmitReading), variant: 'unit-shadow-off' as const } : r));
    expect(deadHypotheses(rows)).toEqual(['H3']);
  });
  it('a reading of a scene that never settled refuses', () => {
    expect(unsettledRefusals(healthy())).toEqual([]);
    expect(unsettledRefusals([{ ...reading('G', 600, 'base', pp(1, 1, 1, 1)), settled: false, settleFrames: 900 }])).toEqual(['G n600 base: the unit scene was still changing after 900 frames']);
  });
});

/** A profile of `samples`, each node a function in `url`. */
function profile(fns: { name: string; url: string; us: number }[]): CpuProfile {
  const nodes = [{ id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 } }, ...fns.map((f, i) => ({ id: i + 2, callFrame: { functionName: f.name, url: f.url, lineNumber: 9 } }))];
  return { nodes, samples: fns.map((_, i) => i + 2), timeDeltas: fns.map((f) => f.us), startTime: 0, endTime: fns.reduce((n, f) => n + f.us, 0) };
}
const covered = profile([
  { name: '(idle)', url: '', us: 4000 },
  { name: 'needsRefresh', url: 'http://localhost:5199/node_modules/.vite/deps/three_webgpu.js?v=1', us: 3000 },
  { name: 'frame', url: 'http://localhost:5199/@fs/repo/packages/render/src/three/ThreeRenderer.ts', us: 2000 },
]);
/** The profiler started after the timed frames: the window holds the idle and the program lines only. */
const idleOnly = profile([
  { name: '(idle)', url: '', us: 9000 },
  { name: '(program)', url: '', us: 500 },
]);

describe('profileRefusal (G3: the profile is not empty)', () => {
  it('a profile with samples in the frame code passes', () => {
    expect(profileRefusal(covered, 'G n600')).toBeNull();
  });
  it('no profile, no nodes, 0 samples: each refuses', () => {
    expect(profileRefusal(null, 'G n600')).toBe('G n600: the profile is empty');
    expect(profileRefusal({ nodes: [], samples: [], timeDeltas: [], startTime: 0, endTime: 0 }, 'G n600')).toBe('G n600: the profile is empty');
    expect(profileRefusal({ ...covered, samples: [], timeDeltas: [] }, 'G n600')).toBe('G n600: the profile has 0 samples');
  });
  it('the profiler started after the timed frames (idle and program only): refuses', () => {
    expect(profileRefusal(idleOnly, 'G n600')).toMatch(/no sample of the profile \(2\) lands in the frame's code/);
  });
  it('profileTopOf leaves the idle line out and keeps self ms', () => {
    expect(profileTopOf(covered)).toEqual([
      { fn: 'needsRefresh', file: 'deps/three_webgpu.js', selfMs: 3 },
      { fn: 'frame', file: 'three/ThreeRenderer.ts', selfMs: 2 },
    ]);
  });
});

describe('H2: FULL refreshes per 300 units', () => {
  it('reads the slope by type from the two base readings', () => {
    const at = (n: number, skinned: number, nodeMesh: number): SubmitReading => reading('G', n, 'base', pp(1, 1, 1, 1), { fullRefresh: { ...emptyByType(), skinned, nodeMesh, stockMesh: 10 } });
    expect(fullRefreshSlope([at(300, 900, 400), at(600, 1800, 700)], 'G', 300, 600)).toEqual({ batchedEntry: 0, skinned: 900, instanced: 0, nodeMesh: 300, stockMesh: 0 });
    expect(fullRefreshSlope([reading('G', 300, 'base', pp(1, 1, 1, 1))], 'G', 300, 600)).toBeNull();
  });
});

describe('timing: the cells, the verdicts and the lever', () => {
  it('timedCells takes the median of each round, then the median and spread of those', () => {
    const r = (v: number): SubmitReading => reading('G', 600, 'base', pp(1, 1, 1, 1), { cpuRenderMs: v });
    const cells = timedCells([
      { round: 0, readings: [r(10)] },
      { round: 0, readings: [r(12)] },
      { round: 1, readings: [r(14)] },
      { round: 2, readings: [r(13)] },
    ]);
    expect(cells).toEqual([{ arm: 'G', n: 600, variant: 'base', cpuRender: { value: 13, spread: 3, rounds: 3 } }]);
  });

  // L 4.10 / 8.37 and G 9.25 / 16.13 ms at n300 / n600 (the P2 sheet's base).
  const base = [cell('L', 300, 'base', 4.1), cell('L', 600, 'base', 8.37), cell('G', 300, 'base', 9.25), cell('G', 600, 'base', 16.13)];
  it('a toggle that takes the per-unit cost off G moves the n600 ratio', () => {
    const cells = [...base, cell('L', 300, 'unit-shadow-off', 3.6), cell('L', 600, 'unit-shadow-off', 7.3), cell('G', 300, 'unit-shadow-off', 7.5), cell('G', 600, 'unit-shadow-off', 11.0)];
    expect(toggleVerdict(healthy(), cells, 'unit-shadow-off', 300, 600)).toMatch(/^MOVES the n600 ratio: G\/L x1\.927 -> x1\.507/);
    expect(recommendLever(healthy(), cells, 300, 600)).toMatch(/^H3 \(the shadow pass: unit castShadow off\): it closes 4\.06 ms of the n600 G-L gap of 7\.76 ms \(52%\)/);
  });
  it('a toggle that takes a fixed cost off G moves only the intercept', () => {
    const cells = [...base, cell('L', 300, 'ao-hidden', 4.1), cell('L', 600, 'ao-hidden', 8.37), cell('G', 300, 'ao-hidden', 8.75), cell('G', 600, 'ao-hidden', 15.63)];
    expect(toggleVerdict(healthy(), cells, 'ao-hidden', 300, 600)).toMatch(/^only the intercept/);
  });
  it('counts only: the verdict and the lever say so', () => {
    expect(toggleVerdict(healthy(), [], 'ao-hidden', 300, 600)).toBe('counts only: G calls -601, L calls -601');
    expect(recommendLever(healthy(), [], 300, 600)).toMatch(/^counts only \(no timing\)/);
  });
  it('the table has every hypothesis, H6 marked not run without the hold', () => {
    const rows = hypothesisRows({ readings: healthy(), cells: [], counts: [300, 600] });
    expect([...new Set(rows.map((r) => r.hypothesis))]).toEqual(['H1', 'H3', 'H4', 'H2', 'H5', 'H6']);
    expect(rows.find((r) => r.hypothesis === 'H6')?.verdict).toBe('not run (needs the Metal hold)');
  });
});

describe('--counts (CodeRabbit on PR 1203)', () => {
  it('needs two distinct positive integer counts: one, a repeat, zero, a fraction and NaN all refuse', () => {
    expect(countsRefusal([300, 600])).toBeNull();
    expect(countsRefusal([300])).toMatch(/two distinct/);
    expect(countsRefusal([300, 300])).toMatch(/two distinct/);
    expect(countsRefusal([0, 600])).toMatch(/positive integer/);
    expect(countsRefusal([300.5, 600])).toMatch(/positive integer/);
    expect(countsRefusal([Number('x'), 600])).toMatch(/positive integer/);
  });
});
