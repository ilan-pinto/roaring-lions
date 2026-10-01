// The garage model's turn (GH-316): what drag, the arrow keys and the idle
// auto-turn do to one angle, and when a frame gets drawn.
//
// The lead's rulings of 1 Oct, each a constant below: a FREE 360-degree turn
// by drag and by the arrow keys, and an auto-turn of 6 degrees a second
// after 5 s without input, OFF under reduced motion (the shell's setting and
// `prefers-reduced-motion` alike, read through `motion.ts`).
//
// The model renders ON DEMAND, and this file is where that is decided. A
// frame is requested only by input, by the auto-turn while it runs, or by a
// caller asking for one (a resize, a move into a rebuilt bay); several
// requests inside one animation frame draw once. With nothing happening,
// nothing is scheduled at all -- no idle loop that draws the same picture
// sixty times a second -- which is what `garage-turn.test.ts` counts.
//
// Pure DOM-free logic over injected clocks, so every rule is tested without a
// browser, a GPU, or real time.

/** Degrees per arrow-key press (OS key-repeat turns it continuously). */
export const KEY_STEP_DEG = 15;
/** Degrees per PageUp/PageDown press. */
export const PAGE_STEP_DEG = 45;
/** Degrees per CSS pixel of drag: one ~560 px bay width is ~280 degrees. */
export const DRAG_DEG_PER_PX = 0.5;
/** Quiet time before the auto-turn starts. */
export const AUTO_TURN_DELAY_MS = 5000;
/** The auto-turn's rate. A full turn takes a minute. */
export const AUTO_TURN_DEG_PER_S = 6;
/** The longest step one auto-turn frame may take: a tab that was hidden (rAF
 *  throttled to nothing) resumes where it was, not 40 degrees on. */
export const MAX_AUTO_STEP_MS = 100;

/** Any angle into `[0, 360)`; `-0` comes out as `0`. */
export function wrapDeg(deg: number): number {
  const r = deg % 360;
  const w = r < 0 ? r + 360 : r;
  return w === 0 ? 0 : w;
}

export interface TurnDeps {
  /** Draw one frame at this angle. The ONLY thing that costs GPU time. */
  draw(yawDeg: number): void;
  /** The frame source (`requestAnimationFrame`, looked up at call time). */
  frame(cb: (now: number) => void): number;
  cancelFrame(id: number): void;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
  /** Read each time the auto-turn would start, so a setting changed while
   *  the garage is open is honoured on the next idle. */
  reducedMotion(): boolean;
  /** The PLAYER changed the angle (for `aria-valuenow`). Never called by
   *  the auto-turn: a value rewritten six times a second is announced six
   *  times a second by a screen reader. */
  onTurn?(yawDeg: number): void;
}

export class TurnController {
  private yawDeg = 0;
  private frameId = 0;
  private timer = 0;
  private auto = false;
  private held = false;
  private focused = false;
  private last: number | null = null;
  private disposed = false;

  constructor(private readonly deps: TurnDeps) {
    // The first frame is the view's own; the idle clock starts now.
    this.arm();
  }

  /** The current turn, degrees past the unit's default, in `[0, 360)`. */
  get yaw(): number {
    return this.yawDeg;
  }

  /** Whether the auto-turn is running right now. */
  get autoTurning(): boolean {
    return this.auto;
  }

  /** One key press, or one drag step: turn by `deg`, stop the auto-turn, and
   *  restart the quiet clock. */
  turnBy(deg: number): void {
    if (this.disposed) return;
    this.interrupt();
    this.set(this.yawDeg + deg);
  }

  /** Straight to an angle (Home: back to the default). Counts as input. */
  turnTo(deg: number): void {
    if (this.disposed) return;
    this.interrupt();
    this.set(deg);
  }

  /** A pointer is down on the model: no auto-turn while it is held, however
   *  long it stays still. */
  hold(): void {
    if (this.disposed) return;
    this.held = true;
    this.interrupt();
  }

  /** The pointer let go: the quiet clock starts from here. */
  release(): void {
    if (this.disposed) return;
    this.held = false;
    this.arm();
  }

  /** The control has keyboard focus (or lost it). No auto-turn while it is
   *  focused: a player working it by keys, or a screen reader sitting on
   *  it, gets a model that holds still. Leaving it starts the quiet clock. */
  focus(on: boolean): void {
    if (this.disposed) return;
    this.focused = on;
    if (!on) {
      this.arm();
      return;
    }
    const wasTurning = this.auto;
    this.interrupt();
    // The auto-turn's next frame was already asked for; it has nothing new
    // to draw now.
    if (wasTurning && this.frameId !== 0) {
      this.deps.cancelFrame(this.frameId);
      this.frameId = 0;
    }
  }

  /** The reduced-motion preference changed while the garage is open:
   *  switched on, the turn stops where it is; switched back off, the quiet
   *  clock starts again (unless it is already running). */
  motionChanged(): void {
    if (this.disposed) return;
    if (this.deps.reducedMotion()) {
      this.auto = false;
      this.last = null;
      if (this.timer !== 0) this.deps.clearTimer(this.timer);
      this.timer = 0;
    } else if (!this.auto && this.timer === 0) {
      this.arm();
    }
  }

  /** Draw the current angle once, at the next frame -- a resize, or the
   *  model moved into a rebuilt bay. Not input: the clock is untouched. */
  redraw(): void {
    this.request();
  }

  dispose(): void {
    this.disposed = true;
    this.auto = false;
    if (this.frameId !== 0) this.deps.cancelFrame(this.frameId);
    this.frameId = 0;
    if (this.timer !== 0) this.deps.clearTimer(this.timer);
    this.timer = 0;
  }

  private set(deg: number): void {
    const next = wrapDeg(deg);
    if (next !== this.yawDeg) {
      this.yawDeg = next;
      this.deps.onTurn?.(next);
    }
    this.request();
  }

  private interrupt(): void {
    this.auto = false;
    this.last = null;
    this.arm();
  }

  /** Whatever stops the auto-turn from starting: a held pointer, keyboard
   *  focus, or the player's reduced-motion preference. */
  private blocked(): boolean {
    return this.disposed || this.held || this.focused || this.deps.reducedMotion();
  }

  /** (Re)start the quiet clock -- unless something `blocked` names is in
   *  the way, in which case there is no clock at all. */
  private arm(): void {
    if (this.timer !== 0) this.deps.clearTimer(this.timer);
    this.timer = 0;
    if (this.blocked()) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = 0;
      if (this.blocked()) return;
      this.auto = true;
      this.last = null;
      this.request();
    }, AUTO_TURN_DELAY_MS);
  }

  private request(): void {
    if (this.disposed || this.frameId !== 0) return;
    this.frameId = this.deps.frame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frameId = 0;
    if (this.disposed) return;
    // Reduced motion switched on mid-turn: stop where it is.
    if (this.auto && this.deps.reducedMotion()) this.auto = false;
    if (this.auto) {
      // The first auto frame only takes its clock reading: it has no
      // previous frame to measure a step from.
      if (this.last !== null) {
        const dt = Math.min(Math.max(0, now - this.last), MAX_AUTO_STEP_MS);
        // Deliberately NOT reported through `onTurn`: see its comment.
        this.yawDeg = wrapDeg(this.yawDeg + (AUTO_TURN_DEG_PER_S * dt) / 1000);
      }
      this.last = now;
    }
    this.deps.draw(this.yawDeg);
    if (this.auto) this.request();
  };
}
