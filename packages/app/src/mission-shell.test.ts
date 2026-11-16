/** GH-1393 slice 2: the shell record round-trips exactly, and anything that is not exactly its shape is refused (never half-applied). */
import { describe, expect, it } from 'vitest';
import { captureShell, parseShell, type ShellState } from './mission-shell';
import { newMissionLog } from './mission-log';

const state = (): ShellState => ({
  log: {
    ...newMissionLog(),
    losses: [{ tick: 120, entity: 4, type: 'inf_squad', name: 'Dana', x: 12, y: 30 }],
    deductions: [{ tick: 300, reason: 'fire into a protected zone', penalty: 5, x: 9, y: 9 }],
    objectives: [{ tick: 400, id: 'hold', status: 'complete' }],
    kills: 7,
    evacuated: 2,
  },
  deductions: [{ penalty: 5, reason: 'fire into a protected zone', tick: 300 }],
  lost: [{ slot: 3, name: 'Dana', type: 'inf_squad', veterancy: 1, missions: 2, kills: 4, missionId: 'm1', tick: 120 }],
  narratedRoe: new Set(['b', 'a']),
  evacuated: 2,
  deadlinesWarned: new Set(['hold']),
  limitWarned: true,
});

describe('captureShell / parseShell', () => {
  it('round-trips through JSON exactly, sets sorted', () => {
    const rec = captureShell(state());
    const back = parseShell(JSON.parse(JSON.stringify(rec)));
    expect(back).toEqual(rec);
    expect(rec.narratedRoe).toEqual(['a', 'b']);
    expect(back?.log.kills).toBe(7);
    expect(back?.limitWarned).toBe(true);
  });

  it('is a copy: changing the live mission afterwards does not change the record', () => {
    const s = state();
    const rec = captureShell(s);
    s.log.kills = 99;
    s.log.losses.push({ tick: 1, entity: 1, type: 'x', x: 0, y: 0 });
    (s.deductions as unknown as { penalty: number }[])[0]!.penalty = 50;
    expect(rec.log.kills).toBe(7);
    expect(rec.log.losses).toHaveLength(1);
    expect(rec.deductions[0]?.penalty).toBe(5);
  });

  it('an optional field stays optional: no evacuated count, no place', () => {
    const s = state();
    delete s.log.evacuated;
    const back = parseShell(JSON.parse(JSON.stringify(captureShell(s))));
    expect(back).not.toBeNull();
    expect('evacuated' in (back?.log ?? {})).toBe(false);
  });

  it('refuses anything that is not exactly the shape: one wrong field, a missing array, a wrong version', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test pokes arbitrary nested fields of a plain JSON value
    type Loose = Record<string, any>;
    const good = JSON.parse(JSON.stringify(captureShell(state()))) as Loose;
    expect(parseShell(good)).not.toBeNull();
    const bad = (mut: (o: Loose) => void): unknown => {
      const o = structuredClone(good);
      mut(o);
      return parseShell(o);
    };
    expect(bad((o) => { o.v = 2; })).toBeNull();
    expect(bad((o) => { delete o.lost; })).toBeNull();
    expect(bad((o) => { o.log.kills = '7'; })).toBeNull();
    expect(bad((o) => { o.log.losses[0].x = Number.NaN; })).toBeNull();
    expect(bad((o) => { o.log.objectives[0].status = 'weird'; })).toBeNull();
    expect(bad((o) => { o.lost[0].missions = 1.5; })).toBeNull();
    expect(bad((o) => { o.narratedRoe = [1]; })).toBeNull();
    expect(bad((o) => { o.limitWarned = 'yes'; })).toBeNull();
    expect(parseShell(null)).toBeNull();
    expect(parseShell([])).toBeNull();
    expect(parseShell('x')).toBeNull();
  });
});
