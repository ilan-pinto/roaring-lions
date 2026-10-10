// `BOOT_FREEZE_INIT_SCRIPT` is a string for `page.addInitScript`, but it only
// names the bare identifiers `window` and `queueMicrotask`, so
// `new Function('window', script)` runs the exact bytes the gate sends into
// the page against a plain object -- the `frame-freeze.test.ts` technique.
//
// What it guards is the `kitted` flake (CI run 38092145339): the frame loop
// must never run a frame between boot and the capture step, and nothing else
// that asks for an animation frame may be starved by the freeze.
import { describe, expect, it, vi } from 'vitest';
import { BOOT_FREEZE_INIT_SCRIPT } from './capture-protocol';

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
