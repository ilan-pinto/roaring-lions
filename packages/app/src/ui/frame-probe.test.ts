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
  describe('a route that is not known yet (GH-1413 follow-up: a deep link, or a click during the leave animation)', () => {
    it('is not "left the shell": the frames are skipped, nothing is voided, and a slow sample is still found once the route is known', () => {
      // A deep link: `steady` is false (no route yet) and `pending` is true for 50 frames, then the shell route mounts.
      let known = false;
      const h = harness({ steady: () => known, pending: () => !known });
      for (let i = 0; i < 50; i++) h.frame(i * 16);
      expect(h.results).toEqual([]);
      known = true;
      const t0 = 50 * 16;
      for (let i = 0; i <= PROBE_WARMUP_FRAMES + PROBE_SAMPLE_FRAMES; i++) h.frame(t0 + i * 40);
      expect(h.results).toHaveLength(1);
      const r = h.results[0];
      expect(r.kind).toBe('sample');
      if (r.kind === 'sample') expect(r.stats.medianMs).toBe(40);
    });
    it('the frames of the pending window are not part of the sample', () => {
      let known = false;
      const h = harness({ pending: () => !known });
      for (let i = 0; i < 40; i++) h.frame(i * 400, 0); // slow, and pending: none of it counts (the give-up clock is held at 0)
      known = true;
      const t0 = 40 * 400;
      for (let i = 0; i <= PROBE_WARMUP_FRAMES + PROBE_SAMPLE_FRAMES; i++) h.frame(t0 + i * 16.7, 0);
      const r = h.results[0];
      expect(r.kind === 'sample' && r.stats.medianMs).toBeCloseTo(16.7, 5);
    });
    it('a pending interval of 2 s or more is not a stall', () => {
      let known = false;
      const h = harness({ pending: () => !known });
      h.frame(0);
      h.frame(3000);
      h.frame(6000);
      expect(h.results).toEqual([]);
      known = true;
      h.frame(6016);
      h.frame(6032);
      expect(h.results).toEqual([]);
    });
    it('the warm-up starts over when the route becomes known', () => {
      // 25 fast frames, then 10 pending ones, then the route is known: 60 slow frames, 90 fast. With a warm-up that restarted, 30 of the
      // slow frames are warm-up and the sample holds 30 slow + 60 fast (a fast median); a warm-up that did not restart would count 55 slow.
      let pending = false;
      const h = harness({ pending: () => pending });
      let ts = 0;
      for (let i = 0; i < 25; i++) h.frame((ts += 16.7), 0);
      pending = true;
      for (let i = 0; i < 10; i++) h.frame((ts += 16.7), 0);
      pending = false;
      h.frame((ts += 200), 0); // sets the clock again
      for (let i = 0; i < 60; i++) h.frame((ts += 200), 0);
      for (let i = 0; i < 90; i++) h.frame((ts += 16.7), 0);
      const r = h.results[0];
      expect(r.kind === 'sample' && r.stats.medianMs).toBeCloseTo(16.7, 5);
    });
    it('a pending window in the middle of a sample throws away what was gathered, and its gap is not a stall', () => {
      // 100 slow frames (30 of warm-up, 70 counted), then 3 s pending, then the route is known again: fast frames. The 70 old slow
      // intervals must not sit in the new sample (they would make 70 slow against 20 fast), and the 3 s gap must not void it.
      let pending = false;
      const h = harness({ pending: () => pending });
      let ts = 0;
      for (let i = 0; i < 100; i++) h.frame((ts += 100), 0);
      pending = true;
      h.frame((ts += 3000), 0);
      pending = false;
      for (let i = 0; i <= PROBE_WARMUP_FRAMES + PROBE_SAMPLE_FRAMES; i++) h.frame((ts += 16.7), 0);
      const r = h.results[0];
      expect(r.kind).toBe('sample');
      expect(r.kind === 'sample' && r.stats.medianMs).toBeCloseTo(16.7, 5);
    });
    it('a mission that mounts next still voids the sample', () => {
      let pending = true;
      let steady = false;
      const h = harness({ pending: () => pending, steady: () => steady });
      for (let i = 0; i < 20; i++) h.frame(i * 16);
      expect(h.results).toEqual([]);
      pending = false; // the route mounted, and it is a battlefield: `steady` stays false
      h.frame(21 * 16);
      expect(h.results).toEqual([{ kind: 'void', why: 'left' }]);
      steady = true;
    });
    it('a hidden tab still voids a pending probe, and a route that never resolves ends it at the give-up', () => {
      let hidden = false;
      const a = harness({ pending: () => true, visible: () => !hidden });
      a.frame(0);
      hidden = true;
      a.frame(16);
      expect(a.results).toEqual([{ kind: 'void', why: 'hidden' }]);
      const b = harness({ pending: () => true, steady: () => false });
      b.frame(0, 0);
      b.frame(1000, 12001);
      expect(b.results).toEqual([{ kind: 'void', why: 'gave-up' }]);
    });
    it('no pending function at all behaves as before (a false steady voids at once)', () => {
      const h = harness({ steady: () => false });
      h.frame(0);
      expect(h.results).toEqual([{ kind: 'void', why: 'left' }]);
    });
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
