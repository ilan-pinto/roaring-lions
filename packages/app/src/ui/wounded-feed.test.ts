import { describe, expect, it } from 'vitest';
import type { MissionEvent, SimEvent } from '@lions/sim';
import { MAN_DOWN_COOLDOWN_TICKS, alertsForTick, initAlertState, type AlertWorld } from './alerts';
import { alertNotice } from './mission-notice';
import en from '../i18n/en.json';

// Entities 0-9 are ours, 10-29 the enemy's, 30+ civilians. 5 and 6 are two of our squads; the
// wounded bodies 40-45 are ours too (a `wounded`-role body wears its squad's side).
const SIDE = (e: number): number => (e < 10 || (e >= 40 && e < 50) ? 0 : e < 30 ? 1 : 2);
const world: AlertWorld = {
  posOf: (e) => (e < 0 ? null : { x: e + 0.5, y: 10.5 }),
  sideOf: SIDE,
  typeOf: (e) => (e === 41 || e === 12 ? 'wounded_rifleman' : 'inf_squad'),
  unitName: (id) => (id === 'inf_squad' ? 'Rifle squad' : id === 'wounded_rifleman' ? 'Wounded rifleman' : id),
  objectiveAt: () => null,
  placeOf: (x) => (x < 5 ? 'here' : 'e'),
  lossTier: () => 'important',
  waves: [],
  objectiveDone: () => false,
  markerAt: () => null,
  arrivedAt: () => null,
  reinforcement: () => null,
  viewer: 0,
  zoneAt: () => null,
  zoneHolder: () => -1,
  supplyCutAt: () => null,
  supplyCut: () => null,
};
const down = (entity: number, parent: number): SimEvent => ({ kind: 'woundedDown', tick: 0, entity, parent, by: 20 }) as SimEvent;
const gain = (g: number, reason: string, score: number): MissionEvent => ({ kind: 'roeGain', tick: 0, gain: g, reason, score }) as MissionEvent;

describe('alertsForTick: man down (GH-707 P2)', () => {
  it('a man of ours going down is one minor warn line naming his squad, placed, with no chime', () => {
    const { alerts } = alertsForTick(initAlertState(), [down(40, 5)], [], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'wounded',
      tier: 'minor',
      tone: 'warn',
      cue: null,
      count: 1,
      line: { key: 'alert.manDown', params: { name: 'Rifle squad', n: 1 }, tone: 'warn', place: ['e'] },
    });
    expect(alertNotice(alerts[0].line as never)[0]).toMatch(/^<b>man down<\/b> — Rifle squad/);
  });

  it('three men of one squad in one tick are ONE line with the count', () => {
    const { alerts } = alertsForTick(initAlertState(), [down(40, 5), down(42, 5), down(43, 5)], [], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].line?.params).toEqual({ name: 'Rifle squad', n: 3 });
    expect(alerts[0].count).toBe(3);
    expect(alertNotice(alerts[0].line as never)[0]).toBe('<b>man down</b> — Rifle squad (3) · east');
  });

  it('two squads are two lines', () => {
    const { alerts } = alertsForTick(initAlertState(), [down(40, 5), down(42, 6)], [], world, 40);
    expect(alerts.map((a) => a.line?.key)).toEqual(['alert.manDown', 'alert.manDown']);
  });

  it('the same squad stays quiet inside the cooldown and speaks again after it', () => {
    const first = alertsForTick(initAlertState(), [down(40, 5)], [], world, 40);
    const again = alertsForTick(first.state, [down(41, 5)], [], world, 40 + MAN_DOWN_COOLDOWN_TICKS - 1);
    expect(again.alerts).toEqual([]);
    const later = alertsForTick(again.state, [down(42, 5)], [], world, 40 + MAN_DOWN_COOLDOWN_TICKS);
    expect(later.alerts).toHaveLength(1);
  });

  it('a squad that died (parent -1) is named by the wounded body\'s own type', () => {
    const { alerts } = alertsForTick(initAlertState(), [down(41, -1)], [], world, 40);
    expect(alerts[0].line?.params.name).toBe('Wounded rifleman');
  });

  it('an enemy\'s or a civilian\'s wounded raise nothing (no x-ray)', () => {
    expect(alertsForTick(initAlertState(), [down(12, 13), down(31, -1)], [], world, 40).alerts).toEqual([]);
  });

  it('a tick with no wound event returns the very same state object', () => {
    const s = initAlertState();
    expect(alertsForTick(s, [], [], world, 40).state).toBe(s);
  });
});

describe('alertsForTick: Conduct gain (GH-707 P2)', () => {
  it('an enemy rescue is a good minor line with the quiet chime and nothing to point at', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [gain(2, 'enemy wounded rescued', 92)], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'conductGain',
      tier: 'minor',
      tone: 'good',
      cue: 'alert.minor',
      at: null,
      line: { key: 'alert.conductGain.enemy', params: { gain: 2, score: 92 } },
    });
    expect(alertNotice(alerts[0].line as never)[0]).toBe('<b>Enemy wounded rescued +2</b> · Conduct 92');
  });

  it('a civilian rescue reads +3, and an unknown reason keeps the sim\'s words (escaped)', () => {
    const civ = alertsForTick(initAlertState(), [], [gain(3, 'civilian wounded rescued', 95)], world, 40).alerts[0];
    expect(alertNotice(civ.line as never)[0]).toBe('<b>Civilian wounded rescued +3</b> · Conduct 95');
    const other = alertsForTick(initAlertState(), [], [gain(1, 'a <b>new</b> reason', 91)], world, 40).alerts[0];
    expect(other.line?.key).toBe('alert.conductGain.other');
    expect(alertNotice(other.line as never)[0]).toBe('<b>Conduct +1</b> — a &lt;b&gt;new&lt;/b&gt; reason · Conduct 91');
  });

  it('the catalogue carries every key the model can name', () => {
    for (const k of ['alert.manDown', 'alert.conductGain.enemy', 'alert.conductGain.civilian', 'alert.conductGain.other']) {
      expect(Object.keys(en), k).toContain(k);
    }
  });
});
