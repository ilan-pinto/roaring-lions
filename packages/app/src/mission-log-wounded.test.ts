import { describe, expect, it } from 'vitest';
import { logWoundEvacuated, newMissionLog } from './mission-log';
import { afterAction, type AfterActionInputs } from './ui/after-action';

const base = (over: Partial<AfterActionInputs> = {}): AfterActionInputs => ({
  result: 'victory',
  stars: 1,
  roe: 100,
  roeFloor: 60,
  ticks: 6000,
  objectives: [],
  log: newMissionLog(),
  invoice: [],
  promotions: [],
  replacements: [],
  unlocks: [],
  typeName: (id) => id,
  ...over,
} as AfterActionInputs);

describe('the debrief\'s "evacuated" line (GH-707 P2)', () => {
  it('counts only our own evacuations, and a fresh log stays free of the key', () => {
    const log = newMissionLog();
    expect(Object.keys(log)).not.toContain('evacuated');
    logWoundEvacuated(log, 1, 0);
    expect(log.evacuated).toBeUndefined();
    logWoundEvacuated(log, 0, 0);
    logWoundEvacuated(log, 0, 0);
    expect(log.evacuated).toBe(2);
  });

  it('shows "N evacuated" in the done-well column only when N > 0', () => {
    const none = afterAction(base());
    expect(none.well.some((w) => w.text.includes('evacuated'))).toBe(false);
    const log = newMissionLog();
    log.evacuated = 1;
    expect(afterAction(base({ log })).well.find((w) => w.text.includes('evacuated'))).toMatchObject({ mark: '1', tone: 'good', text: '1 wounded man evacuated' });
    log.evacuated = 4;
    expect(afterAction(base({ log })).well.find((w) => w.text.includes('evacuated'))).toMatchObject({ mark: '4', text: '4 wounded evacuated' });
  });
});
