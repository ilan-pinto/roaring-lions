import { describe, expect, it } from 'vitest';
import { FRAME_MAX_MS, FrameSampler, SAMPLE_CAP } from './perf';

describe('FrameSampler', () => {
  it('takes nearest-rank percentiles to 0.1 ms and empties itself', () => {
    const s = new FrameSampler();
    for (let i = 1; i <= 100; i++) s.add(i); // 1..100 ms
    expect(s.take()).toEqual({ frames: 100, p50: 50, p95: 95, p99: 99 });
    expect(s.count).toBe(0);
    expect(s.take()).toBeNull();
  });

  it('is order-independent and rounds to a tenth', () => {
    const s = new FrameSampler();
    for (const v of [16.66, 33.34, 16.71, 16.69, 50.04]) s.add(v);
    expect(s.take()).toEqual({ frames: 5, p50: 16.7, p95: 50, p99: 50 });
  });

  it('drops a stall, a non-finite value and a non-positive one', () => {
    const s = new FrameSampler();
    for (const v of [FRAME_MAX_MS + 1, 5000, NaN, Infinity, 0, -3]) s.add(v);
    expect(s.count).toBe(0);
    s.add(FRAME_MAX_MS);
    expect(s.count).toBe(1);
  });

  it('keeps the newest SAMPLE_CAP frames', () => {
    const s = new FrameSampler();
    for (let i = 0; i < SAMPLE_CAP + 100; i++) s.add(i < 100 ? 900 : 10);
    const p = s.take();
    expect(p?.frames).toBe(SAMPLE_CAP);
    expect(p?.p99).toBe(10); // the 100 old slow frames fell off
  });

  it('a single sample is every percentile', () => {
    const s = new FrameSampler();
    s.add(12.34);
    expect(s.take()).toEqual({ frames: 1, p50: 12.3, p95: 12.3, p99: 12.3 });
  });
});
