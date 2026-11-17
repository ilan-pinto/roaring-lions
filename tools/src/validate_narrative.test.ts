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
  overlayFailures,
  unitOverlayFailures,
  removeTriggerFailures,
  triggerLabelFailures,
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

describe('triggerLabelFailures', () => {
  it('names every non-remove trigger without a label', () => {
    const mission = {
      triggers: [
        { id: 'a', on: { kind: 'timer_s', value: 5 }, do: { kind: 'commit', group: 'g' } },
        { id: 'b', on: { kind: 'timer_s', value: 5 }, do: { kind: 'remove', group: 'g' } },
        { id: 'c', on: { kind: 'timer_s', value: 5 }, do: { kind: 'spawn', units: [] }, label: 'Enemy reinforcements arrive' },
      ],
    };
    expect(triggerLabelFailures(mission, 'm.json')).toEqual(['m.json: trigger "a" (commit) has no label']);
  });
  it('rejects a label over 48 characters or with a trailing full stop', () => {
    const mission = {
      triggers: [
        { id: 'a', on: { kind: 'timer_s', value: 5 }, do: { kind: 'commit', group: 'g' }, label: 'x'.repeat(49) },
        { id: 'b', on: { kind: 'timer_s', value: 5 }, do: { kind: 'commit', group: 'g' }, label: 'Enemy commits.' },
      ],
    };
    expect(triggerLabelFailures(mission, 'm.json')).toEqual([
      'm.json: trigger "a" label is 49 characters (max 48)',
      'm.json: trigger "b" label ends in a full stop',
    ]);
  });

  // T1-a (shell-upgrade Phase 0 final review): this function used to take
  // (file, mission), reversing removeTriggerFailures/narrativeTextFailures's
  // (mission, label) order -- and the one call site (validate_data.mjs) is
  // plain JS, untypechecked, so a swap there degraded to `mission.triggers`
  // read off a STRING (`undefined`), `?? []`, and a gate that silently
  // returned []  rather than naming the mismatch. The signature is now
  // (mission, file), matching its siblings, and it throws instead of
  // degrading when the first argument is not a mission-shaped object.
  it('throws rather than silently returning [] when the arguments are swapped', () => {
    const mission = {
      triggers: [{ id: 'a', on: { kind: 'timer_s', value: 5 }, do: { kind: 'commit', group: 'g' } }],
    };
    // @ts-expect-error -- exercising the swapped-argument call the gate must reject
    expect(() => triggerLabelFailures('m.json', mission)).toThrow(/expected a mission object/);
  });
});

describe('overlayFailures', () => {
  const missions = () =>
    new Map([
      [
        'm1',
        {
          id: 'm1',
          objectives: [{ id: 'o1' }, { id: 'o2' }],
          triggers: [{ id: 't1' }, { id: 't2' }],
        },
      ],
    ]);

  it('passes an overlay that names only real mission/objective/trigger ids', () => {
    const overlay = {
      m1: { name: 'X', objectives: { o1: 'Y' }, triggers: { t1: 'Z' } },
    };
    expect(overlayFailures('en.json', overlay, missions())).toEqual([]);
  });

  it('rejects an overlay naming a bogus objective id', () => {
    const overlay = { m1: { objectives: { ghost: 'Y' } } };
    const out = overlayFailures('fr/missions.json', overlay, missions());
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"ghost"');
    expect(out[0]).toContain('not an objective');
  });

  it('rejects an overlay naming a bogus trigger id', () => {
    const overlay = { m1: { triggers: { ghost: 'Y' } } };
    const out = overlayFailures('fr/missions.json', overlay, missions());
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"ghost"');
    expect(out[0]).toContain('not a trigger');
  });

  it('rejects an overlay naming a mission that does not exist', () => {
    const out = overlayFailures('fr/missions.json', { ghost_mission: { name: 'X' } }, missions());
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"ghost_mission"');
    expect(out[0]).toContain('not a mission in data/missions');
  });

  it('rejects a trigger label override over the 48-character cap', () => {
    const overlay = { m1: { triggers: { t1: 'x'.repeat(49) } } };
    const out = overlayFailures('fr/missions.json', overlay, missions());
    expect(out).toEqual(['fr/missions.json: mission "m1" trigger "t1" overlay label is 49 characters (max 48)']);
  });

  it('is silent on an empty overlay', () => {
    expect(overlayFailures('fr/missions.json', {}, missions())).toEqual([]);
  });
});

describe('unitOverlayFailures (GH-1406)', () => {
  const ids = new Set(['inf_squad', 'mbt_lavi']);

  it('passes a well-formed overlay, an empty one, and a null one', () => {
    expect(unitOverlayFailures('fr/units.json', { inf_squad: { name: 'Escouade', blurb: 'Fantassins.' }, mbt_lavi: { name: 'Lavi' } }, ids)).toEqual([]);
    expect(unitOverlayFailures('fr/units.json', {}, ids)).toEqual([]);
    expect(unitOverlayFailures('fr/units.json', null, ids)).toEqual([]);
  });

  it('refuses a unit id that is not in data/units (a typo would otherwise do nothing forever)', () => {
    const out = unitOverlayFailures('fr/units.json', { inf_sqaud: { name: 'x' } }, ids);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/inf_sqaud.*not a unit/);
  });

  it('refuses any key but name and blurb: an overlay is text, never stats', () => {
    const out = unitOverlayFailures('fr/units.json', { inf_squad: { name: 'x', cost: 5 } }, ids);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/"cost".*only name and blurb/);
  });

  it('refuses an empty, blank or non-string value', () => {
    expect(unitOverlayFailures('f', { inf_squad: { name: '' } }, ids)).toHaveLength(1);
    expect(unitOverlayFailures('f', { inf_squad: { blurb: '   ' } }, ids)).toHaveLength(1);
    expect(unitOverlayFailures('f', { inf_squad: { name: 7 } }, ids)).toHaveLength(1);
  });

  it('reports every failure, not the first', () => {
    expect(unitOverlayFailures('f', { nope: { name: 'x' }, inf_squad: { name: '', wat: 1 } }, ids)).toHaveLength(3);
  });
});

// GH-1406 part 3: the overlay validator on the rest of the mission text. Each case is one constructed fault and the sentence that names it.
describe('overlayFailures: dispatch, aftermath, hostages_place, debrief, sections and radio lines', () => {
  const say = (text: string) => ({ speaker: 'idit', text });
  const rich = () =>
    new Map([
      [
        'm1',
        {
          id: 'm1',
          dispatch: 'The dispatch.',
          aftermath: 'The aftermath.',
          hostages_place: 'the ford',
          debrief: { victory: say('Won.'), defeat: say('Lost.') },
          briefing: 'A one. A two.',
          briefing_sections: [
            { id: 'situation', text: 'A one.' },
            { id: 'mission', text: 'A two.' },
          ],
          objectives: [{ id: 'o1', say: say('Held.'), say_on_fail: say('Gone.') }, { id: 'o2' }],
          triggers: [{ id: 't1', say: say('They come.') }, { id: 't2' }],
          enemy: { waves: [{ say: say('First.') }, {}] },
        },
      ],
    ]);
  const bare = () => new Map([['m1', { id: 'm1', objectives: [{ id: 'o1' }], triggers: [{ id: 't1' }] }]]);
  const run = (entry: Record<string, unknown>, missions: Map<string, object> = rich()) => overlayFailures('fr/missions.json', { m1: entry }, missions);

  it('passes a full, consistent translation of every field', () => {
    expect(
      run({
        name: 'N', briefing: 'Un. Deux.', sections: { situation: 'Un.', mission: 'Deux.' },
        dispatch: 'D', aftermath: 'A', hostages_place: 'le gué', debrief: { victory: 'V', defeat: 'L' },
        objectives: { o1: 'O' }, objective_say: { o1: 'S' }, objective_say_on_fail: { o1: 'F' },
        triggers: { t1: 'T' }, trigger_say: { t1: 'TS' }, wave_say: { '0': 'W' },
      })
    ).toEqual([]);
  });
  it('rejects a key the overlay does not read (a typo would no-op for ever)', () => {
    expect(run({ dispach: 'x' }).join('\n')).toContain('carries "dispach", which the overlay does not read');
  });
  it('rejects a dispatch, aftermath or hostages_place the mission does not have', () => {
    const out = overlayFailures('fr/missions.json', { m1: { dispatch: 'x', aftermath: 'x', hostages_place: 'x' } }, bare()).join('\n');
    expect(out).toContain('translates dispatch, which the mission does not have');
    expect(out).toContain('translates aftermath, which the mission does not have');
    expect(out).toContain('translates hostages_place, which the mission does not have');
  });
  it('holds the source caps on a translation: 240 for dispatch, aftermath and a radio line, 40 for hostages_place, 48 for a label', () => {
    const long = 'x'.repeat(241);
    const out = run({ dispatch: long, aftermath: long, hostages_place: 'x'.repeat(41), objective_say: { o1: long }, debrief: { victory: long }, triggers: { t1: 'x'.repeat(49) } }).join('\n');
    expect(out).toContain('dispatch is 241 characters (max 240)');
    expect(out).toContain('aftermath is 241 characters (max 240)');
    expect(out).toContain('hostages_place is 41 characters (max 40)');
    expect(out).toContain('objective_say "o1" is 241 characters (max 240)');
    expect(out).toContain('debrief victory is 241 characters (max 240)');
    expect(out).toContain('trigger "t1" overlay label is 49 characters (max 48)');
  });
  it('rejects an empty or non-string value', () => {
    const out = run({ dispatch: '', briefing: 7 as unknown as string, objectives: { o1: ' ' } }).join('\n');
    expect(out).toContain('dispatch is not a non-empty string');
    expect(out).toContain('briefing is not a non-empty string');
    expect(out).toContain('objective "o1" is not a non-empty string');
  });
  it('rejects a radio-line key naming something with no line of that kind', () => {
    const out = run({ objective_say: { o2: 'x', ghost: 'x' }, objective_say_on_fail: { o2: 'x' }, trigger_say: { t2: 'x' }, wave_say: { '1': 'x', '7': 'x', first: 'x' } }).join('\n');
    expect(out).toContain('objective_say names objective "o2", which has no such line');
    expect(out).toContain('objective_say names objective "ghost"');
    expect(out).toContain('objective_say_on_fail names objective "o2"');
    expect(out).toContain('trigger_say names trigger "t2"');
    expect(out).toContain('wave_say names wave index "1"');
    expect(out).toContain('wave_say names wave index "7"');
    expect(out).toContain('wave_say names wave index "first"');
  });
  it('rejects a debrief side that is not victory or defeat, or that the mission lacks', () => {
    expect(run({ debrief: { draw: 'x' } }).join('\n')).toContain('debrief carries "draw"');
    const half = new Map([['m1', { id: 'm1', objectives: [], debrief: { victory: say('Won.') } }]]);
    expect(run({ debrief: { defeat: 'x' } }, half).join('\n')).toContain('translates the defeat debrief line, which the mission does not have');
  });
  it('rejects sections on a mission with none, a section it lacks, and a partial set', () => {
    expect(overlayFailures('fr/missions.json', { m1: { sections: { situation: 'x' } } }, bare()).join('\n')).toContain('translates sections, which the mission does not have');
    expect(run({ briefing: 'x', sections: { notes: 'x' } }).join('\n')).toContain('names section "notes", which is not a section of that mission');
    expect(run({ briefing: 'Un.', sections: { situation: 'Un.' } }).join('\n')).toContain('gives some sections but not "mission": all or none');
  });
  it('rejects sections without a briefing, and sections that do not join to the translated briefing exactly', () => {
    expect(run({ sections: { situation: 'Un.', mission: 'Deux.' } }).join('\n')).toContain('translates the sections but not the briefing');
    expect(run({ briefing: 'Un.  Deux.', sections: { situation: 'Un.', mission: 'Deux.' } }).join('\n')).toContain('do not spell the overlay briefing exactly');
  });
});
