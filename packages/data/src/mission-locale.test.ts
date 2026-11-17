// applyMissionLocale — the mission-text locale overlay. See index.ts's own
// header comment on this section for the shape and why it lives beside the
// mission text rather than inside it.

import { describe, expect, it } from 'vitest';
import { applyMissionLocale, type MissionJson, type MissionLocaleOverlay } from './index';

function mission(): MissionJson {
  return {
    id: 'm1',
    name: 'Foothold',
    briefing: 'Take the ridge before dawn.',
    objectives: [
      { id: 'o1', text: 'Hold the crossing' },
      { id: 'o2', text: 'Clear the yard' },
    ],
    triggers: [
      { id: 't1', label: 'Enemy reinforcements arrive' },
      { id: 't2', label: 'Convoy departs' },
    ],
  };
}

describe('applyMissionLocale', () => {
  it('renames one objective and one trigger label, and leaves the rest identical', () => {
    const overlay: MissionLocaleOverlay = {
      m1: {
        objectives: { o1: 'Hold the ford' },
        triggers: { t1: 'Enemy reinforcements' },
      },
    };
    const out = applyMissionLocale(mission(), overlay);
    expect(out.objectives[0]).toEqual({ id: 'o1', text: 'Hold the ford' });
    expect(out.objectives[1]).toEqual(mission().objectives[1]);
    expect(out.triggers?.[0]).toEqual({ id: 't1', label: 'Enemy reinforcements' });
    expect(out.triggers?.[1]).toEqual(mission().triggers?.[1]);
    // Untouched fields carry the source text through unchanged.
    expect(out.name).toBe('Foothold');
    expect(out.briefing).toBe('Take the ridge before dawn.');
  });

  it('overlays name and briefing independently of objectives/triggers', () => {
    const overlay: MissionLocaleOverlay = {
      m1: { name: 'Point d’appui', briefing: 'Prenez la crête avant l’aube.' },
    };
    const out = applyMissionLocale(mission(), overlay);
    expect(out.name).toBe('Point d’appui');
    expect(out.briefing).toBe('Prenez la crête avant l’aube.');
    expect(out.objectives).toEqual(mission().objectives);
    expect(out.triggers).toEqual(mission().triggers);
  });

  it('is a no-op for a mission id the overlay does not name', () => {
    const overlay: MissionLocaleOverlay = { some_other_mission: { name: 'X' } };
    const m = mission();
    expect(applyMissionLocale(m, overlay)).toBe(m);
  });

  it('is a no-op for a null overlay -- the `en` case', () => {
    const m = mission();
    expect(applyMissionLocale(m, null)).toBe(m);
  });

  it('returns a new object, not the mission by reference, once it does overlay something', () => {
    const m = mission();
    const out = applyMissionLocale(m, { m1: { name: 'X' } });
    expect(out).not.toBe(m);
  });
});

// GH-1406 part 3: the rest of a mission's player-facing text. The fixture carries every field the overlay can now reach, and every
// expectation reads the source by hand rather than asking the function what it would do.
function rich(): MissionJson {
  return {
    id: 'm1',
    name: 'Foothold',
    briefing: 'A one. A two.',
    briefing_sections: [
      { id: 'situation', text: 'A one.', image: 'plate.png' },
      { id: 'mission', text: 'A two.' },
    ],
    dispatch: 'The dispatch.',
    aftermath: 'The aftermath.',
    hostages_place: 'the ford',
    debrief: { victory: { speaker: 'shai', text: 'Won.' }, defeat: { speaker: 'idit', text: 'Lost.' } },
    objectives: [
      { id: 'o1', text: 'Hold the crossing', say: { speaker: 'shai', text: 'Held.' }, say_on_fail: { speaker: 'idit', text: 'Gone.' } },
      { id: 'o2', text: 'Clear the yard' },
    ],
    triggers: [
      { id: 't1', label: 'Reinforcements', say: { speaker: 'net', text: 'They come.' } },
      { id: 't2', label: 'Convoy departs' },
    ],
    enemy: { waves: [{ say: { speaker: 'idit', text: 'First push.' } }, {}, { say: { speaker: 'idit', text: 'Third push.' } }] },
  };
}

describe('applyMissionLocale: dispatch, aftermath, hostages_place, debrief, sections and every radio line (GH-1406 part 3)', () => {
  it('replaces the three plain strings and leaves the rest', () => {
    const out = applyMissionLocale(rich(), { m1: { dispatch: 'D2', aftermath: 'A2', hostages_place: 'le gué' } });
    expect(out.dispatch).toBe('D2');
    expect(out.aftermath).toBe('A2');
    expect(out.hostages_place).toBe('le gué');
    expect(out.name).toBe('Foothold');
    expect(out.debrief).toEqual(rich().debrief);
  });

  it('replaces a debrief line’s TEXT and keeps its speaker, and only the line named', () => {
    const out = applyMissionLocale(rich(), { m1: { debrief: { victory: 'Gagné.' } } });
    expect(out.debrief?.victory).toEqual({ speaker: 'shai', text: 'Gagné.' });
    expect(out.debrief?.defeat).toEqual({ speaker: 'idit', text: 'Lost.' });
  });

  it('replaces an objective’s completion and failure lines by its id, keeping speaker and the objective text', () => {
    const out = applyMissionLocale(rich(), { m1: { objective_say: { o1: 'Tenu.' }, objective_say_on_fail: { o1: 'Perdu.' } } });
    expect(out.objectives[0]).toEqual({
      id: 'o1',
      text: 'Hold the crossing',
      say: { speaker: 'shai', text: 'Tenu.' },
      say_on_fail: { speaker: 'idit', text: 'Perdu.' },
    });
    expect(out.objectives[1]).toEqual(rich().objectives[1]);
  });

  it('replaces a trigger’s line by its id, keeping the label unless it is translated too', () => {
    const out = applyMissionLocale(rich(), { m1: { trigger_say: { t1: 'Ils viennent.' } } });
    expect(out.triggers?.[0]).toEqual({ id: 't1', label: 'Reinforcements', say: { speaker: 'net', text: 'Ils viennent.' } });
    expect(out.triggers?.[1]).toEqual(rich().triggers?.[1]);
    const both = applyMissionLocale(rich(), { m1: { triggers: { t1: 'Renforts' }, trigger_say: { t1: 'Ils viennent.' } } });
    expect(both.triggers?.[0]).toEqual({ id: 't1', label: 'Renforts', say: { speaker: 'net', text: 'Ils viennent.' } });
  });

  it('replaces a wave’s line by its INDEX, and leaves the wave with no line and the other wave alone', () => {
    const out = applyMissionLocale(rich(), { m1: { wave_say: { '2': 'Troisième.' } } });
    const waves = out.enemy?.waves ?? [];
    expect(waves[0]).toEqual({ say: { speaker: 'idit', text: 'First push.' } });
    expect(waves[1]).toEqual({});
    expect(waves[2]).toEqual({ say: { speaker: 'idit', text: 'Troisième.' } });
  });

  it('replaces a briefing section’s text by its id, keeping its image, and leaves the sections the overlay omits', () => {
    const out = applyMissionLocale(rich(), { m1: { briefing: 'Un. Deux.', sections: { situation: 'Un.' } } });
    expect(out.briefing_sections?.[0]).toEqual({ id: 'situation', text: 'Un.', image: 'plate.png' });
    expect(out.briefing_sections?.[1]).toEqual({ id: 'mission', text: 'A two.' });
    expect(out.briefing).toBe('Un. Deux.');
  });

  it('invents nothing: a field the mission lacks stays absent, whatever the overlay says', () => {
    const bare = mission();
    const out = applyMissionLocale(bare, {
      m1: {
        dispatch: 'x',
        aftermath: 'x',
        hostages_place: 'x',
        debrief: { victory: 'x' },
        sections: { situation: 'x' },
        objective_say: { o1: 'x' },
        trigger_say: { t1: 'x' },
        wave_say: { '0': 'x' },
      },
    });
    expect(out).toEqual(bare);
    expect('dispatch' in out || 'debrief' in out || 'briefing_sections' in out || 'enemy' in out).toBe(false);
  });

  it('does not mutate the mission it was given (a deep-frozen source survives)', () => {
    const frozen = JSON.parse(JSON.stringify(rich())) as MissionJson;
    const deepFreeze = (x: unknown): void => {
      if (x && typeof x === 'object') {
        for (const v of Object.values(x)) deepFreeze(v);
        Object.freeze(x);
      }
    };
    deepFreeze(frozen);
    const before = JSON.stringify(frozen);
    applyMissionLocale(frozen, { m1: { dispatch: 'D', debrief: { defeat: 'L' }, sections: { mission: 'M' }, wave_say: { '0': 'W' }, objective_say: { o1: 'S' }, trigger_say: { t1: 'T' } } });
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('an empty entry changes no text anywhere', () => {
    expect(applyMissionLocale(rich(), { m1: {} })).toEqual(rich());
  });
});
