// `BOOT_FREEZE_INIT_SCRIPT` is a string for `page.addInitScript`, but it only
// names the bare identifiers `window` and `queueMicrotask`, so
// `new Function('window', script)` runs the exact bytes the gate sends into
// the page against a plain object -- the `frame-freeze.test.ts` technique.
//
// What it guards is the `kitted` flake (CI run 38092145339): the frame loop
// must never run a frame between boot and the capture step, and nothing else
// that asks for an animation frame may be starved by the freeze.
import { describe, expect, it, vi } from 'vitest';
import {
  BOOT_FREEZE_INIT_SCRIPT,
  BOOT_SETTLE_FRAME_MS,
  BOOT_SETTLE_PACED_MS,
  BOOT_SETTLE_PACE_MS,
  BOOT_SETTLE_SCRIPT,
  BOOT_SETTLE_TAIL_FRAMES,
  BOOT_SETTLE_TICK,
  SCENARIOS,
  bootFreezeRefusal,
} from './capture-protocol';

interface MockWindow {
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  __lions?: unknown;
  __lionsCaptureFrozen?: boolean;
}

function boot(w: MockWindow): void {
  new Function('window', BOOT_FREEZE_INIT_SCRIPT)(w);
}

function mockWindow(): { w: MockWindow; real: ReturnType<typeof vi.fn> } {
  const real = vi.fn<(cb: FrameRequestCallback) => number>(() => 7);
  return { w: { requestAnimationFrame: real }, real };
}

describe('BOOT_FREEZE_INIT_SCRIPT', () => {
  it('leaves requestAnimationFrame alone until window.__lions is assigned', () => {
    const { w, real } = mockWindow();
    boot(w);
    expect(w.requestAnimationFrame(() => undefined)).toBe(7);
    expect(real).toHaveBeenCalledTimes(1);
    expect(w.__lionsCaptureFrozen).toBeUndefined();
  });

  it("drops the loop's arm -- the rAF call made in the same run as the assignment", () => {
    const { w, real } = mockWindow();
    boot(w);
    const handle = { sim: { tickCount: 0 } };
    // main.ts: `Object.assign(window, { __lions })`, then the boot frame, then
    // `rafId = requestAnimationFrame(loop)`, with no await between.
    Object.assign(w, { __lions: handle });
    const loop = vi.fn();
    expect(w.requestAnimationFrame(loop)).toBe(0);
    expect(real).not.toHaveBeenCalled();
    expect(loop).not.toHaveBeenCalled();
    expect(w.__lions).toBe(handle);
    expect(w.__lionsCaptureFrozen).toBe(true);
  });

  it('passes every later rAF call through to the real one, so deferred work and polling still run', async () => {
    const { w, real } = mockWindow();
    boot(w);
    Object.assign(w, { __lions: {} });
    await Promise.resolve();
    const later = vi.fn();
    expect(w.requestAnimationFrame(later)).toBe(7);
    expect(real).toHaveBeenCalledTimes(1);
    expect(real.mock.calls[0][0]).toBe(later);
  });

  it('does not freeze on an undefined assignment, and the battlefield can still take __lions down', () => {
    const { w, real } = mockWindow();
    boot(w);
    Object.assign(w, { __lions: undefined });
    expect(w.__lionsCaptureFrozen).toBeUndefined();
    expect(w.requestAnimationFrame(() => undefined)).toBe(7);
    expect(real).toHaveBeenCalledTimes(1);
    Object.assign(w, { __lions: { a: 1 } });
    expect(delete w.__lions).toBe(true);
    expect(w.__lions).toBeUndefined();
  });

  it('stands down when a second copy runs in the same document', () => {
    const { w, real } = mockWindow();
    boot(w);
    boot(w);
    Object.assign(w, { __lions: {} });
    expect(w.requestAnimationFrame(() => undefined)).toBe(0);
    expect(real).not.toHaveBeenCalled();
  });
});

describe('BOOT_SETTLE_SCRIPT', () => {
  /** Runs the settle against a fake renderer on a fake clock: every timer
   *  fires at once and advances the clock by its delay, so the paced half
   *  costs no real time and its frame count is exact. */
  async function settle(): Promise<{ frames: Array<[number, number]>; steps: number[]; result: { tick: number } }> {
    let now = 0;
    const frames: Array<[number, number]> = [];
    const sim = { tickCount: 0 };
    const steps: number[] = [];
    const w = {
      __lions: {
        sim,
        step: (n: number) => {
          steps.push(n);
          sim.tickCount += n;
          frames.push([1, -1]);
        },
        renderer: { frame: (a: number, dt: number) => frames.push([a, dt]) },
      },
    };
    const perf = { now: () => now };
    const timeout = (fn: () => void, ms: number): void => {
      now += ms;
      fn();
    };
    const raw = await (new Function('window', 'performance', 'setTimeout', `return ${BOOT_SETTLE_SCRIPT}`)(
      w,
      perf,
      timeout
    ) as Promise<string>);
    return { frames, steps, result: JSON.parse(raw) as { tick: number } };
  }

  it('steps once to the settle tick, then draws a FIXED number of frames at the fixed step without ticking', async () => {
    const { frames, steps, result } = await settle();
    expect(steps).toEqual([BOOT_SETTLE_TICK]);
    // The step's own frame (marked -1 here) comes FIRST, so every settle
    // frame is drawn at the settle tick.
    expect(frames[0]).toEqual([1, -1]);
    const settleFrames = frames.slice(1);
    expect(settleFrames.length).toBe(BOOT_SETTLE_PACED_MS / BOOT_SETTLE_PACE_MS + BOOT_SETTLE_TAIL_FRAMES);
    for (const f of settleFrames) expect(f).toEqual([1, BOOT_SETTLE_FRAME_MS]);
    expect(result.tick).toBe(BOOT_SETTLE_TICK);
  });

  it('settles before every scenario steps or orders anything, so no capture tick is in the past', () => {
    expect(SCENARIOS.length).toBeGreaterThan(0);
    for (const sc of SCENARIOS) {
      expect(sc.targetTick ?? 0, sc.id).toBeGreaterThan(BOOT_SETTLE_TICK);
      if (sc.orders) expect(sc.orders.atTick, sc.id).toBeGreaterThan(BOOT_SETTLE_TICK);
    }
  });

  it('steps at the renderer clamp, so a settle frame is a slow runner frame and not a zero-time repaint', () => {
    expect(BOOT_SETTLE_FRAME_MS).toBe(100);
  });
});

describe('bootFreezeRefusal', () => {
  it('lets a sim standing at the settle tick through, and refuses any other tick by name', () => {
    expect(bootFreezeRefusal(BOOT_SETTLE_TICK)).toBeNull();
    for (const tick of [0, BOOT_SETTLE_TICK - 1, BOOT_SETTLE_TICK + 1, 26]) {
      expect(bootFreezeRefusal(tick)).toContain(`reached tick ${tick}`);
    }
  });
});
