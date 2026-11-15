// The boot frame-time probe (GH-1413). Every expectation is a literal; each was seen red under a one-line mutation of
// `frame-probe.ts` (listed in the commit that landed it).
import { describe, expect, it } from 'vitest';
import {
  PROBE_GIVE_UP_MS,
  PROBE_SAMPLE_FRAMES,
  PROBE_WARMUP_FRAMES,
  SLOW_FRAME_MS,
  SLOW_MEDIAN_MS,
  STALL_MS,
  frameStats,
  framesRunSlow,
  sampleFrames,
  type ProbeDeps,
  type ProbeResult,
} from './frame-probe';

/** `n` intervals: the first `slow` are `slowMs`, the rest `fastMs`, interleaved so no run is all-slow. */
function series(n: number, slow: number, slowMs: number, fastMs: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i * slow) % n < slow ? slowMs : fastMs);
  return out;
}

describe('the thresholds are the ones the doc reads off (docs/PERFORMANCE.md), as literals', () => {
  it('names them', () => {
    expect(SLOW_FRAME_MS).toBe(33.4);
    expect(SLOW_MEDIAN_MS).toBe(33.4);
    expect(PROBE_WARMUP_FRAMES).toBe(30);
    expect(PROBE_SAMPLE_FRAMES).toBe(90);
    expect(STALL_MS).toBe(2000);
    expect(PROBE_GIVE_UP_MS).toBe(12000);
  });
});

describe('frameStats', () => {
  it('the median of an odd count is the middle value, of an even count the mean of the two', () => {
    expect(frameStats([10, 30, 20]).medianMs).toBe(20);
    expect(frameStats([10, 20, 30, 40]).medianMs).toBe(25);
  });
  it('an empty sample is zero frames and never slow', () => {
    expect(frameStats([])).toEqual({ frames: 0, medianMs: 0, slowShare: 0 });
    expect(framesRunSlow(frameStats([]))).toBe(false);
  });
  it('the slow share counts intervals strictly over 33.4 ms', () => {
    expect(frameStats([33.4, 33.4, 33.5, 100]).slowShare).toBe(0.5);
  });
});

describe('framesRunSlow: a verdict is the MEDIAN over a FULL sample', () => {
  const full = PROBE_SAMPLE_FRAMES;
  it('steady 60 Hz is not slow', () => expect(framesRunSlow(frameStats(series(full, 0, 100, 16.7)))).toBe(false));
  it('the reference M3 Pro Retina opening (18% of intervals over 33.4 ms, PERFORMANCE.md) is NOT slow: the declined 5% rule fired here', () => {
    const s = frameStats(series(full, 16, 60, 16.7)); // 16 of 90 = 17.8%
    expect(s.slowShare).toBeGreaterThan(0.05);
    expect(framesRunSlow(s)).toBe(false);
  });
  it('the worst throttled cell (64.8% of intervals over 33.4 ms) IS slow', () => {
    const s = frameStats(series(full, 58, 90, 16.7)); // 58 of 90 = 64.4%
    expect(s.slowShare).toBeGreaterThan(0.6);
    expect(framesRunSlow(s)).toBe(true);
  });
  it('exactly half slow is the edge: a median at the line is slow, just under it is not', () => {
    expect(framesRunSlow({ frames: full, medianMs: 33.4, slowShare: 0.5 })).toBe(true);
    expect(framesRunSlow({ frames: full, medianMs: 33.3, slowShare: 0.49 })).toBe(false);
  });
  it('a median, not a mean: three 500 ms hitches in a steady 16.7 ms sample do not make it slow', () => {
    const xs = series(full, 0, 0, 16.7);
    xs[3] = xs[40] = xs[77] = 500;
    expect(frameStats(xs).slowShare).toBeLessThan(0.05);
    expect(framesRunSlow(frameStats(xs))).toBe(false);
  });
  it('a short sample is never slow, whatever it says: one frame short of full is not a verdict', () => {
    expect(framesRunSlow(frameStats(series(full - 1, 0, 0, 200)))).toBe(false);
    expect(framesRunSlow(frameStats(series(full, 0, 0, 200)))).toBe(true);
  });
});

/** A fake clock and frame source: `play` feeds the callbacks the timestamps in order. */
function harness(over: Partial<ProbeDeps> = {}) {
  let cb: ((ts: number) => void) | null = null;
  let nextId = 1;
  const cancelled: number[] = [];
  let wall = 0;
  const deps: ProbeDeps = {
    raf: (f) => {
      cb = f;
      return nextId++;
    },
    cancel: (id) => {
      cancelled.push(id);
      cb = null;
    },
    now: () => wall,
    visible: () => true,
    steady: () => true,
    ...over,
  };
  const results: ProbeResult[] = [];
  const stop = sampleFrames(deps, (r) => results.push(r));
  /** Deliver one frame at `ts`; `wallMs` moves the give-up clock. */
  const frame = (ts: number, wallMs = ts): void => {
    wall = wallMs;
    const f = cb;
    if (f !== null) f(ts);
  };
  return { frame, results, cancelled, stop, pending: () => cb !== null };
}

describe('sampleFrames', () => {
  const total = 1 + PROBE_WARMUP_FRAMES + PROBE_SAMPLE_FRAMES; // the first frame sets the clock, then warmup, then the sample
  it('drops the first frames, measures the next 90 and then stops asking for frames', () => {
    const h = harness();
    for (let i = 0; i < total - 1; i++) h.frame(i * 40);
    expect(h.results).toEqual([]);
    h.frame((total - 1) * 40);
    expect(h.results).toHaveLength(1);
    const r = h.results[0];
    expect(r.kind).toBe('sample');
    if (r.kind === 'sample') expect(r.stats).toEqual({ frames: PROBE_SAMPLE_FRAMES, medianMs: 40, slowShare: 1 });
    expect(h.pending()).toBe(false);
  });
  it('the warmup intervals do not count: a slow start then 16.7 ms frames is a fast sample', () => {
    const h = harness();
    let ts = 0;
    h.frame(ts);
    for (let i = 0; i < PROBE_WARMUP_FRAMES; i++) h.frame((ts += 200));
    for (let i = 0; i < PROBE_SAMPLE_FRAMES; i++) h.frame((ts += 16.7), ts);
    const r = h.results[0];
    expect(r.kind === 'sample' && r.stats.medianMs).toBeCloseTo(16.7, 5);
  });
  it('a hidden tab voids the sample', () => {
    let hidden = false;
    const h = harness({ visible: () => !hidden });
    for (let i = 0; i < 10; i++) h.frame(i * 16);
    hidden = true;
    h.frame(200);
    expect(h.results).toEqual([{ kind: 'void', why: 'hidden' }]);
  });
  it('one stalled interval (2 s) voids the sample, and 1999 ms does not', () => {
    const a = harness();
    a.frame(0);
    a.frame(2000);
    expect(a.results).toEqual([{ kind: 'void', why: 'stall' }]);
    const b = harness();
    b.frame(0);
    b.frame(1999);
    expect(b.results).toEqual([]);
  });
  it('leaving the shell (into a mission) voids the sample', () => {
    let steady = true;
    const h = harness({ steady: () => steady });
    h.frame(0);
    steady = false;
    h.frame(16);
    expect(h.results).toEqual([{ kind: 'void', why: 'left' }]);
  });
  it('gives up after 12 s without a full sample', () => {
    const h = harness();
    h.frame(0, 0);
    h.frame(1000, 12001);
    expect(h.results).toEqual([{ kind: 'void', why: 'gave-up' }]);
  });
  it('the disposer cancels the loop, reports nothing, and is idempotent', () => {
    const h = harness();
    h.frame(0);
    h.stop();
    h.stop();
    expect(h.pending()).toBe(false);
    expect(h.results).toEqual([]);
    expect(h.cancelled.length).toBe(1);
  });
});
