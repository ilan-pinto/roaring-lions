// The boot frame-time probe (GH-1413): a cheap read of how fast this machine presents frames, so the game can SUGGEST a
// lighter preset to a player whose frames run slow. It measures; it decides nothing. `quality-hint.ts` turns a verdict into a
// card the player answers, and a preset is only ever changed by that answer (the lead's ruling of 10 Oct 2026, "nothing
// automatic", `docs/PERFORMANCE.md`).
//
// WHY THE LINE IS "MORE THAN HALF THE FRAMES". The automatic step-down the lead declined (PERFORMANCE.md, "The automatic
// quality step-down") called an opening slow at 5% of intervals over 33.4 ms and was declined because it would have fired on the
// reference machine: an M3 Pro on a Retina screen reads 11-18% at `high` in the heaviest opening, and 3-15% at 1920x1080. The
// throttled cells it was meant to catch read 9.8-64.8% at `high` (4x and 6x CPU throttle). A suggestion the player can refuse is a
// lighter thing than a silent switch, but it must still not nag the machine everyone judges the game on, so this line is the
// MEDIAN interval over 33.4 ms: more than half the frames slow. That is above everything measured on the reference machine and
// catches the worst throttled cells. The thresholds below are those readings turned into constants; nothing here was measured on a
// browser by this change (the cloud has no GPU), and the first real-hardware sweep (GH-1413's dependency) is what confirms them.
//
// THE SAMPLE IS VOIDED, NEVER GUESSED AT. A hidden tab (rAF is throttled to about 1 Hz), a stalled page (one interval of 2 s or
// more: a modal alert, a debugger, a laptop waking) and a player who has gone into a mission (a battlefield boot is slow for
// reasons that are not the machine's) all void it, and a voided sample suggests nothing. A verdict also needs a FULL sample.

/** Frames presented before the first one counts: the page is still painting, fonts and the first route are loading. */
export const PROBE_WARMUP_FRAMES = 30;
/** Intervals measured. About 1.5 s at 60 fps, 3 s at 30, 6 s at 15. */
export const PROBE_SAMPLE_FRAMES = 90;
/** The interval the declined rule and `docs/PERFORMANCE.md` call slow: just over two 60 Hz frames. */
export const SLOW_FRAME_MS = 33.4;
/** The verdict: the median interval at or over this is "frames run slow" (more than half the frames are slow). */
export const SLOW_MEDIAN_MS = SLOW_FRAME_MS;
/** One interval at or over this voids the sample: the page stalled, it was not the machine presenting slowly. */
export const STALL_MS = 2000;
/** The probe gives up after this long without a full sample (a 6 fps machine would need 20 s: a verdict that late is not a boot probe). */
export const PROBE_GIVE_UP_MS = 12000;

export interface FrameStats {
  /** Intervals measured. */
  frames: number;
  medianMs: number;
  /** The share of intervals over `SLOW_FRAME_MS`, 0..1. Reported, not the verdict. */
  slowShare: number;
}

/** The median of `xs` (the mean of the two middle values for an even count); 0 for none. */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function frameStats(intervalsMs: readonly number[]): FrameStats {
  const slow = intervalsMs.filter((x) => x > SLOW_FRAME_MS).length;
  return { frames: intervalsMs.length, medianMs: median(intervalsMs), slowShare: intervalsMs.length === 0 ? 0 : slow / intervalsMs.length };
}

/** True when the sample is full and its median interval says frames run slow. A short sample is never slow. */
export function framesRunSlow(stats: FrameStats): boolean {
  return stats.frames >= PROBE_SAMPLE_FRAMES && stats.medianMs >= SLOW_MEDIAN_MS;
}

export interface ProbeDeps {
  /** `requestAnimationFrame`. The callback gets a timestamp in ms. */
  raf: (cb: (ts: number) => void) => number;
  cancel: (id: number) => void;
  /** Wall clock in ms (`performance.now`), for the give-up timer. */
  now: () => number;
  /** False in a hidden tab. */
  visible: () => boolean;
  /** False once the player is somewhere a sample means nothing (a mission). Asked every frame. */
  steady: () => boolean;
}

export type ProbeResult = { kind: 'sample'; stats: FrameStats } | { kind: 'void'; why: 'hidden' | 'stall' | 'left' | 'gave-up' };

/**
 * Sample `PROBE_SAMPLE_FRAMES` intervals after `PROBE_WARMUP_FRAMES`, then call `done` once. Returns a disposer that cancels
 * the loop (idempotent; `done` is not called after it).
 */
export function sampleFrames(deps: ProbeDeps, done: (r: ProbeResult) => void): () => void {
  let id = 0;
  let stopped = false;
  let seen = 0;
  let last: number | null = null;
  const intervals: number[] = [];
  const started = deps.now();
  const finish = (r: ProbeResult): void => {
    if (stopped) return;
    stopped = true;
    deps.cancel(id);
    done(r);
  };
  const tick = (ts: number): void => {
    if (stopped) return;
    if (!deps.visible()) return finish({ kind: 'void', why: 'hidden' });
    if (!deps.steady()) return finish({ kind: 'void', why: 'left' });
    if (deps.now() - started > PROBE_GIVE_UP_MS) return finish({ kind: 'void', why: 'gave-up' });
    if (last !== null) {
      seen++;
      const dt = ts - last;
      if (dt >= STALL_MS) return finish({ kind: 'void', why: 'stall' });
      if (seen > PROBE_WARMUP_FRAMES) intervals.push(dt);
      if (intervals.length >= PROBE_SAMPLE_FRAMES) return finish({ kind: 'sample', stats: frameStats(intervals) });
    }
    last = ts;
    id = deps.raf(tick);
  };
  id = deps.raf(tick);
  return () => {
    if (stopped) return;
    stopped = true;
    deps.cancel(id);
  };
}
