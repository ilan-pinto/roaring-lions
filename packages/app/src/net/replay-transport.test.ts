// GH-954 W3: the replay's transport. Its schedule is in sim ticks; the clock only credits the budget.
import { describe, expect, it } from 'vitest';
import type { Command } from '@lions/sim';
import type { Frame } from '@lions/net';
import { isReplaySpeed, REPLAY_MAX_CREDIT_MS, REPLAY_SPEEDS, REPLAY_TICK_MS, ReplayTransport, ticksOwed } from './replay-transport';

const frames = (n: number): Frame[] => Array.from({ length: n }, (_, tick) => ({ tick, cmds: tick % 3 === 0 ? [{ seat: 0 as const, seq: tick, cmd: { kind: 'halt', ids: [tick] } as Command }] : [] }));
function rig(n: number, speed?: (typeof REPLAY_SPEEDS)[number]): { t: ReplayTransport; at: { ms: number } } {
  const at = { ms: 1000 };
  return { t: new ReplayTransport(frames(n), { now: () => at.ms, ...(speed === undefined ? {} : { speed }) }), at };
}

describe('ticksOwed', () => {
  it('is wall time times speed over 50 ms, capped at 250 ms of credit', () => {
    expect(ticksOwed(50, 1)).toBe(1);
    expect(ticksOwed(50, 8)).toBe(8);
    expect(ticksOwed(100, 0.5)).toBe(1);
    expect(ticksOwed(25, 1)).toBe(0.5);
    // A hidden tab that wakes a minute later owes five ticks at 1x, not 1,200.
    expect(ticksOwed(60_000, 1)).toBe(REPLAY_MAX_CREDIT_MS / REPLAY_TICK_MS);
    expect(ticksOwed(-5, 1)).toBe(0);
  });
  it('the offered speeds are 0.5x to 8x and nothing else', () => {
    expect(REPLAY_SPEEDS).toEqual([0.5, 1, 2, 4, 8]);
    expect(isReplaySpeed(8)).toBe(true);
    for (const v of [0, 3, 16, '8', null]) expect(isReplaySpeed(v)).toBe(false);
  });
});

describe('the schedule', () => {
  it('releases frames in order, once each, as many as the wall time owes at the speed', () => {
    const { t, at } = rig(100);
    expect(t.take(10)).toEqual([]);                      // no time has passed
    at.ms += 100;
    expect(t.take(10).map((f) => f.tick)).toEqual([0, 1]);
    t.setSpeed(8);
    at.ms += 50;
    expect(t.take(100).map((f) => f.tick)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    t.setSpeed(0.5);
    at.ms += 100;
    expect(t.take(100).map((f) => f.tick)).toEqual([10]);
    expect(t.position).toBe(11);
  });

  it('carries the fraction, and never hands out more than asked', () => {
    const { t, at } = rig(100, 0.5);
    const got: number[] = [];
    for (let i = 0; i < 20; i++) { at.ms += 16; for (const f of t.take(4)) got.push(f.tick); }
    // 320 ms at 0.5x is 3.2 ticks: three, in order, none repeated.
    expect(got).toEqual([0, 1, 2]);
    at.ms += 200;
    expect(t.take(1)).toHaveLength(1);                    // owed 2+, asked for 1
    expect(t.take(1)).toHaveLength(1);
  });

  it('a pause owes nothing, however long it lasts, and play resumes where it stopped', () => {
    const { t, at } = rig(100);
    at.ms += 100;
    expect(t.take(100)).toHaveLength(2);
    t.setPaused(true);
    at.ms += 10_000;
    expect(t.take(100)).toEqual([]);
    expect(t.paused).toBe(true);
    t.setPaused(false);
    expect(t.take(100)).toEqual([]);                      // the pause's time was not banked
    at.ms += 50;
    expect(t.take(100).map((f) => f.tick)).toEqual([2]);
  });

  it('the whole game comes out whatever the speed and the animation frame length', () => {
    for (const speed of REPLAY_SPEEDS) {
      for (const dt of [5, 16, 33, 120]) {
        const { t, at } = rig(240, speed);
        const seen: number[] = [];
        let guard = 0;
        while (t.status().kind !== 'closed' && guard++ < 200_000) { at.ms += dt; for (const f of t.take(4)) seen.push(f.tick); }
        expect(seen, `${speed}x at ${dt} ms`).toEqual(Array.from({ length: 240 }, (_, i) => i));
      }
    }
  });

  it('"behind" is what is owed, never what remains: a long game does not read as a rejoin catching up', () => {
    const { t, at } = rig(5000);
    expect(t.status()).toEqual({ kind: 'live', behind: 0 });
    at.ms += 200;
    expect(t.behind()).toBe(4);
    expect(t.status()).toEqual({ kind: 'live', behind: 4 });
  });
});

describe('the end, and no way in', () => {
  it('closes as "over" after the last frame, and as "left" when closed', () => {
    const { t, at } = rig(3, 8);
    at.ms += 250;
    expect(t.take(10)).toHaveLength(3);
    expect(t.status()).toEqual({ kind: 'closed', reason: 'over' });
    expect(t.take(10)).toEqual([]);
    const other = rig(3);
    other.t.close();
    expect(other.t.status()).toEqual({ kind: 'closed', reason: 'left' });
  });

  it('a command goes nowhere: the frames after it are the recorded ones, bit for bit, and it is local to nothing', () => {
    const { t, at } = rig(30, 8);
    const before = JSON.stringify(frames(30));
    for (let i = 0; i < 10; i++) t.queueCommand({ kind: 'move', ids: [1], x: 5, y: 5 } as Command);
    at.ms += 250;
    const got: Frame[] = [];
    while (t.status().kind !== 'closed') { at.ms += 50; got.push(...t.take(4)); }
    expect(JSON.stringify(got)).toBe(before);
    expect(t.local).toBe(false);
    expect(() => t.reportTick()).not.toThrow();
  });
});
