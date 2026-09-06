// The data gate's narrative-layer guards (2026-09-03 spec): `remove`
// triggers, the story voice's 240-character ceiling, and commander.json's
// rank ordering.
//
// These live in their own module for the same reason tools/validate_map_grid.mjs's
// elevationFailures does: validate_data.mjs runs its whole sweep at import time
// and exits the process -- a test cannot import it. See map_grid.test.ts for
// the same idiom against the map gate's own elevation check.
import { describe, expect, it } from 'vitest';
import {
  commanderRankFailures,
  narrativeTextFailures,
  removeTriggerFailures,
} from '../validate_narrative.mjs';

describe('remove trigger guards', () => {
  const mission = (overrides: Record<string, unknown>) => ({
    starting_force: [{ unit: 'inf', count: 1, group: 'alpha' }],
    civilians: { groups: [{ unit: 'civ', count: 4, at: [1, 1], group: 'family' }] },
    triggers: [],
    ...overrides,
  });

  it('passes a remove naming a real, non-whole-force group', () => {
    const m = mission({
      triggers: [{ id: 'take_family', on: { kind: 'timer_s', value: 1 }, do: { kind: 'remove', group: 'family' } }],
    });
    expect(removeTriggerFailures(m, 'm.json')).toEqual([]);
  });

  it('refuses an unknown group, by trigger name', () => {
    const m = mission({
      triggers: [{ id: 'take_ghost', on: { kind: 'timer_s', value: 1 }, do: { kind: 'remove', group: 'nobody' } }],
    });
    const out = removeTriggerFailures(m, 'm.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('take_ghost');
    expect(out[0]).toContain('"nobody"');
    expect(out[0]).toContain('no placement declares');
  });

  it('refuses a remove whose group covers every starting_force entry', () => {
    const m = mission({
      triggers: [{ id: 'wipe', on: { kind: 'timer_s', value: 1 }, do: { kind: 'remove', group: 'alpha' } }],
    });
    const out = removeTriggerFailures(m, 'm.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('wipe');
    expect(out[0]).toContain('mission wipe');
  });

  it('allows a remove covering only SOME starting_force entries', () => {
    const m = mission({
      starting_force: [
        { unit: 'inf', count: 1, group: 'alpha' },
        { unit: 'inf', count: 1, group: 'bravo' },
      ],
      triggers: [{ id: 'take_alpha', on: { kind: 'timer_s', value: 1 }, do: { kind: 'remove', group: 'alpha' } }],
    });
    expect(removeTriggerFailures(m, 'm.json')).toEqual([]);
  });

  it('is silent when "group" itself is missing -- the schema if/then already requires it', () => {
    const m = mission({
      triggers: [{ id: 'broken', on: { kind: 'timer_s', value: 1 }, do: { kind: 'remove' } }],
    });
    expect(removeTriggerFailures(m, 'm.json')).toEqual([]);
  });

  it('ignores non-remove triggers entirely', () => {
    const m = mission({
      triggers: [{ id: 'pull_back', on: { kind: 'timer_s', value: 1 }, do: { kind: 'withdraw_to', group: 'nobody', to: 'rally' } }],
    });
    expect(removeTriggerFailures(m, 'm.json')).toEqual([]);
  });
});

describe('the 240-character story-voice limit', () => {
  // G12 (2026-09-06): a wave can speak, so its line is checked like a
  // trigger's -- text and speaker -- named by its clock, since a wave has no id.
  it('checks a wave say: over 240 characters fails, and so does an unknown speaker', () => {
    const tooLong = 'w'.repeat(241);
    const long = narrativeTextFailures(
      { enemy: { waves: [{ at_seconds: 90, units: [], say: { speaker: 'idit', text: tooLong } }] } },
      'm.json'
    );
    expect(long).toEqual([`m.json: wave @90s say.text is 241 characters, over the 240 limit`]);
    const who = narrativeTextFailures(
      { enemy: { waves: [{ at_seconds: 200, units: [], say: { speaker: 'narrator', text: 'fine' } }] } },
      'm.json'
    );
    expect(who).toHaveLength(1);
    expect(who[0]).toContain('wave @200s say.speaker is "narrator"');
    const ok = narrativeTextFailures(
      { enemy: { waves: [{ at_seconds: 90, units: [], say: { speaker: 'net', text: 'Movement north.' } }] } },
      'm.json'
    );
    expect(ok).toEqual([]);
  });

  const LONG = 'x'.repeat(241);
  const OK = 'x'.repeat(240);

  it('passes short dispatch/aftermath and a short victory+defeat debrief and short say text', () => {
    const m = {
      dispatch: OK,
      aftermath: OK,
      debrief: { victory: { speaker: 'shai', text: OK }, defeat: { speaker: 'idit', text: OK } },
      triggers: [{ id: 't1', on: { kind: 'timer_s', value: 1 }, do: { kind: 'spawn' }, say: { speaker: 'shai', text: OK } }],
      objectives: [{ id: 'o1', type: 'destroy_all', primary: true, say: { speaker: 'idit', text: OK }, say_on_fail: { speaker: 'net', text: OK } }],
    };
    expect(narrativeTextFailures(m, 'm.json')).toEqual([]);
  });

  it('rejects an over-length dispatch', () => {
    const out = narrativeTextFailures({ dispatch: LONG }, 'm.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('dispatch');
    expect(out[0]).toContain('241 characters');
  });

  it('rejects an over-length aftermath', () => {
    const out = narrativeTextFailures({ aftermath: LONG }, 'm.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('aftermath');
  });

  describe('debrief.victory / debrief.defeat (G11)', () => {
    it('passes a mission with only one variant declared', () => {
      const m = { debrief: { victory: { speaker: 'shai', text: OK } } };
      expect(narrativeTextFailures(m, 'm.json')).toEqual([]);
    });

    it('passes a mission with no debrief at all', () => {
      expect(narrativeTextFailures({}, 'm.json')).toEqual([]);
    });

    it('rejects an over-length victory and defeat text independently', () => {
      const m = { debrief: { victory: { speaker: 'shai', text: LONG }, defeat: { speaker: 'idit', text: LONG } } };
      const out = narrativeTextFailures(m, 'm.json');
      expect(out).toHaveLength(2);
      expect(out.some((f) => f.includes('debrief.victory.text'))).toBe(true);
      expect(out.some((f) => f.includes('debrief.defeat.text'))).toBe(true);
    });

    it('rejects an illegal speaker on either variant, independently', () => {
      const m = {
        debrief: {
          victory: { speaker: 'commander', text: OK },
          defeat: { speaker: 'idit', text: OK },
        },
      };
      const out = narrativeTextFailures(m, 'm.json');
      expect(out).toHaveLength(1);
      expect(out[0]).toContain('debrief.victory.speaker');
      expect(out[0]).toContain('"commander"');
      expect(out[0]).toContain('shai/idit/net/enemy');
    });
  });

  it('rejects an over-length trigger say.text, naming the trigger', () => {
    const m = {
      triggers: [{ id: 'radio_call', on: { kind: 'timer_s', value: 1 }, do: { kind: 'spawn' }, say: { speaker: 'shai', text: LONG } }],
    };
    const out = narrativeTextFailures(m, 'm.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('radio_call');
    expect(out[0]).toContain('say.text');
  });

  it('rejects an over-length objective say and say_on_fail independently, naming the objective', () => {
    const m = {
      objectives: [
        { id: 'hold', type: 'hold_for', primary: true, say: { speaker: 'idit', text: LONG }, say_on_fail: { speaker: 'net', text: LONG } },
      ],
    };
    const out = narrativeTextFailures(m, 'm.json');
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.includes('hold'))).toBe(true);
    expect(out.some((f) => f.includes('say_on_fail.text'))).toBe(true);
  });
});

describe('commander.json rank ordering', () => {
  const world = {
    regions: [
      { towns: [{ missions: ['m1', 'm2'] }] },
      { towns: [{ missions: ['m3'] }, { missions: ['m4', 'm5'] }] },
    ],
  };

  const goodCommander = {
    ranks: [
      { rank: 'Captain', stars: 2, until_mission: 'm2' },
      { rank: 'Major', stars: 3, until_mission: 'm4' },
      { rank: 'Colonel', stars: 5 },
    ],
  };

  it('passes ranks in ascending campaign order with a bare default last entry', () => {
    expect(commanderRankFailures(goodCommander, world, 'commander.json')).toEqual([]);
  });

  it('rejects an until_mission that names no real mission', () => {
    const bad = { ranks: [{ rank: 'Captain', stars: 2, until_mission: 'nope' }, { rank: 'Colonel', stars: 5 }] };
    const out = commanderRankFailures(bad, world, 'commander.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"nope"');
    expect(out[0]).toContain('not a mission listed');
  });

  it('rejects ranks out of campaign order', () => {
    const bad = {
      ranks: [
        { rank: 'Major', stars: 3, until_mission: 'm4' },
        { rank: 'Captain', stars: 2, until_mission: 'm2' },
        { rank: 'Colonel', stars: 5 },
      ],
    };
    const out = commanderRankFailures(bad, world, 'commander.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('Captain');
    expect(out[0]).toContain('not later in campaign order');
  });

  it('rejects a last entry that still declares until_mission', () => {
    const bad = { ranks: [{ rank: 'Colonel', stars: 5, until_mission: 'm5' }] };
    const out = commanderRankFailures(bad, world, 'commander.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('last entry');
    expect(out[0]).toContain('must have none');
  });

  it('rejects a non-last entry that omits until_mission', () => {
    const bad = {
      ranks: [
        { rank: 'Captain', stars: 2 },
        { rank: 'Colonel', stars: 5 },
      ],
    };
    const out = commanderRankFailures(bad, world, 'commander.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('Captain');
    expect(out[0]).toContain('only the final');
  });
});
