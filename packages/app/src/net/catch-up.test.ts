import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CatchUpQuiet, QUIET_BEHIND_TICKS, catchUpTicks, tickCostEma, roomTickCap, MAX_CATCHUP_TICKS } from './catch-up';

describe('catchUpTicks', () => {
  it('nothing behind runs nothing', () => {
    expect(catchUpTicks(0, 1)).toBe(0);
    expect(catchUpTicks(-3, 1)).toBe(0);
  });
  it('nearly caught up keeps the normal cap, and never more than is behind', () => {
    expect(catchUpTicks(3, 1)).toBe(3);
    expect(catchUpTicks(5, 1)).toBe(4);
  });
  it('far behind runs as many ticks as fit in the budget', () => {
    expect(catchUpTicks(5000, 1, 12)).toBe(12);
    expect(catchUpTicks(5000, 0.25, 12)).toBe(48);
  });
  it('never below 1 while behind, never above behind', () => {
    for (const behind of [1, 2, 7, 9, 40, 500, 12000]) {
      for (const cost of [0, 0.01, 0.3, 1, 5, 50, 1000]) {
        const n = catchUpTicks(behind, cost);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(behind);
      }
    }
  });
});

describe('tickCostEma', () => {
  it('moves part of the way toward each sample', () => {
    expect(tickCostEma(2, 1)).toBeCloseTo(1.8);
    expect(tickCostEma(1, 3, 0.5)).toBeCloseTo(2);
  });
  it('ignores a sample that is not a finite, non-negative cost', () => {
    expect(tickCostEma(2, Number.NaN)).toBe(2);
    expect(tickCostEma(2, Number.POSITIVE_INFINITY)).toBe(2);
    expect(tickCostEma(2, -1)).toBe(2);
  });
});

describe('roomTickCap', () => {
  it('live and far behind raises the cap to what fits the frame; live and near keeps the floor', () => {
    expect(roomTickCap({ kind: 'live', behind: 5000 }, 0.25)).toBe(48);
    expect(roomTickCap({ kind: 'live', behind: 3 }, 1)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'live', behind: 0 }, 1)).toBe(MAX_CATCHUP_TICKS);
  });
  it('a stall far behind raises the cap as live does (I-1): a reload rejoin is behind-stalled for most of its replay, and R31 needs only a cap of at least 1', () => {
    expect(roomTickCap({ kind: 'stalled', reason: 'behind', seat: 1 }, 0.25, 6000)).toBe(48);
    expect(roomTickCap({ kind: 'stalled', reason: 'gone', seat: 0 }, 1, 6000)).toBe(12);
    expect(roomTickCap({ kind: 'stalled', reason: 'connecting', seat: null }, 0.25, 6000)).toBe(48);
  });
  it('a stall near caught up, or with no backlog given, keeps the floor -- never 0, so its own seat runs the frames it holds to ack (R31)', () => {
    expect(roomTickCap({ kind: 'stalled', reason: 'behind', seat: 1 }, 0.25, 3)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'stalled', reason: 'behind', seat: 1 }, 0.25, 0)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'stalled', reason: 'behind', seat: 1 }, 0.25)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'stalled', reason: 'connecting', seat: null }, 0.25)).toBe(MAX_CATCHUP_TICKS);
  });
  it('a pause far behind raises the cap too: the room sends a rejoin its log ahead of the pause in force', () => {
    expect(roomTickCap({ kind: 'paused', seat: 0, untilMs: 90000 }, 0.25, 6000)).toBe(48);
    expect(roomTickCap({ kind: 'paused', seat: 0, untilMs: 90000 }, 0.25, 2)).toBe(MAX_CATCHUP_TICKS);
  });
  it('live reads the backlog given over its own status, which can be a frame old', () => {
    expect(roomTickCap({ kind: 'live', behind: 3 }, 0.25, 6000)).toBe(48);
  });
  it('a pause with no backlog given, and every other status, keep the floor', () => {
    expect(roomTickCap({ kind: 'paused', seat: 0, untilMs: 90000 }, 0.25)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'waiting' }, 0.25, 6000)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'local' }, 0.25, 6000)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'desync', tick: 40 }, 0.25, 6000)).toBe(MAX_CATCHUP_TICKS);
    expect(roomTickCap({ kind: 'closed', reason: 'left' }, 0.25, 6000)).toBe(MAX_CATCHUP_TICKS);
  });
});

// N1b follow-up: a rejoin runs the room's whole log in seconds; the ticks far
// behind the live edge are presented silently and the last second plays out
// as it happened.
describe('CatchUpQuiet', () => {
  function run(held: number, ticks: number): boolean[] {
    const q = new CatchUpQuiet();
    q.begin(held);
    return Array.from({ length: ticks }, () => q.next());
  }

  it('a batch of 100 held frames is quiet until 20 are left behind the tick, then plays', () => {
    const out = run(100, 100);
    // The tick with 21 held (20 behind it) is the first that plays.
    expect(out.indexOf(false)).toBe(100 - (QUIET_BEHIND_TICKS + 1));
    expect(out.filter((q) => q).length).toBe(100 - (QUIET_BEHIND_TICKS + 1));
    expect(out.slice(out.indexOf(false)).every((q) => !q)).toBe(true);
  });
  it('a 12,000-tick replay is quiet for all but its last second', () => {
    const out = run(12_000, 12_000);
    expect(out.filter((q) => !q).length).toBe(QUIET_BEHIND_TICKS + 1);
    expect(out.slice(0, 11_000).every((q) => q)).toBe(true);
  });
  it('ordinary play is never quiet: the live seat holds a handful of frames at most', () => {
    for (const held of [0, 1, 2, 4, 8, 21]) expect(run(held, held + 3).some((q) => q), `held ${held}`).toBe(false);
  });
  it('one past the line is the smallest backlog that mutes its first tick', () => {
    expect(run(QUIET_BEHIND_TICKS + 1, 1)).toEqual([false]);
    expect(run(QUIET_BEHIND_TICKS + 2, 2)).toEqual([true, false]);
  });
  it('a bad backlog (NaN, negative) reads as none, and running past the end stays live', () => {
    expect(run(Number.NaN, 3)).toEqual([false, false, false]);
    expect(run(-5, 3)).toEqual([false, false, false]);
    expect(run(2, 10).every((q) => !q)).toBe(true);
  });
  it('each batch starts from its own backlog', () => {
    const q = new CatchUpQuiet();
    q.begin(500);
    expect(q.next()).toBe(true);
    q.begin(0);
    expect(q.next()).toBe(false);
  });
});

describe('main.ts wires the quiet catch-up', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const tick = main.slice(main.indexOf('const runTick = (): void => {'), main.indexOf('intelMoments?.beforeTick(sim);') + 400);
  it('stepFrames starts each batch from the room\'s backlog, and 0 outside a room', () => {
    const step = main.slice(main.indexOf('const stepFrames = (maxTicks: number): number => {'), main.indexOf('const { ran, dropped } = runFrames'));
    expect(step).toContain('catchUpQuiet.begin(room?.behind() ?? 0);');
  });
  it('runTick asks once per tick, drops the renderer\'s bursts, and mutes audio and voice', () => {
    expect(tick).toContain('tickQuiet = catchUpQuiet.next();');
    const body = main.slice(main.indexOf('const runTick = (): void => {'), main.indexOf('// PA-25: a Free Play sandbox has no runtime'));
    expect(body).toContain('renderer.setQuiet?.(tickQuiet);');
    expect(body).toContain('renderer.setQuiet?.(false);');
    expect(body).toContain('if (!tickQuiet) audio.onEvents(events, sim);');
    expect(body).toContain('if (!tickQuiet) voice.onTick(events);');
    expect(body.indexOf('renderer.setQuiet?.(tickQuiet);')).toBeLessThan(body.indexOf('renderer.onEvents(events);'));
    expect(body.indexOf('renderer.onEvents(events);')).toBeLessThan(body.indexOf('renderer.setQuiet?.(false);'));
  });
  it('the mission voice and the alert layer stand down too, the alert\'s state still kept', () => {
    expect(main).toContain('if (!tickQuiet) voice.onMission(missionEvents, [...intelAnnounce, ...medicCallInputs(');
    const alerts = main.slice(main.indexOf('const announceAlerts = '), main.indexOf('// --- fixed-tick loop'));
    expect(alerts.indexOf('alertState = result.state;')).toBeLessThan(alerts.indexOf('if (tickQuiet) return;'));
    expect(alerts.indexOf('if (tickQuiet) return;')).toBeLessThan(alerts.indexOf('audio.playCue(cue)'));
  });
});
