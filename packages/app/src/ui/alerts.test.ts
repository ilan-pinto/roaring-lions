import { describe, expect, it } from 'vitest';
import { MISSION_EVENT_KINDS, type MissionEvent, type SimEvent } from '@lions/sim';
import { PINNED_COOLDOWN_TICKS, UNDER_FIRE_COOLDOWN_TICKS, alertsForTick, initAlertState, type AlertWorld } from './alerts';
import { MISSION_EVENT_SOUND, tickCue } from './cues';
import en from '../i18n/en.json';

const world: AlertWorld = {
  posOf: (e) => (e < 0 ? null : { x: e + 0.5, y: 10.5 }),
  sideOf: (e) => (e < 10 ? 0 : 1),
  unitName: (id) => (id === 'inf_squad' ? 'Rifle squad' : id === 'mbt_lavi' ? 'Lavi' : id),
  objectiveAt: (id) => (id === 'take_town' ? { x: 24, y: 24 } : null),
  // Entity 5 is a vehicle, 6 an aircraft, 7 a named veteran on foot.
  unitClass: (e) => (e === 5 ? 'vehicle' : e === 6 ? 'air' : 'foot'),
  isNamedVeteran: (e) => e === 7,
};
const lost = (entity: number, unit: string): MissionEvent =>
  ({ kind: 'unitLost', tick: 0, entity, side: 0, unit }) as MissionEvent;
const fire = (target: number): SimEvent =>
  ({ kind: 'fire', tick: 0, shooter: 99, target, weaponId: 'w', pHit: 0, roll: 0, willHit: false,
     breakdown: { accuracy: 0, rangeFalloff: 0, coverMod: 0, motionMod: 0, stanceMod: 0, suppressionMod: 0 } }) as SimEvent;

describe('alertsForTick — losses', () => {
  it('coalesces a squad wipe of one type into one line with a count', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [lost(0, 'inf_squad'), lost(1, 'inf_squad'), lost(2, 'inf_squad')], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'unitLost',
      count: 3,
      tier: 'important',
      cue: 'alert.important',
      line: { key: 'alert.unitLost', params: { name: 'Rifle squad', n: 3 }, tone: 'bad' },
    });
  });

  it('does not coalesce across unit types', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [lost(0, 'inf_squad'), lost(1, 'mbt_lavi')], world, 40);
    expect(alerts.map((a) => a.line?.params.name)).toEqual(['Rifle squad', 'Lavi']);
    expect(alerts.every((a) => a.count === 1)).toBe(true);
  });

  it('jumps to the first body of the group', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [lost(3, 'inf_squad'), lost(4, 'inf_squad')], world, 40);
    expect(alerts[0].at).toEqual({ x: 3.5, y: 10.5 });
  });
});

describe('alertsForTick — under fire', () => {
  it('raises one alert for the tick however many rounds land', () => {
    const { alerts } = alertsForTick(initAlertState(), [fire(1), fire(1), fire(2)], [], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'underFire', count: 2, tier: 'minor', cue: 'alert.minor' });
    expect(alerts[0].line).toEqual({ key: 'alert.underFire', params: { n: 2 }, tone: 'warn' });
  });

  it('holds its tongue for the cooldown, then speaks again', () => {
    const a = alertsForTick(initAlertState(), [fire(1)], [], world, 40);
    expect(a.alerts).toHaveLength(1);
    const b = alertsForTick(a.state, [fire(1)], [], world, 40 + UNDER_FIRE_COOLDOWN_TICKS - 1);
    expect(b.alerts).toHaveLength(0);
    const c = alertsForTick(b.state, [fire(1)], [], world, 40 + UNDER_FIRE_COOLDOWN_TICKS);
    expect(c.alerts).toHaveLength(1);
  });

  it('cools down per entity, not globally', () => {
    const a = alertsForTick(initAlertState(), [fire(1)], [], world, 40);
    const b = alertsForTick(a.state, [fire(2)], [], world, 41);
    expect(b.alerts).toHaveLength(1);
  });

  it('ignores a round aimed at an enemy, at a building, or at nobody', () => {
    const { alerts } = alertsForTick(initAlertState(), [fire(11), fire(-1)], [], world, 40);
    expect(alerts).toEqual([]);
  });

  // The loss is the louder fact and the shot that killed him lands in the same
  // tick. Two lines for one event is the noise this whole model exists to stop.
  it('says nothing about under fire for a unit lost in the same tick', () => {
    const { alerts } = alertsForTick(initAlertState(), [fire(0)], [lost(0, 'inf_squad')], world, 40);
    expect(alerts.map((a) => a.kind)).toEqual(['unitLost']);
  });
});

describe('alertsForTick — objectives', () => {
  it('sounds and jumps, and writes no line -- describeMissionEvent owns that', () => {
    const ev = { kind: 'objective', tick: 0, id: 'take_town', status: 'complete' } as MissionEvent;
    const { alerts } = alertsForTick(initAlertState(), [], [ev], world, 40);
    expect(alerts).toEqual([
      { kind: 'objective', line: null, tier: null, cue: 'objective.complete', at: { x: 24, y: 24 }, count: 1 },
    ]);
  });

  it('an objective the map cannot place still sounds', () => {
    const ev = { kind: 'objective', tick: 0, id: 'survive', status: 'complete' } as MissionEvent;
    const { alerts } = alertsForTick(initAlertState(), [], [ev], world, 40);
    expect(alerts[0]).toMatchObject({ cue: 'objective.complete', at: null });
  });

  it('is quiet on a tick with nothing in it, and returns the same state object', () => {
    const s = initAlertState();
    const out = alertsForTick(s, [], [], world, 40);
    expect(out.alerts).toEqual([]);
    expect(out.state).toBe(s);
  });
});

// Fix wave I3: `alerts.ts`'s doc comment says it returns catalogue KEYS and
// never calls `t()` itself -- true, but nothing ever pinned the two keys it
// actually emits (`alert.unitLost`, `alert.underFire`) against the catalogue
// that has to resolve them. A key renamed on one side only would render as
// itself, once per session, past `t()`'s own missing-key warning, and no
// existing spec above reads `en.json` at all.
//
// Falsified by hand: renaming `alert.underFire` in `en.json` (and reverting
// it) turns this red.
describe('alertsForTick — alert keys are in the catalogue', () => {
  it('emits only keys en.json actually defines', () => {
    const catalogue = en as Record<string, string>;
    const loss = alertsForTick(initAlertState(), [], [lost(0, 'inf_squad')], world, 40);
    const underFire = alertsForTick(initAlertState(), [fire(0), fire(1)], [], world, 40);
    const keys = [...loss.alerts, ...underFire.alerts]
      .map((a) => a.line?.key)
      .filter((k): k is string => k !== undefined && k !== null);
    expect(keys).toEqual(expect.arrayContaining(['alert.unitLost', 'alert.underFire']));
    for (const key of keys) expect(catalogue).toHaveProperty(key);
  });
});

// --- polish pass F: tiers, and the cue each event sounds ------------------

const ev = <K extends MissionEvent['kind']>(e: Extract<MissionEvent, { kind: K }>): MissionEvent => e;
const pinned = (entity: number): SimEvent => ({ kind: 'pinned', tick: 0, entity }) as SimEvent;
const ambush = (entity: number): SimEvent => ({ kind: 'ambushSprung', tick: 0, entity }) as SimEvent;

describe('alertsForTick — tiers (A2)', () => {
  it('a foot unit lost is important; a vehicle, an aircraft or a named veteran is major', () => {
    const tierOf = (entity: number) => alertsForTick(initAlertState(), [], [lost(entity, 'x')], world, 40).alerts[0]?.tier;
    expect(tierOf(0)).toBe('important');
    expect(tierOf(5)).toBe('major');
    expect(tierOf(6)).toBe('major');
    expect(tierOf(7)).toBe('major');
  });

  it('a group with one vehicle in it is major', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [lost(0, 'x'), lost(5, 'x')], world, 40);
    expect(alerts[0]).toMatchObject({ tier: 'major', cue: 'alert.major', count: 2 });
  });

  it('the three tiers are three different cues', () => {
    const minor = alertsForTick(initAlertState(), [fire(1)], [], world, 40).alerts[0]?.cue;
    const important = alertsForTick(initAlertState(), [], [lost(0, 'x')], world, 40).alerts[0]?.cue;
    const major = alertsForTick(initAlertState(), [], [lost(5, 'x')], world, 40).alerts[0]?.cue;
    expect(new Set([minor, important, major]).size).toBe(3);
  });

  it('a pinned man of ours sounds minor, once in four seconds; an enemy pinned sounds nothing', () => {
    const a = alertsForTick(initAlertState(), [pinned(1), pinned(2)], [], world, 40);
    expect(a.alerts).toEqual([{ kind: 'pinned', line: null, tier: 'minor', cue: 'alert.minor', at: { x: 1.5, y: 10.5 }, count: 1 }]);
    expect(alertsForTick(a.state, [pinned(3)], [], world, 40 + PINNED_COOLDOWN_TICKS - 1).alerts).toEqual([]);
    expect(alertsForTick(a.state, [pinned(3)], [], world, 40 + PINNED_COOLDOWN_TICKS).alerts).toHaveLength(1);
    expect(alertsForTick(initAlertState(), [pinned(12)], [], world, 40).alerts).toEqual([]);
  });

  it('an enemy ambush sprung is important; one of ours springing is not news', () => {
    expect(alertsForTick(initAlertState(), [ambush(12)], [], world, 40).alerts[0]).toMatchObject({ kind: 'ambush', tier: 'important' });
    expect(alertsForTick(initAlertState(), [ambush(2)], [], world, 40).alerts).toEqual([]);
  });

  it('a wave, a soldier taken and a Conduct penalty are important; a civilian taken is the feed alone', () => {
    const cueOf = (m: MissionEvent) => alertsForTick(initAlertState(), [], [m], world, 40).alerts.map((a) => a.cue);
    expect(cueOf(ev<'wave'>({ kind: 'wave', tick: 0, count: 4 }))).toEqual(['alert.important']);
    expect(cueOf(ev<'removed'>({ kind: 'removed', tick: 0, entity: 2, side: 0, unit: 'inf_squad' }))).toEqual(['alert.important']);
    expect(cueOf(ev<'roe'>({ kind: 'roe', tick: 0, penalty: 5, reason: 'r', score: 95 }))).toEqual(['alert.important']);
    expect(cueOf(ev<'removed'>({ kind: 'removed', tick: 0, entity: 2, side: 2, unit: 'civilian' }))).toEqual([]);
  });
});

describe('alertsForTick — objectives sound their status', () => {
  it('new, complete and failed are three different cues', () => {
    const cueOf = (status: 'active' | 'complete' | 'failed') =>
      alertsForTick(initAlertState(), [], [ev<'objective'>({ kind: 'objective', tick: 0, id: 'take_town', status })], world, 40).alerts[0]?.cue;
    expect(cueOf('active')).toBe('objective.active');
    expect(cueOf('complete')).toBe('objective.complete');
    expect(cueOf('failed')).toBe('objective.failed');
  });
});

/**
 * The cue map's behavioural half: `MISSION_EVENT_SOUND` (`cues.ts`) declares
 * what each kind may sound, and THIS proves the model actually sounds it --
 * a kind declared with cues raises one of them, a kind declared silent
 * raises none. `missionEnd` is the outcome, sounded by `main.ts`'s outcome
 * moment rather than by the alert model, so it is held to the outcome map
 * in `cues.test.ts` instead.
 */
describe('alertsForTick agrees with MISSION_EVENT_SOUND, kind by kind', () => {
  const sample: Record<MissionEvent['kind'], MissionEvent> = {
    objective: ev<'objective'>({ kind: 'objective', tick: 0, id: 'take_town', status: 'failed' }),
    trigger: ev<'trigger'>({ kind: 'trigger', tick: 0, id: 't' }),
    wave: ev<'wave'>({ kind: 'wave', tick: 0, count: 3 }),
    roe: ev<'roe'>({ kind: 'roe', tick: 0, penalty: 5, reason: 'r', score: 90 }),
    built: ev<'built'>({ kind: 'built', tick: 0, unit: 'inf_squad' }),
    evacuated: ev<'evacuated'>({ kind: 'evacuated', tick: 0, entity: 30 }),
    removed: ev<'removed'>({ kind: 'removed', tick: 0, entity: 2, side: 0, unit: 'inf_squad' }),
    unitLost: lost(5, 'mbt_lavi'),
    say: ev<'say'>({ kind: 'say', tick: 0, speaker: 'shai', text: 'x' }),
    missionEnd: ev<'missionEnd'>({ kind: 'missionEnd', tick: 0, result: 'victory', roeRating: 100, survivors: [], ledger: {} as never }),
  };
  it.each(MISSION_EVENT_KINDS.filter((k) => k !== 'missionEnd'))('%s', (kind) => {
    const cues = alertsForTick(initAlertState(), [], [sample[kind]], world, 40).alerts.map((a) => a.cue);
    const declared = MISSION_EVENT_SOUND[kind];
    if ('silent' in declared) {
      expect(cues).toEqual([]);
    } else {
      expect(cues.length).toBeGreaterThan(0);
      for (const c of cues) expect(declared.cues).toContain(c);
    }
  });
});

describe('tickCue: one cue a tick, the most urgent', () => {
  it('a major loss outranks an objective, which outranks fire taken', () => {
    expect(tickCue(['alert.minor', 'objective.complete', 'alert.major'])).toBe('alert.major');
    expect(tickCue(['alert.minor', 'objective.complete'])).toBe('objective.complete');
    expect(tickCue(['objective.complete', 'objective.failed'])).toBe('objective.failed');
    expect(tickCue([null, 'alert.minor'])).toBe('alert.minor');
    expect(tickCue([])).toBeNull();
  });
});
