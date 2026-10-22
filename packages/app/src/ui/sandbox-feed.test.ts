import { describe, expect, it } from 'vitest';
import type { MissionEvent, SimEvent } from '@lions/sim';
import { initAlertState, type AlertWorld } from './alerts';
import { roomAlertsForTick, roomArrivals, sandboxAlertsForTick, sandboxLosses } from './sandbox-feed';
import { announceInputsOf } from '../voice/announce';

// A sandbox world: no mission, so no waves, objectives, markers or triggers.
// Entities 0-9 are ours, 10-29 the enemy's, 30+ civilians.
const world: AlertWorld = {
  posOf: (e) => (e < 0 ? null : { x: e + 0.5, y: 10.5 }),
  sideOf: (e) => (e < 10 ? 0 : e < 30 ? 1 : 2),
  typeOf: (e) => (e === 7 || e === 17 ? 'mbt_lavi' : 'inf_squad'),
  unitName: (id) => (id === 'inf_squad' ? 'Rifle squad' : id === 'mbt_lavi' ? 'Lavi' : id),
  objectiveAt: () => null,
  placeOf: () => 'here',
  lossTier: (_e, id) => (id === 'mbt_lavi' ? 'major' : 'important'),
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
const destroyed = (entity: number, by: number): SimEvent => ({ kind: 'destroyed', tick: 0, entity, by }) as SimEvent;
const fire = (target: number): SimEvent =>
  ({ kind: 'fire', tick: 0, shooter: 12, target, weaponId: 'w', pHit: 0, roll: 0, willHit: false,
     breakdown: { accuracy: 0, rangeFalloff: 0, coverMod: 0, motionMod: 0, stanceMod: 0, suppressionMod: 0 } }) as SimEvent;

describe('sandboxLosses (PA-25)', () => {
  it('reports a loss of ours the way MissionRuntime does, killer or not', () => {
    const out = sandboxLosses([destroyed(7, 17), destroyed(2, -1)], world.sideOf, world.typeOf, 40, 0);
    expect(out).toEqual([
      { kind: 'unitLost', tick: 40, entity: 7, side: 0, unit: 'mbt_lavi' },
      { kind: 'unitLost', tick: 40, entity: 2, side: 0, unit: 'inf_squad' },
    ]);
  });

  it('reports nothing for an enemy or a civilian dying', () => {
    expect(sandboxLosses([destroyed(12, 3), destroyed(31, 3)], world.sideOf, world.typeOf, 40, 0)).toEqual([]);
  });
});

describe('sandboxAlertsForTick (PA-25)', () => {
  it('puts a short fight in the feed: under fire, a kill, and a loss', () => {
    const { alerts } = sandboxAlertsForTick(
      initAlertState(),
      [fire(3), destroyed(12, 3), destroyed(7, 17)],
      world,
      40
    );
    const keys = alerts.map((a) => a.line?.key);
    expect(keys).toContain('alert.underFire');
    expect(keys).toContain('alert.unitLost');
    expect(alerts.find((a) => a.line?.key === 'alert.unitLost')?.line?.params.name).toBe('Lavi');
    expect(keys.some((k) => k?.startsWith('alert.kill'))).toBe(true);
  });

  it('says nothing on a quiet tick', () => {
    expect(sandboxAlertsForTick(initAlertState(), [], world, 40).alerts).toEqual([]);
  });
});

// N1a task 6: a seat on side 1 loses side 1's units, and its synthesised
// `unitLost` carries the side it is about, as the runtime's does.
describe('the sandbox feed for a seat on side 1 (N1a task 6)', () => {
  it('reports side 1\'s losses, as side 1, and none of side 0\'s', () => {
    expect(sandboxLosses([destroyed(17, 7), destroyed(2, 12)], world.sideOf, world.typeOf, 40, 1)).toEqual([
      { kind: 'unitLost', tick: 40, entity: 17, side: 1, unit: 'mbt_lavi' },
    ]);
  });

  it('puts side 1\'s loss in its feed through the world\'s viewer', () => {
    const { alerts } = sandboxAlertsForTick(initAlertState(), [destroyed(17, 7), destroyed(2, 12)], { ...world, viewer: 1 }, 40);
    expect(alerts.filter((a) => a.kind === 'unitLost').map((a) => a.line?.params.name)).toEqual(['Lavi']);
  });
});

// N3 Task 6: an economy room's runtime reports both seats' purchases (`built`, with its side)
// and, both sides being human-held, both seats' losses. A seat hears its own arrivals only.
describe('a room\'s feed takes its runtime\'s purchases (N3 Task 6)', () => {
  const built = (side: 0 | 1, unit = 'atgm_cell'): MissionEvent => ({ kind: 'built', tick: 40, unit, side });
  const theirLoss: MissionEvent = { kind: 'unitLost', tick: 40, entity: 17, side: 1, unit: 'mbt_lavi' };
  const arrivals = (viewer: 0 | 1, events: MissionEvent[]) =>
    roomAlertsForTick(initAlertState(), [], events, { ...world, viewer }, 40).alerts.filter((a) => a.kind === 'arrival');

  it('an arrival for the seat whose side built it, and none for the other seat', () => {
    expect(arrivals(1, [built(1)])).toHaveLength(1);
    expect(arrivals(0, [built(1)])).toEqual([]);
    expect(arrivals(0, [built(0)])).toHaveLength(1);
    expect(arrivals(1, [built(0)])).toEqual([]);
  });

  it('never the runtime\'s unitLost: the other seat\'s loss is not this feed\'s', () => {
    expect(roomArrivals([theirLoss, built(1)])).toEqual([built(1)]);
    const { alerts } = roomAlertsForTick(initAlertState(), [], [theirLoss], world, 40);
    expect(alerts.filter((a) => a.kind === 'unitLost')).toEqual([]);
  });

  it('with no runtime events it is the sandbox feed, alert for alert', () => {
    const events = [fire(3), destroyed(12, 3), destroyed(7, 17)];
    expect(roomAlertsForTick(initAlertState(), events, [], world, 40)).toEqual(sandboxAlertsForTick(initAlertState(), events, world, 40));
  });

  it('the announcer says "reinforcements" for the viewer\'s own purchase only', () => {
    const said = (viewer: 0 | 1) => announceInputsOf(roomArrivals([built(1), theirLoss]), (id) => id, viewer).map((i) => i.event);
    expect(said(1)).toEqual(['reinforcements']);
    expect(said(0)).toEqual([]);
  });
});
