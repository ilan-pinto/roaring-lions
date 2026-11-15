/**
 * GH-1410: frame-time percentiles for the `perf_sample` event. Pure; the loop that feeds it is in `main.ts`, the sampling cadence
 * is in `index.ts`. A frame is the wall time between two consecutive `requestAnimationFrame` callbacks, the interval a player feels.
 */

/** A frame longer than this is a stalled or hidden tab, not a frame: it is dropped, not sampled. */
export const FRAME_MAX_MS = 1000;
/** The ring's size: 60 s at 60 fps, plenty for a 120 s window at the rates this game runs. */
export const SAMPLE_CAP = 8192;

export interface Percentiles {
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

const tenth = (n: number): number => Math.round(n * 10) / 10;

/** Nearest-rank percentile of an ascending array. */
function rank(sorted: readonly number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i] as number;
}

export class FrameSampler {
  private samples: number[] = [];

  get count(): number {
    return this.samples.length;
  }

  add(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > FRAME_MAX_MS) return;
    this.samples.push(frameMs);
    if (this.samples.length > SAMPLE_CAP) this.samples.splice(0, this.samples.length - SAMPLE_CAP);
  }

  /** The percentiles of what was sampled, to 0.1 ms, and empties the ring. Null when nothing was. */
  take(): Percentiles | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.samples = [];
    return { frames: sorted.length, p50: tenth(rank(sorted, 0.5)), p95: tenth(rank(sorted, 0.95)), p99: tenth(rank(sorted, 0.99)) };
  }
}
