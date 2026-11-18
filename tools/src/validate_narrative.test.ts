// The data gate's narrative-layer guards (2026-09-03 spec): `remove`
// triggers, the story voice's 240-character ceiling, and commander.json's
// rank ordering.
//
// These live in their own module for the same reason tools/validate_map_grid.mjs's
// elevationFailures does: validate_data.mjs runs its whole sweep at import time
// and exits the process -- a test cannot import it. See map_grid.test.ts for
// the same idiom against the map gate's own elevation check.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildEnglishUnits,
  commanderRankFailures,
  englishUnitFailures,
  narrativeTextFailures,
  overlayFailures,
  sourceHash,
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

// The oracle for every hash below is node's own SHA-256, written out here; no expected value is read back from `sourceHash`.
const h8 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);

describe('sourceHash (GH-1406 part 5)', () => {
  it('is the first 8 hex of the SHA-256 of the exact text (literal: sha256("abc") starts ba7816bf)', () => {
    expect(sourceHash('abc')).toBe('ba7816bf');
    expect(sourceHash('')).toBe('e3b0c442');
  });
  it('moves on a one-character edit, a trailing space and a case change', () => {
    const base = sourceHash('Hold the ford.');
    for (const edit of ['Hold the ford', 'Hold the ford. ', 'hold the ford.', 'Hold the fords.']) expect(sourceHash(edit), edit).not.toBe(base);
  });
});

describe('unitOverlayFailures (GH-1406)', () => {
  const units = new Map<string, object>([
    ['inf_squad', { id: 'inf_squad', name: 'Rifle Squad', blurb: 'Holds ground.' }],
    ['mbt_lavi', { id: 'mbt_lavi', name: 'Lavi' }],
  ]);
  const fine = { inf_squad: { name: 'Escouade', blurb: 'Tient.', src: { name: h8('Rifle Squad'), blurb: h8('Holds ground.') } } };

  it('passes a well-formed overlay, an empty one, and a null one', () => {
    expect(unitOverlayFailures('fr/units.json', { ...fine, mbt_lavi: { name: 'Lavi', src: { name: h8('Lavi') } } }, units)).toEqual([]);
    expect(unitOverlayFailures('fr/units.json', {}, units)).toEqual([]);
    expect(unitOverlayFailures('fr/units.json', null, units)).toEqual([]);
  });

  it('refuses a unit id that is not in data/units (a typo would otherwise do nothing forever)', () => {
    const out = unitOverlayFailures('fr/units.json', { inf_sqaud: { name: 'x' } }, units);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/inf_sqaud.*not a unit/);
  });

  it('refuses any key but name, blurb and src: an overlay is text, never stats', () => {
    const out = unitOverlayFailures('fr/units.json', { inf_squad: { ...fine.inf_squad, cost: 5 } }, units);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/"cost".*only name, blurb and src/);
  });

  it('refuses an empty, blank or non-string value', () => {
    expect(unitOverlayFailures('f', { inf_squad: { name: '' } }, units).join('\n')).toContain('name must be a non-empty string');
    expect(unitOverlayFailures('f', { inf_squad: { blurb: '   ' } }, units).join('\n')).toContain('blurb must be a non-empty string');
    expect(unitOverlayFailures('f', { inf_squad: { name: 7 } }, units).join('\n')).toContain('name must be a non-empty string');
  });

  it('reports every failure, not the first', () => {
    expect(unitOverlayFailures('f', { nope: { name: 'x' }, inf_squad: { name: '', wat: 1 } }, units)).toHaveLength(3);
  });

  it('refuses a blurb for a unit that has none (applyUnitLocale would drop it)', () => {
    expect(unitOverlayFailures('f', { mbt_lavi: { blurb: 'x', src: { blurb: 'abcdef12' } } }, units).join('\n')).toContain('translates blurb, which the unit does not have');
  });

  describe('the stale-translation guard', () => {
    it('refuses a translated name or blurb with no src hash, naming the hash to copy', () => {
      const out = unitOverlayFailures('f', { inf_squad: { name: 'Escouade', blurb: 'Tient.' } }, units).join('\n');
      expect(out).toContain(`translates name but carries no src hash for it: copy src.name (${h8('Rifle Squad')})`);
      expect(out).toContain(`translates blurb but carries no src hash for it: copy src.blurb (${h8('Holds ground.')})`);
    });
    it('goes red when the English is edited after the translation (a fixture unit whose blurb changed)', () => {
      const edited = new Map(units);
      edited.set('inf_squad', { id: 'inf_squad', name: 'Rifle Squad', blurb: 'Holds ground and garrisons.' });
      expect(unitOverlayFailures('f', fine, units)).toEqual([]);
      const out = unitOverlayFailures('f', fine, edited);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(`blurb is stale: it was translated from English ${h8('Holds ground.')}, and the English is now ${h8('Holds ground and garrisons.')}`);
    });
    it('refuses a src that names a field the entry does not translate, an unknown field, a malformed hash and a non-object', () => {
      const one = (src: unknown) => unitOverlayFailures('f', { inf_squad: { name: 'E', src } }, units).join('\n');
      expect(one({ name: h8('Rifle Squad'), blurb: h8('Holds ground.') })).toContain('src names blurb, which this entry does not translate');
      expect(one({ name: h8('Rifle Squad'), cost: 'abcdef12' })).toContain('src carries "cost"');
      expect(one({ name: 'ABCDEF12' })).toContain('src.name is not 8 lowercase hex characters');
      expect(one('x')).toContain('src is not an object');
    });
  });
});

describe('the English unit catalogue (GH-1406 part 5)', () => {
  const units = [
    { id: 'b_unit', name: 'Bee', blurb: 'Buzzes.' },
    { id: 'a_unit', name: 'Ay' },
  ];
  const good = () => JSON.parse(JSON.stringify(buildEnglishUnits(units))) as Record<string, Record<string, unknown>>;
  it('is sorted by id, carries each text with its hash, and has no blurb key for a unit with none', () => {
    expect(good()).toEqual({
      a_unit: { name: 'Ay', src: { name: h8('Ay') } },
      b_unit: { name: 'Bee', blurb: 'Buzzes.', src: { name: h8('Bee'), blurb: h8('Buzzes.') } },
    });
    expect(Object.keys(good())).toEqual(['a_unit', 'b_unit']);
  });
  it('passes itself, and fails on an edit to a text, to a hash, a missing and a stale entry', () => {
    expect(englishUnitFailures('en/units.json', good(), units)).toEqual([]);
    const text = good();
    text.b_unit.blurb = 'Buzzes loudly.';
    expect(englishUnitFailures('en/units.json', text, units).join('\n')).toContain('unit "b_unit" blurb differs from the unit file');
    const hash = good();
    (hash.b_unit.src as Record<string, string>).name = '00000000';
    expect(englishUnitFailures('en/units.json', hash, units).join('\n')).toContain('unit "b_unit" src.name is not the hash of the unit file');
    const gone = good();
    delete gone.a_unit;
    expect(englishUnitFailures('en/units.json', gone, units).join('\n')).toContain('no entry for unit "a_unit"');
    expect(englishUnitFailures('en/units.json', { ...good(), ghost: { name: 'x', src: {} } }, units).join('\n')).toContain('"ghost", which is not a unit in data/units (stale)');
    expect(englishUnitFailures('en/units.json', null, units)).toHaveLength(1);
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
  // The English of `rich()` by path, written out by hand: `stamp` adds the src block an up-to-date translation of it would carry.
  const ENGLISH: Record<string, string> = {
    dispatch: 'The dispatch.', aftermath: 'The aftermath.', hostages_place: 'the ford', 'debrief.victory': 'Won.', 'debrief.defeat': 'Lost.',
    briefing: 'A one. A two.', 'sections.situation': 'A one.', 'sections.mission': 'A two.',
    'objective_say.o1': 'Held.', 'objective_say_on_fail.o1': 'Gone.', 'trigger_say.t1': 'They come.', 'wave_say.0': 'First.',
  };
  const stamp = (entry: Record<string, unknown>): Record<string, unknown> => {
    const src: Record<string, string> = {};
    for (const [key, v] of Object.entries(entry)) {
      if (typeof v === 'string') {
        if (key in ENGLISH) src[key] = h8(ENGLISH[key]);
      } else if (v !== null && typeof v === 'object') {
        for (const k of Object.keys(v)) if (`${key}.${k}` in ENGLISH) src[`${key}.${k}`] = h8(ENGLISH[`${key}.${k}`]);
      }
    }
    return { ...entry, src };
  };
  const run = (entry: Record<string, unknown>, missions: Map<string, object> = rich()) => overlayFailures('fr/missions.json', { m1: entry }, missions);

  it('passes a full, consistent translation of every field', () => {
    expect(
      run(stamp({
        name: 'N', briefing: 'Un. Deux.', sections: { situation: 'Un.', mission: 'Deux.' },
        dispatch: 'D', aftermath: 'A', hostages_place: 'le gué', debrief: { victory: 'V', defeat: 'L' },
        objectives: { o1: 'O' }, objective_say: { o1: 'S' }, objective_say_on_fail: { o1: 'F' },
        triggers: { t1: 'T' }, trigger_say: { t1: 'TS' }, wave_say: { '0': 'W' },
      }))
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

  // GH-1406 part 5: the stale-translation guard. A key says WHICH line; only the hash says which English the translator read.
  describe('the stale-translation guard', () => {
    const waveMission = (texts: string[]) => new Map([['m1', { id: 'm1', objectives: [], enemy: { waves: texts.map((t) => ({ say: say(t) })) } }]]);

    it('goes red when the waves are reordered under a wave_say keyed by index (the case the keys alone cannot see)', () => {
      // translated while the waves read [A, B]; each translation carries the hash of the English at its index
      const translated = { wave_say: { '0': "A'", '1': "B'" }, src: { 'wave_say.0': h8('A. Hold the ford.'), 'wave_say.1': h8('B. Fall back.') } };
      expect(run(translated, waveMission(['A. Hold the ford.', 'B. Fall back.']))).toEqual([]);
      const out = run(translated, waveMission(['B. Fall back.', 'A. Hold the ford.']));
      expect(out).toHaveLength(2);
      expect(out[0]).toContain(`"wave_say.0" is stale: it was translated from English ${h8('A. Hold the ford.')}, and the English is now ${h8('B. Fall back.')}`);
      expect(out[1]).toContain('"wave_say.1" is stale');
    });
    it('goes red when a wave is inserted ahead of a translated one', () => {
      const translated = { wave_say: { '0': "A'" }, src: { 'wave_say.0': h8('A. Hold the ford.') } };
      expect(run(translated, waveMission(['A. Hold the ford.']))).toEqual([]);
      expect(run(translated, waveMission(['New first wave.', 'A. Hold the ford.'])).join('\n')).toContain('"wave_say.0" is stale');
    });
    it('goes red on an edit to any one source line, however small, in every group', () => {
      const entry = stamp({
        briefing: 'Un. Deux.', sections: { situation: 'Un.', mission: 'Deux.' }, dispatch: 'D', aftermath: 'A', hostages_place: 'le gué',
        debrief: { victory: 'V', defeat: 'L' }, objective_say: { o1: 'S' }, objective_say_on_fail: { o1: 'F' }, trigger_say: { t1: 'TS' }, wave_say: { '0': 'W' },
      });
      expect(run(entry)).toEqual([]);
      const base = rich().get('m1') as Record<string, unknown>;
      const edited = (patch: Record<string, unknown>): Map<string, object> => new Map([['m1', { ...base, ...patch }]]);
      const sayEdit = (t: string) => ({ speaker: 'idit', text: t });
      const cases: [string, Map<string, object>][] = [
        ['dispatch', edited({ dispatch: 'The dispatch!' })],
        ['aftermath', edited({ aftermath: 'The aftermath, later.' })],
        ['hostages_place', edited({ hostages_place: 'the ford ' })],
        ['debrief.victory', edited({ debrief: { victory: sayEdit('Won!'), defeat: sayEdit('Lost.') } })],
        ['debrief.defeat', edited({ debrief: { victory: sayEdit('Won.'), defeat: sayEdit('Lost!') } })],
        ['objective_say.o1', edited({ objectives: [{ id: 'o1', say: sayEdit('Held!'), say_on_fail: sayEdit('Gone.') }, { id: 'o2' }] })],
        ['objective_say_on_fail.o1', edited({ objectives: [{ id: 'o1', say: sayEdit('Held.'), say_on_fail: sayEdit('Gone!') }, { id: 'o2' }] })],
        ['trigger_say.t1', edited({ triggers: [{ id: 't1', say: sayEdit('They come!') }, { id: 't2' }] })],
        ['wave_say.0', edited({ enemy: { waves: [{ say: sayEdit('First!') }, {}] } })],
        ['sections.situation', edited({ briefing_sections: [{ id: 'situation', text: 'A one!' }, { id: 'mission', text: 'A two.' }] })],
        ['briefing', edited({ briefing: 'A one. A two!' })],
      ];
      for (const [path, ms] of cases) {
        const out = run(entry, ms).filter((f) => f.includes(`"${path}" is stale`));
        expect(out, path).toHaveLength(1);
      }
    });
    it('goes red for a translated string that has no src hash, and names the hash to copy', () => {
      const out = run({ dispatch: 'D', wave_say: { '0': 'W' } });
      expect(out.join('\n')).toContain(`translates "dispatch" but carries no src hash for it: copy src "dispatch" (${h8('The dispatch.')})`);
      expect(out.join('\n')).toContain(`translates "wave_say.0" but carries no src hash for it: copy src "wave_say.0" (${h8('First.')})`);
    });
    it('needs no hash for a string whose English the mission does not carry (nothing to be stale against)', () => {
      expect(overlayFailures('fr/missions.json', { m1: { objectives: { o1: 'O' }, triggers: { t1: 'T' } } }, bare())).toEqual([]);
    });
    it('refuses a src entry for a path the entry does not translate, a malformed hash, and a src that is not an object', () => {
      const stamped = stamp({ dispatch: 'D' });
      expect(run({ ...stamped, src: { ...(stamped.src as object), aftermath: h8('The aftermath.') } }).join('\n')).toContain('src names "aftermath", which this entry does not translate');
      expect(run({ dispatch: 'D', src: { dispatch: 'XYZ' } }).join('\n')).toContain('is stale');
      // an uppercase copy of the right hash is wrong twice over: stale against the English, and malformed where the English is absent
      expect(run({ dispatch: 'D', src: { dispatch: h8('The dispatch.').toUpperCase() } }).join('\n')).toContain('"dispatch" is stale');
      expect(overlayFailures('fr/missions.json', { m1: { objectives: { o1: 'O' }, src: { 'objectives.o1': 'XYZ' } } }, bare()).join('\n')).toContain('src "objectives.o1" is not 8 lowercase hex characters');
      expect(run({ dispatch: 'D', src: 'abc' }).join('\n')).toContain('overlay src is not an object');
    });
    it('accepts a translation of only some strings, as long as each carries its hash', () => {
      expect(run(stamp({ dispatch: 'D', wave_say: { '0': 'W' } }))).toEqual([]);
    });
  });
});
