// GH-976 P3: the flag raid as one seat reads it. Every number is a literal; the runtime is a stub that hands over objective rows
// the way `MissionRuntime.objectiveList` does (the real runtime is walked in the harness test and the browser's room).
import { describe, expect, it } from 'vitest';
import { flagMarksOf, flagViewOf, type FlagRuntime, type FlagRules } from './flag-view';

const RULES: FlagRules = {
  flags: { friendly: { at: [6, 30], size: [5, 5] }, hostile: { at: [37, 13], size: [5, 5] } },
  modes: { flag: { hold_s: 30 } },
};
type Row = FlagRuntime['objectiveList'][number];
const rt = (r0: Partial<Row>, r1: Partial<Row>): FlagRuntime => ({
  objectiveList: [{ id: 'raid_flag_0', status: 'active', ...r0 }, { id: 'raid_flag_1', status: 'active', ...r1 }],
});

describe('flagViewOf', () => {
  it('a raid nobody has begun is open, and each seat reads the flag at its own end as mine', () => {
    const v = flagViewOf(rt({ ticksLeft: 600 }, { ticksLeft: 600 }), RULES, 0, 'friendly');
    expect(v).toEqual({
      holdSeconds: 30,
      mine: { at: [6, 30, 5, 5], state: 'open', held: 0 },
      theirs: { at: [37, 13, 5, 5], state: 'open', held: 0 },
    });
    const w = flagViewOf(rt({ ticksLeft: 600 }, { ticksLeft: 600 }), RULES, 1, 'hostile');
    expect(w.mine.at).toEqual([37, 13, 5, 5]);
    expect(w.theirs.at).toEqual([6, 30, 5, 5]);
  });

  it('raid_flag_<side> is the raid BY that side: side 0 reads its own raid as theirs and the enemy\'s as mine', () => {
    // side 0 has held the hostile flag for 12 s (ticksLeft 360 of 600); side 1 has not begun.
    const a = flagViewOf(rt({ ticksLeft: 360 }, { ticksLeft: 600, paused: 'unheld' }), RULES, 0, 'friendly');
    expect([a.theirs.state, a.theirs.held, a.mine.state, a.mine.held]).toEqual(['raiding', 12, 'open', 0]);
    // The same runtime from side 1's chair (it stands at the hostile end): its own flag is the one being raided.
    const b = flagViewOf(rt({ ticksLeft: 360 }, { ticksLeft: 600, paused: 'unheld' }), RULES, 1, 'hostile');
    expect([b.mine.state, b.mine.held, b.theirs.state, b.theirs.held]).toEqual(['raiding', 12, 'open', 0]);
  });

  it('contested and captured are what the runtime says; held counts whole seconds only', () => {
    const c = flagViewOf(rt({ paused: 'contested', ticksLeft: 600 }, { ticksLeft: 600 }), RULES, 0, 'friendly');
    expect([c.theirs.state, c.theirs.held]).toEqual(['contested', 0]);
    const d = flagViewOf(rt({ status: 'complete' }, { ticksLeft: 600 }), RULES, 0, 'friendly');
    expect([d.theirs.state, d.theirs.held]).toEqual(['captured', 30]);
    const e = flagViewOf(rt({ ticksLeft: 581 }, { ticksLeft: 600 }), RULES, 0, 'friendly');
    expect([e.theirs.state, e.theirs.held]).toEqual(['raiding', 0]);   // 19 ticks served: raiding, not yet a second
    const f = flagViewOf(rt({ ticksLeft: 580 }, { ticksLeft: 600 }), RULES, 0, 'friendly');
    expect(f.theirs.held).toBe(1);
  });

  it('a runtime with no such objective reads as open, never throws', () => {
    expect(flagViewOf({ objectiveList: [] }, RULES, 0, 'friendly').theirs.state).toBe('open');
  });
});

describe('flagMarksOf: the two flags as the world outlines them', () => {
  const marks = (r0: Partial<Row>, r1: Partial<Row>) => Object.fromEntries(flagMarksOf(flagViewOf(rt(r0, r1), RULES, 0, 'friendly')).map((m) => [m.id, m.state]));

  it('their flag is dashed until you hold it, solid while you do, pulsing while it is fought over', () => {
    expect(marks({ ticksLeft: 600 }, { ticksLeft: 600 })['flag:theirs']).toBe('unheld');
    expect(marks({ ticksLeft: 300 }, { ticksLeft: 600 })['flag:theirs']).toBe('held');
    expect(marks({ paused: 'contested', ticksLeft: 600 }, { ticksLeft: 600 })['flag:theirs']).toBe('contested');
  });

  it('your flag is solid while it is safe and the hostile colour once they hold it', () => {
    expect(marks({ ticksLeft: 600 }, { ticksLeft: 600 })['flag:mine']).toBe('held');
    expect(marks({ ticksLeft: 600 }, { ticksLeft: 300 })['flag:mine']).toBe('target');
    expect(marks({ ticksLeft: 600 }, { paused: 'contested', ticksLeft: 600 })['flag:mine']).toBe('contested');
  });

  it('each mark carries the flag\'s rectangle', () => {
    const m = flagMarksOf(flagViewOf(rt({ ticksLeft: 600 }, { ticksLeft: 600 }), RULES, 0, 'friendly'));
    expect(m.map((x) => [x.id, x.rect])).toEqual([['flag:theirs', [37, 13, 5, 5]], ['flag:mine', [6, 30, 5, 5]]]);
  });
});
