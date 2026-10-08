import { describe, expect, it } from 'vitest';
import { logDestroyed, logMissionEvent, newMissionLog, type LogContext } from './mission-log';

const ctx: LogContext = {
  positionOf: (e) => ({ x: e * 2, y: e * 3 }),
  rosterOf: (e) => (e === 7 ? { name: 'Barzel' } : undefined),
  zone: (id) => (id === 'hall_block' ? [20, 26, 7, 7] : undefined),
};

describe('mission log (GH-417, L-6)', () => {
  it('remembers a loss with its name and where it fell', () => {
    const log = newMissionLog();
    logMissionEvent(log, { kind: 'unitLost', tick: 6800, entity: 7, unit: 'inf_squad' }, ctx);
    logMissionEvent(log, { kind: 'unitLost', tick: 2600, entity: 3, unit: 'jeep_shoded' }, ctx);
    expect(log.losses).toEqual([
      { tick: 6800, entity: 7, type: 'inf_squad', name: 'Barzel', x: 14, y: 21 },
      { tick: 2600, entity: 3, type: 'jeep_shoded', x: 6, y: 9 },
    ]);
  });

  // Falsified: dropping the zone lookup leaves the hall deduction unpinned.
  it('pins a deduction to the zone its reason names, and no other', () => {
    const log = newMissionLog();
    logMissionEvent(log, { kind: 'roe', tick: 2400, penalty: 5, reason: 'fire into protected structure (hall_block)' }, ctx);
    logMissionEvent(log, { kind: 'roe', tick: 3000, penalty: 3, reason: 'civilian casualties' }, ctx);
    expect(log.deductions[0]).toEqual({ tick: 2400, reason: 'fire into protected structure (hall_block)', penalty: 5, x: 23, y: 29 });
    expect(log.deductions[1]).toEqual({ tick: 3000, reason: 'civilian casualties', penalty: 3 });
  });

  // Review: a destroyed structure's `place` is a structure TYPE id. Falsified:
  // looking every `place` up as a zone pins this one at hall_block's centre.
  it('never looks a destroyed structure’s type up as a zone', () => {
    const log = newMissionLog();
    const sameId: LogContext = { ...ctx, zone: (id) => (id === 'hall_block' || id === 'hall' ? [20, 26, 7, 7] : undefined) };
    logMissionEvent(log, { kind: 'roe', tick: 10, penalty: 6, reason: 'Hall destroyed' }, sameId);
    expect(log.deductions[0].x).toBeUndefined();
  });

  it('keeps objective outcomes, not their activations, and counts hostile kills only', () => {
    const log = newMissionLog();
    logMissionEvent(log, { kind: 'objective', tick: 5040, id: 'raze_depot', status: 'complete' }, ctx);
    logMissionEvent(log, { kind: 'objective', tick: 10, id: 'hold', status: 'active' }, ctx);
    logMissionEvent(log, { kind: 'wave', tick: 99 }, ctx);
    logDestroyed(log, 1);
    logDestroyed(log, 0);
    logDestroyed(log, 2);
    expect(log.objectives).toEqual([{ tick: 5040, id: 'raze_depot', status: 'complete' }]);
    expect(log.kills).toBe(1);
  });
});
