// packages/app/src/ui/mission-intro-run.ts
/**
 * The DOM half of the briefing -> battlefield transition (H3, T4). The pure
 * half -- timings, plan, start pose, camera, fold geometry -- is
 * `mission-intro.ts`. This file only flips attributes and classes on a
 * timeline; every animation is theme.css's (`.rl-loading[data-intro]`,
 * `.rl-intro-held`/`.rl-intro-in`, `.rl-cmd--landed`), so nothing here runs
 * per frame and nothing here touches the camera or the clock: `main.ts`
 * writes the camera from its frame loop and holds the accumulator itself.
 *
 * The timeline, from `start` (the first painted world frame):
 *  - at once: the screen starts leaving (`fold`, or reduced motion's `fade`),
 *    and every pane the battlefield mounted on `body` is held back;
 *  - `plan.hudAtMs`: the panes step in;
 *  - `plan.landMs`: the screen is removed and `onLand` runs (the reveal and
 *    the bar's pulse, which are the caller's);
 *  - from one task after `start` until `finish`: any pointerdown or keydown
 *    is a SKIP, consumed, and handed to `onSkip`.
 *
 * Holding the panes back is a sweep of `body`'s children, not a HUD API, on
 * purpose: the HUD owns eight of them, but the minimap, the reinforcement
 * dock, the group bar, the advisor and the debug overlay are separate owners
 * that would otherwise sit over the folding briefing. It is the outcome
 * beat's own pattern (`hideForBeat`), with classes rather than inline style,
 * and it is undone by `finish` and by `dispose` alike.
 */
import type { FoldGeometry, IntroPlan } from './mission-intro';

/** The kept deploy screen (`LoadingScreen` from `loading.ts`, structurally). */
export interface IntroScreen {
  leave(mode: { kind: 'fold'; geometry: FoldGeometry | null } | { kind: 'fade' }): void;
  boxRect(): DOMRect | null;
  remove(): void;
}

export interface IntroRunDeps {
  readonly plan: IntroPlan;
  readonly screen: IntroScreen;
  /** Where the battlefield's panes are mounted (`document.body`). */
  readonly body: HTMLElement;
  /** Children of `body` the hold must not touch (the stage). */
  readonly keep: readonly Element[];
  /** The fold target, read once at start. */
  readonly foldTo: (box: DOMRect) => FoldGeometry | null;
  /** The card has landed and the screen is gone. Runs exactly once, unless
   *  the intro is disposed first. */
  readonly onLand: () => void;
  /** A skip input arrived (already consumed). The caller ends the intro. */
  readonly onSkip: () => void;
  /** Injected for tests; `performance.now` otherwise. */
  readonly now?: () => number;
}

export interface IntroRun {
  /** When the intro started, on the `now` clock. */
  readonly t0: number;
  /** Jump to the DOM end state: screen removed, panes shown, `onLand` run
   *  if it had not, skip listeners off. Idempotent. */
  finish(): void;
  /** Teardown (leaving mid-intro): cancel everything and leave nothing on
   *  `body` or `window`, WITHOUT landing. Idempotent; safe after `finish`. */
  dispose(): void;
}

/** The pointer events that belong to one press, swallowed after a pointer
 *  skip so the rest of the gesture cannot select, deselect or order: a
 *  `click` still follows a consumed `pointerdown`, and a right press fires
 *  `contextmenu` on its own. */
const GESTURE_TAIL = ['pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'auxclick', 'contextmenu'] as const;

export function runMissionIntro(d: IntroRunDeps): IntroRun {
  const now = d.now ?? (() => performance.now());
  const t0 = now();
  const timers: number[] = [];
  const later = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms));
  };
  let landed = false;
  let over = false;
  let disposed = false;

  // Hold every pane back. Whatever mounts on `body` from here on (the title
  // card at the landing, a dialog) is not swept, so is not held.
  const held: HTMLElement[] = [];
  for (const k of Array.from(d.body.children)) {
    if (!(k instanceof HTMLElement) || d.keep.includes(k)) continue;
    if (k.tagName === 'SCRIPT' || k.tagName === 'AUDIO' || k.tagName === 'STYLE') continue;
    k.classList.add('rl-intro-held');
    held.push(k);
  }
  const stepIn = (): void => {
    for (const k of held) {
      k.classList.remove('rl-intro-held');
      // Reduced motion: a cut. The full intro: a fade (theme.css's
      // `.rl-intro-in` transition), taken off again in `release`.
      if (!d.plan.reduced) k.classList.add('rl-intro-in');
    }
  };
  const release = (): void => {
    for (const k of held) k.classList.remove('rl-intro-held', 'rl-intro-in');
    held.length = 0;
  };

  if (d.plan.reduced) {
    d.screen.leave({ kind: 'fade' });
  } else {
    const box = d.screen.boxRect();
    d.screen.leave({ kind: 'fold', geometry: box ? d.foldTo(box) : null });
  }

  const land = (): void => {
    if (landed) return;
    landed = true;
    d.screen.remove();
    d.onLand();
  };
  later(d.plan.hudAtMs, stepIn);
  later(d.plan.landMs, land);

  // --- skip -----------------------------------------------------------------
  let tailOff: (() => void) | null = null;
  const swallowTail = (): void => {
    tailOff?.();
    const eat = (e: Event): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      // The press ends at `pointerup`; its `click` (and a right press's
      // `contextmenu`) is dispatched in the same task, so the swallow
      // stands until the next one.
      if (e.type === 'pointerup' || e.type === 'pointercancel') window.setTimeout(off, 0);
    };
    const off = (): void => {
      for (const type of GESTURE_TAIL) window.removeEventListener(type, eat, true);
      window.removeEventListener('pointerdown', off, true);
      if (tailOff === off) tailOff = null;
    };
    for (const type of GESTURE_TAIL) window.addEventListener(type, eat, true);
    // A press whose release never reached this window (it ended over the OS
    // chrome) must not eat the NEXT press's release: a new press ends it.
    window.addEventListener('pointerdown', off, true);
    tailOff = off;
  };
  const skip = (e: Event): void => {
    if (over) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'pointerdown') swallowTail();
    d.onSkip();
  };
  const listen = (): void => {
    window.addEventListener('pointerdown', skip, true);
    window.addEventListener('keydown', skip, true);
  };
  const unlisten = (): void => {
    window.removeEventListener('pointerdown', skip, true);
    window.removeEventListener('keydown', skip, true);
  };
  // One task late: Enter on Deploy activates the button on KEYDOWN, and a
  // listener added during that dispatch would see the same keydown reach
  // `window` and skip at once.
  const listenTimer = window.setTimeout(() => {
    if (!over) listen();
  }, 0);

  return {
    t0,
    finish(): void {
      if (over || disposed) return;
      over = true;
      window.clearTimeout(listenTimer);
      for (const t of timers.splice(0)) window.clearTimeout(t);
      unlisten();
      release();
      land();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      over = true;
      window.clearTimeout(listenTimer);
      for (const t of timers.splice(0)) window.clearTimeout(t);
      unlisten();
      tailOff?.();
      release();
      d.screen.remove();
    },
  };
}
