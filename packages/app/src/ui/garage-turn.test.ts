import { describe, expect, it } from 'vitest';
import {
  AUTO_TURN_DEG_PER_S,
  AUTO_TURN_DELAY_MS,
  KEY_STEP_DEG,
  MAX_AUTO_STEP_MS,
  TurnController,
  wrapDeg,
} from './garage-turn';

/** A fake clock that owns both the timers and the frames, so a test can
 *  walk time forward and count every draw the controller asks for. */
function rig(opts: { reduced?: boolean } = {}) {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const frames = new Map<number, (t: number) => void>();
  const draws: number[] = [];
  const turns: number[] = [];
  let reduced = opts.reduced ?? false;
  const tc = new TurnController({
    draw: (deg) => draws.push(deg),
    frame: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    reducedMotion: () => reduced,
    onTurn: (deg) => turns.push(deg),
  });
  /** One animation frame at the current time, if any was requested. */
  const flush = (): void => {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, cb] of pending) cb(now);
  };
  /** Advance `ms` in 16 ms steps, firing due timers and one frame per step. */
  const advance = (ms: number, step = 16): void => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + step);
      for (const [id, t] of [...timers.entries()]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
      flush();
    }
  };
  return {
    tc,
    draws,
    turns,
    flush,
    advance,
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
    setReduced: (v: boolean) => {
      reduced = v;
    },
  };
}

describe('wrapDeg', () => {
  it('folds every angle into [0, 360) and never returns -0', () => {
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(-15)).toBe(345);
    expect(wrapDeg(725)).toBe(5);
    expect(wrapDeg(-720)).toBe(0);
    expect(Object.is(wrapDeg(-0), 0)).toBe(true);
    expect(Object.is(wrapDeg(-360), 0)).toBe(true);
  });
});

describe('TurnController: the turn wraps at 360', () => {
  it('keeps turning past 360 in both directions with no clamp', () => {
    const r = rig();
    r.tc.turnBy(350);
    r.tc.turnBy(KEY_STEP_DEG);
    expect(r.tc.yaw).toBe(5);
    r.tc.turnBy(-KEY_STEP_DEG);
    expect(r.tc.yaw).toBe(350);
    r.tc.turnTo(0);
    r.tc.turnBy(-KEY_STEP_DEG);
    expect(r.tc.yaw).toBe(345);
    // Twenty-four presses one way is a full turn and back to the start.
    r.tc.turnTo(0);
    for (let i = 0; i < 24; i++) r.tc.turnBy(KEY_STEP_DEG);
    expect(r.tc.yaw).toBe(0);
  });

  it('reports each change for aria-valuenow', () => {
    const r = rig();
    r.tc.turnBy(15);
    r.tc.turnBy(15);
    expect(r.turns).toEqual([15, 30]);
  });
});

describe('TurnController: renders on demand', () => {
  it('draws nothing at all while idle (reduced motion: no auto-turn either)', () => {
    const r = rig({ reduced: true });
    r.advance(60_000);
    expect(r.draws).toEqual([]);
    expect(r.pendingFrames()).toBe(0);
  });

  it('draws once per frame however many inputs land in it', () => {
    const r = rig();
    r.tc.turnBy(15);
    r.tc.turnBy(15);
    r.tc.turnBy(15);
    expect(r.draws).toEqual([]);
    r.flush();
    expect(r.draws).toEqual([45]);
    // And nothing more is scheduled after it.
    expect(r.pendingFrames()).toBe(0);
  });

  it('redraws on request without counting as input', () => {
    const r = rig();
    r.advance(4000);
    r.tc.redraw();
    r.flush();
    expect(r.draws).toEqual([0]);
    // The quiet clock was not reset by the redraw: the auto-turn still starts
    // at 5 s from the start, not 5 s from the redraw.
    r.advance(1100);
    expect(r.tc.autoTurning).toBe(true);
  });
});

describe('TurnController: the auto-turn', () => {
  it('starts 5 s after the last input and not a frame before', () => {
    const r = rig();
    r.advance(AUTO_TURN_DELAY_MS - 20);
    expect(r.tc.autoTurning).toBe(false);
    expect(r.draws).toEqual([]);
    r.advance(40);
    expect(r.tc.autoTurning).toBe(true);
    expect(r.draws.length).toBeGreaterThan(0);
  });

  it('turns at 6 degrees a second, one draw per frame', () => {
    const r = rig();
    r.advance(AUTO_TURN_DELAY_MS);
    const drawsAtStart = r.draws.length;
    const yawAtStart = r.tc.yaw;
    r.advance(10_000);
    expect(r.tc.yaw - yawAtStart).toBeCloseTo(AUTO_TURN_DEG_PER_S * 10, 0);
    // 10 s of 16 ms frames: one draw each.
    expect(r.draws.length - drawsAtStart).toBe(625);
  });

  it('never takes a step longer than MAX_AUTO_STEP_MS (a hidden tab resumes, it does not jump)', () => {
    const r = rig();
    r.advance(AUTO_TURN_DELAY_MS + 100);
    const before = r.tc.yaw;
    r.advance(5000, 5000); // one frame, five seconds late
    expect(r.tc.yaw - before).toBeCloseTo((AUTO_TURN_DEG_PER_S * MAX_AUTO_STEP_MS) / 1000, 6);
  });

  it('stops on input, and starts again 5 s after it', () => {
    const r = rig();
    r.advance(AUTO_TURN_DELAY_MS + 1000);
    expect(r.tc.autoTurning).toBe(true);
    r.tc.turnBy(KEY_STEP_DEG);
    expect(r.tc.autoTurning).toBe(false);
    r.flush();
    const drawn = r.draws.length;
    r.advance(AUTO_TURN_DELAY_MS - 50);
    expect(r.draws.length).toBe(drawn);
    r.advance(100);
    expect(r.tc.autoTurning).toBe(true);
  });

  it('wraps past 360 as it turns', () => {
    const r = rig();
    r.tc.turnTo(359);
    r.advance(AUTO_TURN_DELAY_MS + 2000);
    expect(r.tc.yaw).toBeGreaterThanOrEqual(0);
    expect(r.tc.yaw).toBeLessThan(20);
  });

  it('does not start while a pointer is held, however long it stays still', () => {
    const r = rig();
    r.tc.hold();
    r.advance(AUTO_TURN_DELAY_MS * 3);
    expect(r.tc.autoTurning).toBe(false);
    expect(r.draws).toEqual([]);
    r.tc.release();
    r.advance(AUTO_TURN_DELAY_MS + 50);
    expect(r.tc.autoTurning).toBe(true);
  });

  it('never runs under reduced motion: no timer is even armed', () => {
    const r = rig({ reduced: true });
    expect(r.pendingTimers()).toBe(0);
    r.tc.turnBy(15);
    r.flush();
    r.advance(AUTO_TURN_DELAY_MS * 4);
    expect(r.tc.autoTurning).toBe(false);
    expect(r.draws).toEqual([15]);
  });

  it('stops where it is when reduced motion is switched on mid-turn', () => {
    const r = rig();
    r.advance(AUTO_TURN_DELAY_MS + 500);
    expect(r.tc.autoTurning).toBe(true);
    r.setReduced(true);
    r.advance(100);
    const at = r.tc.yaw;
    const drawn = r.draws.length;
    r.advance(5000);
    expect(r.tc.autoTurning).toBe(false);
    expect(r.tc.yaw).toBe(at);
    expect(r.draws.length).toBe(drawn);
  });

  it('a disposed controller schedules and draws nothing', () => {
    const r = rig();
    r.tc.turnBy(15);
    r.tc.dispose();
    r.advance(AUTO_TURN_DELAY_MS * 3);
    expect(r.draws).toEqual([]);
    expect(r.pendingFrames()).toBe(0);
    expect(r.pendingTimers()).toBe(0);
  });
});

describe('TurnController: what a screen reader hears, and focus', () => {
  it('reports the angle on player input only, never from the auto-turn', () => {
    const r = rig();
    r.tc.turnBy(15);
    r.flush();
    r.advance(AUTO_TURN_DELAY_MS + 10_000);
    expect(r.tc.autoTurning).toBe(true);
    expect(r.tc.yaw).toBeGreaterThan(70);
    // One report: the key press. Ten seconds of turning said nothing.
    expect(r.turns).toEqual([15]);
  });

  it('pauses the auto-turn while the control has focus, and restarts the clock on blur', () => {
    const r = rig();
    r.advance(AUTO_TURN_DELAY_MS + 500);
    expect(r.tc.autoTurning).toBe(true);
    r.tc.focus(true);
    expect(r.tc.autoTurning).toBe(false);
    const drawn = r.draws.length;
    r.advance(AUTO_TURN_DELAY_MS * 3);
    expect(r.draws.length).toBe(drawn);
    expect(r.pendingTimers()).toBe(0);
    r.tc.focus(false);
    r.advance(AUTO_TURN_DELAY_MS - 50);
    expect(r.tc.autoTurning).toBe(false);
    r.advance(100);
    expect(r.tc.autoTurning).toBe(true);
  });

  it('a focused control still turns by keys, and never by itself', () => {
    const r = rig();
    r.tc.focus(true);
    r.tc.turnBy(15);
    r.flush();
    r.advance(AUTO_TURN_DELAY_MS * 2);
    expect(r.draws).toEqual([15]);
  });
});

describe('TurnController: reduced motion switched while the garage is open', () => {
  it('switched back off, the auto-turn starts again after the quiet time', () => {
    const r = rig({ reduced: true });
    r.advance(AUTO_TURN_DELAY_MS * 2);
    expect(r.tc.autoTurning).toBe(false);
    r.setReduced(false);
    r.tc.motionChanged();
    r.advance(AUTO_TURN_DELAY_MS - 50);
    expect(r.tc.autoTurning).toBe(false);
    r.advance(100);
    expect(r.tc.autoTurning).toBe(true);
  });

  it('switched on, it stops at once and arms nothing', () => {
    const r = rig();
    r.advance(AUTO_TURN_DELAY_MS + 500);
    r.setReduced(true);
    r.tc.motionChanged();
    expect(r.tc.autoTurning).toBe(false);
    expect(r.pendingTimers()).toBe(0);
  });

  it('a change that is not a change leaves a running clock alone', () => {
    const r = rig();
    r.advance(AUTO_TURN_DELAY_MS - 1000);
    r.tc.motionChanged();
    r.advance(1100);
    expect(r.tc.autoTurning).toBe(true);
  });
});
