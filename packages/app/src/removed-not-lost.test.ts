// GH-1380, the lead's ruling of 20 Nov 2026: a side-0 unit removed from play by a mission script (a `remove` trigger)
// is NOT lost anywhere, so the score agrees with the debrief. These are the app's reads of a
// REAL finished runtime, through the same calls the victory handler in main.ts makes: the challenge row (`runRowOf`, and
// a no-loss challenge's mark through `victoryMark`), the credits (`creditsFor(creditInputFrom(...))`) and the ledger write
// (`applyRosterCarryover` merging the runtime's `missionEnd` ledger). The sim side, and the debrief's `unitLost` feed, are
// pinned in packages/sim/src/mission.test.ts ("a removal is not a loss (GH-1380)").
// Every world here has a destroyed-man control or a twin, so a count that reads zero for every input cannot pass.
// Abduction takes side-2 civilians only (`stepAbductions`), so it never reaches these side-0 counts and is not covered.
// Falsified: restoring the pre-ruling `isLost` clause in mission.ts turns every test here red.
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data/content';
import {
  CREDIT_WEIGHTS,
  MissionRuntime,
  Sim,
  TICKS_PER_SECOND,
  creditInputFrom,
  creditsFor,
  type LedgerData,
  type MissionEvent,
  type MissionJson,
  type UnitTypeJson,
} from '@lions/sim';
import { runRowOf, victoryMark } from './challenge';
import { applyRosterCarryover } from './roster-carryover';

const SQUAD: UnitTypeJson = {
  id: 'rn_squad',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
};

/** Three men, run to a win at 10 s: man 0 is `removed` when `remove` is set, man 1 is destroyed when `kill` is set, man 2
 *  holds. No enemy: nothing else can move a count. */
function finished(o: { remove: boolean; kill: boolean }): { rt: MissionRuntime; end: Extract<MissionEvent, { kind: 'missionEnd' }> } {
  const sim = new Sim({ seed: 1380, width: 16, height: 12, capacity: 8 });
  const squad = sim.addUnitType(SQUAD);
  const mission: MissionJson = {
    id: 'rn_mission',
    map: { file: 'none' },
    ledger: { requires: [], produces: ['campaign.mission_results'] },
    starting_force: [
      { unit: 'rn_squad', count: 1, at: [3, 3], group: 'taken' },
      { unit: 'rn_squad', count: 1, at: [3, 6] },
      { unit: 'rn_squad', count: 1, at: [3, 9] },
    ],
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 10 }],
    triggers: o.remove ? [{ id: 'take_one', on: { kind: 'timer_s', value: 0 }, do: { kind: 'remove', group: 'taken' } }] : [],
  };
  const rt = new MissionRuntime(sim, mission, { typeIdOf: (u) => (u === 'rn_squad' ? squad : -1), markers: {}, zones: {} });
  rt.start();
  if (o.kill) sim.debugKill(1);
  let end: MissionEvent | undefined;
  for (let t = 0; t < 12 * TICKS_PER_SECOND && end === undefined; t++) end = rt.step(sim.tick()).find((e) => e.kind === 'missionEnd');
  if (end?.kind !== 'missionEnd') throw new Error('no end');
  expect(end.result).toBe('victory');
  expect([sim.state.alive[0], sim.state.removed[0]]).toEqual(o.remove ? [0, 1] : [1, 0]);
  expect(sim.state.alive[1]).toBe(o.kill ? 0 : 1);
  return { rt, end };
}

const foothold = missions.beit_sahwan_2_foothold as unknown as MissionJson;
const opened: LedgerData = {
  'campaign.completed_missions': ['beit_sahwan_breach', 'beit_sahwan_1_recon'],
  'campaign.mission_results': {
    beit_sahwan_breach: { stars: 2, roe: 90, ticks: 6000, lost: 1 },
    beit_sahwan_1_recon: { stars: 2, roe: 90, ticks: 8000, lost: 0 },
  },
};

describe('a unit a script removed is not lost in the app`s score (GH-1380, the lead, 20 Nov 2026)', () => {
  it('the challenge row`s `lost` counts the destroyed man and not the removed one', () => {
    expect(runRowOf(finished({ remove: true, kill: true }).rt, 95, 200).lost).toBe(1);
    expect(runRowOf(finished({ remove: true, kill: false }).rt, 95, 200).lost).toBe(0);
    expect(runRowOf(finished({ remove: false, kill: true }).rt, 95, 200).lost).toBe(1);
  });

  it('a no-loss challenge is still beaten when the only man gone was removed; a death still misses it', () => {
    const at = { result: 'victory' as const, roeRating: 95, tick: 8000 };
    const mark = (o: { remove: boolean; kill: boolean }) => victoryMark(foothold, opened, ['light_order', 'no_medic'], finished(o).rt, at);
    expect(mark({ remove: false, kill: false })).toEqual({ id: 'quiet_souk', roe: 95, ticks: 8000, lost: 0 });
    expect(mark({ remove: true, kill: false })).toEqual({ id: 'quiet_souk', roe: 95, ticks: 8000, lost: 0 });
    expect(mark({ remove: false, kill: true })).toBeNull();
  });

  it('the credits pay the removed man home, as main.ts reads them; the destroyed one is not paid', () => {
    const pay = (o: { remove: boolean; kill: boolean }): number => {
      const { rt, end } = finished(o);
      return creditsFor(creditInputFrom(rt, end.roeRating, undefined));
    };
    const all = pay({ remove: false, kill: false });
    expect(pay({ remove: true, kill: false })).toBe(all);
    expect(pay({ remove: true, kill: true })).toBe(all - CREDIT_WEIGHTS.unitHome);
    expect(pay({ remove: false, kill: true })).toBe(all - CREDIT_WEIGHTS.unitHome);
  });

  it('the ledger write carries `campaign.mission_results.lost` 1, the destroyed man alone', () => {
    const lostOf = (o: { remove: boolean; kill: boolean }): number => {
      const { end } = finished(o);
      const deps = { kindOf: () => 'squad' as const, names: {} as never, displayName: (t: string) => t };
      const merged = applyRosterCarryover({}, end.ledger, [], deps).ledger;
      return (merged['campaign.mission_results'] as Record<string, { lost: number }>).rn_mission.lost;
    };
    expect(lostOf({ remove: true, kill: true })).toBe(1);
    expect(lostOf({ remove: true, kill: false })).toBe(0);
    expect(lostOf({ remove: false, kill: true })).toBe(1);
  });
});
