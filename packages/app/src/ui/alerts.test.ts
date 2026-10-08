import { describe, expect, it } from 'vitest';
import type { MissionEvent, SimEvent } from '@lions/sim';
import { MISSION_EVENT_KINDS } from '@lions/sim';
import { MISSION_EVENT_SOUND, tickCue } from './cues';
import {
  PINNED_COOLDOWN_TICKS,
  UNDER_FIRE_COOLDOWN_TICKS,
  alertsForTick,
  initAlertState,
  missionEventTier,
  nextJump,
  type AlertWorld,
} from './alerts';
import en from '../i18n/en.json';

// Entities 0-9 are ours, 10-29 the enemy's, 30+ civilians (side 2). Entity e
// stands at (e + 0.5, 10.5); the "camera" sees x < 5, and everything further
// east is east of it. Entities 7 and 17 are tanks, one each side.
const world: AlertWorld = {
  posOf: (e) => (e < 0 ? null : { x: e + 0.5, y: 10.5 }),
  sideOf: (e) => (e < 10 ? 0 : e < 30 ? 1 : 2),
  typeOf: (e) => (e === 7 || e === 17 ? 'mbt_lavi' : 'inf_squad'),
  unitName: (id) => (id === 'inf_squad' ? 'Rifle squad' : id === 'mbt_lavi' ? 'Lavi' : id),
  objectiveAt: (id) => (id === 'take_town' ? { x: 24, y: 24 } : null),
  placeOf: (x) => (x < 5 ? 'here' : 'e'),
  lossTier: (_e, id) => (id === 'mbt_lavi' ? 'major' : 'important'),
  waves: [],
  objectiveDone: () => false,
  markerAt: () => null,
  arrivedAt: () => null,
  reinforcement: () => null,
};
const destroyed = (entity: number, by: number): SimEvent => ({ kind: 'destroyed', tick: 0, entity, by }) as SimEvent;
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
      line: { key: 'alert.unitLost', params: { name: 'Rifle squad', n: 3 }, tone: 'bad', place: ['here'] },
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
    expect(alerts[0]).toMatchObject({ kind: 'underFire', count: 2, cue: 'alert.minor', tier: 'minor' });
    expect(alerts[0].line).toEqual({
      key: 'alert.underFire',
      params: { name: 'Rifle squad', more: 1 },
      tone: 'warn',
      place: ['here'],
    });
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
      {
        kind: 'objective',
        tier: 'major',
        tone: 'good',
        line: null,
        cue: 'objective.complete',
        at: { x: 24, y: 24 },
        marks: [{ x: 24, y: 24 }],
        count: 1,
      },
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
    const kill = alertsForTick(initAlertState(), [destroyed(12, 1)], [], world, 40);
    const keys = [...loss.alerts, ...underFire.alerts, ...kill.alerts]
      .map((a) => a.line?.key)
      .filter((k): k is string => k !== undefined && k !== null);
    expect(keys).toEqual(expect.arrayContaining(['alert.unitLost', 'alert.underFire', 'alert.kill']));
    for (const key of keys) expect(catalogue).toHaveProperty(key);
  });
});

// WP-P5 (PA-06): every alert names the unit and a place.
describe('alertsForTick — who and where', () => {
  it('names the first unit under fire, counts the rest, and places each of them', () => {
    const { alerts } = alertsForTick(initAlertState(), [fire(1), fire(7), fire(2)], [], world, 40);
    expect(alerts[0].line).toMatchObject({
      params: { name: 'Rifle squad', more: 2 },
      // entity 7 stands east of the camera; 1 and 2 are in view.
      place: ['here', 'e'],
    });
  });

  it('places a loss where the body fell', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [lost(7, 'mbt_lavi')], world, 40);
    expect(alerts[0].line?.place).toEqual(['e']);
  });
});

describe('alertsForTick — tiers (C3, shared with the audio cue tiers)', () => {
  it('a vehicle lost is major, a foot unit lost is important, under fire is minor', () => {
    const { alerts } = alertsForTick(
      initAlertState(),
      [fire(3)],
      [lost(7, 'mbt_lavi'), lost(1, 'inf_squad')],
      world,
      40
    );
    expect(alerts.map((a) => [a.kind, a.line?.params.name, a.tier])).toEqual([
      ['unitLost', 'Lavi', 'major'],
      ['unitLost', 'Rifle squad', 'important'],
      ['underFire', 'Rifle squad', 'minor'],
    ]);
  });

  it('a new tasking is important, a completed or failed objective major', () => {
    const ev = (status: string) => ({ kind: 'objective', tick: 0, id: 'take_town', status }) as MissionEvent;
    const tiers = ['active', 'complete', 'failed'].map(
      (st) => alertsForTick(initAlertState(), [], [ev(st)], world, 40).alerts[0].tier
    );
    expect(tiers).toEqual(['important', 'major', 'major']);
    expect(missionEventTier(ev('active'))).toBe('important');
    expect(missionEventTier(ev('failed'))).toBe('major');
  });
});

describe('alertsForTick — arrivals', () => {
  const waves = [
    { at_seconds: 18, units: [{ count: 1, from: 'east_gate' }, { count: 2, from: 'west_gate' }] },
    { at_seconds: 18, units: [{ count: 3, from: 'east_gate' }] },
    { at_seconds: 0, trigger: 'take_town', units: [{ count: 4, from: 'west_gate' }] },
  ];
  const markers: Record<string, { x: number; y: number }> = { east_gate: { x: 40, y: 10 }, west_gate: { x: 1, y: 10 } };
  const waveWorld: AlertWorld = { ...world, waves, markerAt: (m) => markers[m] ?? null };
  const wave = (tick: number, count: number) => ({ kind: 'wave', tick, count }) as MissionEvent;

  it('says where a wave enters, and jumps to its heaviest entry', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [wave(360, 3)], waveWorld, 360);
    expect(alerts[0]).toMatchObject({
      kind: 'wave',
      tier: 'important',
      line: { key: 'alert.wave', params: { n: 3 }, place: ['e', 'here'] },
      at: { x: 1, y: 10 },
      marks: [{ x: 40, y: 10 }, { x: 1, y: 10 }],
    });
  });

  it('two waves in one tick are the first two due, in authored order, each once', () => {
    const a = alertsForTick(initAlertState(), [], [wave(360, 3), wave(360, 3)], waveWorld, 360);
    expect(a.alerts.map((x) => x.line?.place)).toEqual([['e', 'here'], ['e']]);
    // The trigger wave is not due until its objective is complete.
    const done: AlertWorld = { ...waveWorld, objectiveDone: (id) => id === 'take_town' };
    const b = alertsForTick(a.state, [], [wave(900, 4)], done, 900);
    expect(b.alerts[0].line?.place).toEqual(['here']);
  });

  it('says where the dock delivered a unit', () => {
    const dockWorld: AlertWorld = { ...world, arrivedAt: (id) => (id === 'mbt_lavi' ? { x: 30, y: 3 } : null) };
    const { alerts } = alertsForTick(
      initAlertState(),
      [],
      [{ kind: 'built', tick: 0, unit: 'mbt_lavi' } as MissionEvent],
      dockWorld,
      40
    );
    expect(alerts[0]).toMatchObject({
      kind: 'arrival',
      // VR-37: an arrival of ours is minor and info, dock or scripted.
      tier: 'minor',
      tone: 'info',
      line: { key: 'alert.arrived', params: { name: 'Lavi' }, tone: 'info', place: ['e'] },
      at: { x: 30, y: 3 },
    });
  });

  it('says where a scripted reinforcement arrives, under its own label', () => {
    const rWorld: AlertWorld = {
      ...world,
      reinforcement: (id) => (id === 'deliver' ? { label: 'Second squad arrives', points: [{ x: 2, y: 2 }] } : null),
    };
    const { alerts } = alertsForTick(
      initAlertState(),
      [],
      [{ kind: 'trigger', tick: 0, id: 'deliver' } as MissionEvent, { kind: 'trigger', tick: 0, id: 'other' } as MissionEvent],
      rWorld,
      40
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].line).toMatchObject({ key: 'alert.reinforced', params: { label: 'Second squad arrives' }, place: ['here'] });
    // VR-37: the same tier and tone as the dock's arrival -- it was `warn`.
    expect(alerts[0]).toMatchObject({ tier: 'minor', tone: 'info', line: { tone: 'info' } });
  });
});

describe('nextJump: Space goes to the latest important or major alert', () => {
  const p = (x: number) => ({ x, y: 0 });
  it('a minor alert does not steal the key from an important one', () => {
    let j = nextJump(null, 'important', p(1));
    j = nextJump(j, 'minor', p(2));
    expect(j?.at).toEqual(p(1));
    j = nextJump(j, 'major', p(3));
    j = nextJump(j, 'important', p(4));
    expect(j?.at).toEqual(p(4));
  });
  it('a minor alert holds the key only while nothing heavier has happened', () => {
    let j = nextJump(null, 'minor', p(1));
    j = nextJump(j, 'minor', p(2));
    expect(j?.at).toEqual(p(2));
  });
  it('an alert with no place leaves the key where it was', () => {
    expect(nextJump({ at: p(1), tier: 'minor' }, 'major', null)?.at).toEqual(p(1));
  });
});

// --- polish pass F: the cue each alert sounds -----------------------------

const ev = <K extends MissionEvent['kind']>(e: Extract<MissionEvent, { kind: K }>): MissionEvent => e;
const pinned = (entity: number): SimEvent => ({ kind: 'pinned', tick: 0, entity }) as SimEvent;
const ambush = (entity: number): SimEvent => ({ kind: 'ambushSprung', tick: 0, entity }) as SimEvent;

describe('alertsForTick — the cue follows the tier (polish pass F, A2)', () => {
  it('a foot unit lost sounds important; a major loss (here the Lavi) sounds major', () => {
    const cueOf = (entity: number, unit: string) => alertsForTick(initAlertState(), [], [lost(entity, unit)], world, 40).alerts[0]?.cue;
    expect(cueOf(0, 'inf_squad')).toBe('alert.important');
    expect(cueOf(7, 'mbt_lavi')).toBe('alert.major');
  });

  it('the three tiers are three different cues', () => {
    const minor = alertsForTick(initAlertState(), [fire(1)], [], world, 40).alerts[0]?.cue;
    const important = alertsForTick(initAlertState(), [], [lost(0, 'inf_squad')], world, 40).alerts[0]?.cue;
    const major = alertsForTick(initAlertState(), [], [lost(7, 'mbt_lavi')], world, 40).alerts[0]?.cue;
    expect(new Set([minor, important, major]).size).toBe(3);
  });

  it('every alert with a cue sounds its own tier', () => {
    const tierCue = { minor: 'alert.minor', important: 'alert.important', major: 'alert.major' } as const;
    const { alerts } = alertsForTick(
      initAlertState(),
      [fire(1), pinned(2), ambush(12)],
      [lost(0, 'inf_squad'), lost(7, 'mbt_lavi'), ev<'wave'>({ kind: 'wave', tick: 0, count: 2 }), ev<'roe'>({ kind: 'roe', tick: 0, penalty: 5, reason: 'r', score: 90 })],
      world,
      400,
    );
    for (const a of alerts) if (a.kind !== 'objective' && a.cue !== null) expect(a.cue, a.kind).toBe(tierCue[a.tier]);
    expect(alerts.length).toBeGreaterThanOrEqual(6);
  });

  it('a pinned man of ours sounds minor, once in four seconds; an enemy pinned sounds nothing', () => {
    const a = alertsForTick(initAlertState(), [pinned(1), pinned(2)], [], world, 40);
    expect(a.alerts).toMatchObject([{ kind: 'pinned', line: null, tier: 'minor', cue: 'alert.minor', at: { x: 1.5, y: 10.5 } }]);
    expect(alertsForTick(a.state, [pinned(3)], [], world, 40 + PINNED_COOLDOWN_TICKS - 1).alerts).toEqual([]);
    expect(alertsForTick(a.state, [pinned(3)], [], world, 40 + PINNED_COOLDOWN_TICKS).alerts).toHaveLength(1);
    expect(alertsForTick(initAlertState(), [pinned(12)], [], world, 40).alerts).toEqual([]);
  });

  it('an enemy ambush sprung is important and points nowhere; one of ours springing is not news', () => {
    expect(alertsForTick(initAlertState(), [ambush(12)], [], world, 40).alerts[0]).toMatchObject({ kind: 'ambush', tier: 'important', at: null });
    expect(alertsForTick(initAlertState(), [ambush(2)], [], world, 40).alerts).toEqual([]);
  });

  it('a wave, a soldier taken and a Conduct penalty sound important; a civilian taken and an arrival are silent', () => {
    const cuesOf = (m: MissionEvent) => alertsForTick(initAlertState(), [], [m], world, 40).alerts.map((a) => a.cue);
    expect(cuesOf(ev<'wave'>({ kind: 'wave', tick: 0, count: 4 }))).toEqual(['alert.important']);
    expect(cuesOf(ev<'removed'>({ kind: 'removed', tick: 0, entity: 2, side: 0, unit: 'inf_squad' }))).toEqual(['alert.important']);
    expect(cuesOf(ev<'roe'>({ kind: 'roe', tick: 0, penalty: 5, reason: 'r', score: 95 }))).toEqual(['alert.important']);
    expect(cuesOf(ev<'removed'>({ kind: 'removed', tick: 0, entity: 2, side: 2, unit: 'civilian' })).filter((c) => c !== null)).toEqual([]);
    expect(cuesOf(ev<'built'>({ kind: 'built', tick: 0, unit: 'inf_squad' })).filter((c) => c !== null)).toEqual([]);
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
 * what each kind may sound, and THIS proves the model sounds it -- a kind
 * declared with cues raises one of them, a kind declared silent raises none.
 * `missionEnd` is the outcome, sounded by `main.ts`'s outcome moment, and is
 * held to the outcome map in `cues.test.ts` instead.
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
    unitLost: lost(7, 'mbt_lavi'),
    say: ev<'say'>({ kind: 'say', tick: 0, speaker: 'shai', text: 'x' }),
    missionEnd: ev<'missionEnd'>({ kind: 'missionEnd', tick: 0, result: 'victory', roeRating: 100, survivors: [], ledger: {} as never }),
  };
  it.each(MISSION_EVENT_KINDS.filter((k) => k !== 'missionEnd'))('%s', (kind) => {
    const cues = alertsForTick(initAlertState(), [], [sample[kind]], world, 40)
      .alerts.map((a) => a.cue)
      .filter((c) => c !== null);
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

// PA-19: an enemy kill was the one major combat fact the feed never said. It
// is good news, so it is quiet (no cue) and takes no jump key -- Space goes to
// trouble -- and it is tiered like every other line: a vehicle or aircraft is
// major (C3), a man on foot minor.
describe('alertsForTick — enemy kills (PA-19)', () => {
  it('an enemy on foot killed by ours is one minor, silent line, named and placed', () => {
    const { alerts } = alertsForTick(initAlertState(), [destroyed(12, 1)], [], world, 40);
    expect(alerts).toEqual([
      {
        kind: 'kill',
        tier: 'minor',
        tone: 'good',
        line: { key: 'alert.kill', params: { name: 'Rifle squad', n: 1 }, tone: 'good', place: ['e'] },
        cue: null,
        at: null,
        marks: [],
        count: 1,
      },
    ]);
  });

  it('an enemy vehicle is a major line, still silent and still no jump', () => {
    const { alerts } = alertsForTick(initAlertState(), [destroyed(17, 1)], [], world, 40);
    expect(alerts).toMatchObject([{ kind: 'kill', tier: 'major', cue: null, at: null, line: { params: { name: 'Lavi' } } }]);
    expect(nextJump(null, alerts[0].tier, alerts[0].at)).toBeNull();
  });

  it('coalesces one type in one tick into one line with a count', () => {
    const { alerts } = alertsForTick(initAlertState(), [destroyed(12, 1), destroyed(13, 2), destroyed(17, 2)], [], world, 40);
    expect(alerts.map((a) => [a.line?.params.name, a.count])).toEqual([
      ['Rifle squad', 2],
      ['Lavi', 1],
    ]);
  });

  it('says nothing of a kill the player did not make, of a civilian, or of one of ours', () => {
    const { alerts } = alertsForTick(
      initAlertState(),
      [destroyed(12, 11), destroyed(13, -1), destroyed(31, 1), destroyed(2, 14)],
      [],
      world,
      40,
    );
    expect(alerts.filter((a) => a.kind === 'kill')).toEqual([]);
  });
});

// Pass C2/C4 (A1): one of ours broken, and one of our vehicles hit in a
// component, are `important` -- the plan around that unit changed.
describe('alertsForTick — our units broken or damaged (pass C2/C4, A1)', () => {
  const routed = (entity: number): SimEvent => ({ kind: 'routed', tick: 0, entity }) as SimEvent;
  const component = (target: number, result: string): SimEvent =>
    ({ kind: 'component', tick: 0, target, result, overmatch: 0 }) as unknown as SimEvent;
  const catalogue = en as Record<string, string>;

  it('says one of ours broke, important, with the place and the cue', () => {
    const { alerts } = alertsForTick(initAlertState(), [routed(2), routed(3)], [], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'broken',
      tier: 'important',
      cue: 'alert.important',
      count: 2,
      line: { key: 'alert.broken', params: { name: 'Rifle squad', more: 1 }, tone: 'bad', place: ['here'] },
    });
    expect(catalogue).toHaveProperty('alert.broken');
  });

  it('names what a component hit took from one of our vehicles, and nothing else', () => {
    for (const [result, key] of [
      ['mobility_kill', 'alert.immobilised'],
      ['firepower_kill', 'alert.gunOut'],
      ['combat_ineffective', 'alert.outOfAction'],
    ] as const) {
      const { alerts } = alertsForTick(initAlertState(), [component(7, result)], [], world, 40);
      expect(alerts.map((a) => a.line?.key)).toEqual([key]);
      expect(alerts[0].tier).toBe('important');
      expect(catalogue).toHaveProperty(key);
    }
    // Crew shaken is suppression, which the card shows; catastrophic is a loss.
    expect(alertsForTick(initAlertState(), [component(7, 'crew_shaken')], [], world, 40).alerts).toEqual([]);
  });

  it('is silent about the enemy breaking, and about a unit already lost this tick', () => {
    expect(alertsForTick(initAlertState(), [routed(12), component(17, 'mobility_kill')], [], world, 40).alerts).toEqual([]);
    const { alerts } = alertsForTick(initAlertState(), [routed(2)], [lost(2, 'inf_squad')], world, 40);
    expect(alerts.map((a) => a.kind)).toEqual(['unitLost']);
  });
});

// VR-37 (approved by the lead, 2026-10-08): tier and tone agree, because the
// minimap ring now wears both.
describe('alertsForTick — VR-37 tier and tone', () => {
  it('a civilian taken is important and bad, silent, and rings where they were taken', () => {
    const e = ev<'removed'>({ kind: 'removed', tick: 0, entity: 31, side: 2, unit: 'civilian' });
    expect(missionEventTier(e)).toBe('important');
    expect(alertsForTick(initAlertState(), [], [e], world, 40).alerts).toEqual([
      { kind: 'removed', tier: 'important', tone: 'bad', line: null, cue: null, at: { x: 31.5, y: 10.5 }, marks: [{ x: 31.5, y: 10.5 }], count: 1 },
    ]);
  });

  it('a man of ours taken is important and bad', () => {
    const e = ev<'removed'>({ kind: 'removed', tick: 0, entity: 2, side: 0, unit: 'inf_squad' });
    expect(missionEventTier(e)).toBe('important');
    expect(alertsForTick(initAlertState(), [], [e], world, 40).alerts[0]).toMatchObject({ tier: 'important', tone: 'bad' });
  });

  it('broken stays important and bad, and still marks the map where they broke', () => {
    const routed = { kind: 'routed', tick: 0, entity: 3 } as SimEvent;
    expect(alertsForTick(initAlertState(), [routed], [], world, 40).alerts[0]).toMatchObject({
      kind: 'broken',
      tier: 'important',
      tone: 'bad',
      marks: [{ x: 3.5, y: 10.5 }],
    });
  });

  it('pinned is minor and warn, the under-fire family', () => {
    expect(alertsForTick(initAlertState(), [pinned(1)], [], world, 40).alerts[0]).toMatchObject({ kind: 'pinned', tier: 'minor', tone: 'warn' });
    expect(alertsForTick(initAlertState(), [fire(1)], [], world, 40).alerts[0]).toMatchObject({ kind: 'underFire', tier: 'minor', tone: 'warn' });
  });

  it('an ambush is important and bad, with a line, marked on the first of ours it hit -- never on the ambusher', () => {
    const { alerts } = alertsForTick(initAlertState(), [ambush(12), fire(15), fire(4), fire(2)], [], world, 40);
    const a = alerts.find((x) => x.kind === 'ambush');
    expect(a).toMatchObject({
      tier: 'important',
      tone: 'bad',
      cue: 'alert.important',
      line: { key: 'alert.ambush', tone: 'bad', place: ['here'] },
      at: { x: 4.5, y: 10.5 },
      marks: [{ x: 4.5, y: 10.5 }],
    });
  });

  it('an objective alert carries its status as its tone', () => {
    const toneOf = (status: 'active' | 'complete' | 'failed') =>
      alertsForTick(initAlertState(), [], [ev<'objective'>({ kind: 'objective', tick: 0, id: 'take_town', status })], world, 40).alerts[0]?.tone;
    expect(toneOf('active')).toBe('info');
    expect(toneOf('complete')).toBe('good');
    expect(toneOf('failed')).toBe('bad');
  });

  it('a loss is bad, a wave is bad, a kill is good', () => {
    expect(alertsForTick(initAlertState(), [], [lost(7, 'mbt_lavi')], world, 40).alerts[0]).toMatchObject({ tier: 'major', tone: 'bad' });
    expect(alertsForTick(initAlertState(), [], [ev<'wave'>({ kind: 'wave', tick: 0, count: 2 })], world, 40).alerts[0]).toMatchObject({ tier: 'important', tone: 'bad' });
    expect(alertsForTick(initAlertState(), [destroyed(17, 1)], [], world, 40).alerts[0]).toMatchObject({ tier: 'major', tone: 'good' });
  });
});

describe('alertsForTick — a tunnel found (GH-471)', () => {
  const found = (tunnel: number, observer: number, side = 0, level = 'identified'): SimEvent =>
    ({ kind: 'tunnelContact', tick: 0, side, tunnel, level, observer }) as SimEvent;

  it('is important and warn, sounds the important cue, and rings where the finder stands', () => {
    const { alerts } = alertsForTick(initAlertState(), [found(2, 3)], [], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'tunnel',
      tier: 'important',
      tone: 'warn',
      cue: 'alert.important',
      at: { x: 3.5, y: 10.5 },
      line: { key: 'alert.tunnelFound', params: { n: 1 }, tone: 'warn', place: ['here'] },
    });
    expect(alerts[0].marks).toEqual([{ x: 3.5, y: 10.5 }]);
  });

  it('speaks once per route per mission: losing and re-finding the same route is not news', () => {
    let state = initAlertState();
    const first = alertsForTick(state, [found(2, 3)], [], world, 40);
    state = first.state;
    expect(first.alerts).toHaveLength(1);
    const again = alertsForTick(state, [found(2, 4)], [], world, 400);
    expect(again.alerts).toEqual([]);
    const other = alertsForTick(again.state, [found(5, 4)], [], world, 500);
    expect(other.alerts).toHaveLength(1);
  });

  it('several routes found in one tick are one line with a count', () => {
    const { alerts } = alertsForTick(initAlertState(), [found(0, 3), found(1, 3), found(2, -1)], [], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ count: 3, line: { params: { n: 3 } } });
  });

  it('says nothing for the enemy finding ours, or for a route only suspected', () => {
    expect(alertsForTick(initAlertState(), [found(0, 12, 1)], [], world, 40).alerts).toEqual([]);
    expect(alertsForTick(initAlertState(), [found(0, 3, 0, 'suspected')], [], world, 40).alerts).toEqual([]);
  });

  it('a route found through its spoil alone has no finder to point at', () => {
    const { alerts } = alertsForTick(initAlertState(), [found(0, -1)], [], world, 40);
    expect(alerts[0]).toMatchObject({ at: null, marks: [] });
  });

  it('has its line in the catalogue', () => {
    expect((en as Record<string, string>)['alert.tunnelFound']).toMatch(/tunnel found/);
  });
});
