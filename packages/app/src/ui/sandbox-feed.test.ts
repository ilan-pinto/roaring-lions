import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@lions/sim';
import { initAlertState, type AlertWorld } from './alerts';
import { sandboxAlertsForTick, sandboxLosses } from './sandbox-feed';

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
