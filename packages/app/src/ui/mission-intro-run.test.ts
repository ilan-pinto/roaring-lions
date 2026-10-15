// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { introPlan, type FoldGeometry, type IntroPlan } from './mission-intro';
import { runMissionIntro, type IntroRun, type IntroScreen } from './mission-intro-run';

const FULL = introPlan({ hasBriefing: true, sandbox: false, room: false, tutorial: false, reduced: false }) as IntroPlan;
const REDUCED = introPlan({ hasBriefing: true, sandbox: false, room: false, tutorial: false, reduced: true }) as IntroPlan;
const GEOMETRY: FoldGeometry = { dx: -400, dy: -90, scale: 1.2, clipBottomPx: 500 };

interface Rig {
  run: IntroRun;
  stage: HTMLElement;
  panes: HTMLElement[];
  leaves: unknown[];
  removed: () => number;
  lands: () => number;
  skips: () => number;
}

let made: IntroRun[] = [];

function rig(plan: IntroPlan, onSkip?: (r: { run: IntroRun | null }) => void): Rig {
  document.body.replaceChildren();
  const stage = document.createElement('div');
  const panes = [document.createElement('div'), document.createElement('div')];
  document.body.append(stage, ...panes);
  const leaves: unknown[] = [];
  let removed = 0;
  let lands = 0;
  let skips = 0;
  const screen: IntroScreen = {
    leave: (mode) => leaves.push(mode),
    boxRect: () => new DOMRect(500, 150, 420, 600),
    remove: () => {
      removed++;
    },
  };
  const holder: { run: IntroRun | null } = { run: null };
  const run = runMissionIntro({
    plan,
    screen,
    body: document.body,
    keep: [stage],
    foldTo: () => GEOMETRY,
    onLand: () => {
      lands++;
    },
    onSkip: () => {
      skips++;
      onSkip?.(holder);
    },
  });
  holder.run = run;
  made.push(run);
  return { run, stage, panes, leaves, removed: () => removed, lands: () => lands, skips: () => skips };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const r of made) r.dispose();
  made = [];
  vi.useRealTimers();
});

describe('the intro timeline', () => {
  it('folds the screen at once and holds every pane but the stage', () => {
    const r = rig(FULL);
    expect(r.leaves).toEqual([{ kind: 'fold', geometry: GEOMETRY }]);
    for (const p of r.panes) expect(p.classList.contains('rl-intro-held')).toBe(true);
    expect(r.stage.classList.contains('rl-intro-held')).toBe(false);
  });

  it('steps the panes in at 520 ms and lands the card at 650, once', () => {
    const r = rig(FULL);
    vi.advanceTimersByTime(519);
    expect(r.panes[0].classList.contains('rl-intro-held')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(r.panes[0].classList.contains('rl-intro-held')).toBe(false);
    expect(r.panes[0].classList.contains('rl-intro-in')).toBe(true);
    vi.advanceTimersByTime(129);
    expect([r.lands(), r.removed()]).toEqual([0, 0]);
    vi.advanceTimersByTime(1);
    expect([r.lands(), r.removed()]).toEqual([1, 1]);
    r.run.finish();
    expect(r.lands()).toBe(1);
    expect(r.panes[0].className).toBe('');
  });

  it('reduced motion: a fade, and at 200 ms the panes CUT in and the card lands', () => {
    const r = rig(REDUCED);
    expect(r.leaves).toEqual([{ kind: 'fade' }]);
    vi.advanceTimersByTime(199);
    expect(r.lands()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(r.lands()).toBe(1);
    expect(r.panes[0].classList.contains('rl-intro-held')).toBe(false);
    expect(r.panes[0].classList.contains('rl-intro-in')).toBe(false);
  });

  it('finish() before the landing lands at once, shows the panes, and arms nothing more', () => {
    const r = rig(FULL);
    vi.advanceTimersByTime(100);
    r.run.finish();
    expect([r.lands(), r.removed()]).toEqual([1, 1]);
    for (const p of r.panes) expect(p.className).toBe('');
    vi.advanceTimersByTime(5000);
    expect(r.lands()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the skip', () => {
  const key = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });

  it('ignores the keydown that is still dispatching when the intro starts (Enter on Deploy)', () => {
    const r = rig(FULL);
    window.dispatchEvent(key());
    expect(r.skips()).toBe(0);
  });

  it('a key is a skip, consumed before any game listener sees it', () => {
    const r = rig(FULL);
    vi.advanceTimersByTime(0);
    const game = vi.fn();
    window.addEventListener('keydown', game);
    const e = key();
    document.body.dispatchEvent(e);
    window.removeEventListener('keydown', game);
    expect(r.skips()).toBe(1);
    expect(game).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it('a press is a skip, and the rest of that press (its click, its context menu) is swallowed too', () => {
    const r = rig(FULL, (h) => h.run?.finish());
    vi.advanceTimersByTime(0);
    const canvas = document.createElement('canvas');
    r.stage.append(canvas);
    const game = vi.fn();
    for (const type of ['pointerdown', 'pointerup', 'click', 'contextmenu']) canvas.addEventListener(type, game);
    canvas.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(r.skips()).toBe(1);
    expect(game).not.toHaveBeenCalled();
    // The swallow ends with the task that released the press: a click on
    // its own after it (a keyboard activation) is the player's again ...
    vi.advanceTimersByTime(0);
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(game).toHaveBeenCalledTimes(1);
    // ... and so is the next press.
    canvas.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(game).toHaveBeenCalledTimes(3);
  });

  it('after finish(), input is the game’s again', () => {
    const r = rig(FULL);
    vi.advanceTimersByTime(0);
    r.run.finish();
    const e = key();
    window.dispatchEvent(e);
    expect(r.skips()).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('leaving mid-intro', () => {
  it('dispose() cancels everything, lands nothing, and leaves nothing on body or window', () => {
    const r = rig(FULL);
    vi.advanceTimersByTime(300);
    r.run.dispose();
    expect(r.lands()).toBe(0);
    expect(r.removed()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    for (const p of r.panes) expect(p.className).toBe('');
    const e = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(r.skips()).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  // Inert is not gone: a listener that merely returns early still sits on
  // `window` after the battlefield has left. Count adds against removes.
  it('dispose() takes off every window listener it (or a skip) put on', () => {
    const live: { type: string; fn: unknown; capture: boolean }[] = [];
    const capture = (opts: unknown): boolean =>
      typeof opts === 'boolean' ? opts : (opts as { capture?: boolean } | undefined)?.capture === true;
    const add = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, fn: unknown, opts?: unknown) => {
      live.push({ type, fn, capture: capture(opts) });
    }) as typeof window.addEventListener);
    const remove = vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, fn: unknown, opts?: unknown) => {
      const i = live.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture(opts));
      if (i >= 0) live.splice(i, 1);
    }) as typeof window.removeEventListener);
    try {
      const r = rig(FULL);
      vi.advanceTimersByTime(0);
      expect(live.length).toBeGreaterThan(0);
      r.run.dispose();
      expect(live.map((l) => l.type)).toEqual([]);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('dispose() before the skip listeners were even armed leaves no timer either', () => {
    const r = rig(FULL);
    r.run.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
