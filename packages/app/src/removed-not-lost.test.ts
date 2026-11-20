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
import { names as namesJson } from '@lions/data';
import { missions } from '@lions/data/content';
import { sanitiseLedger } from '@lions/economy';
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
import type { CampaignLedger, LostRecord } from './ledger-store';
import type { NamesJson } from './names';
import { applyRosterCarryover, type RosterCarryoverDeps } from './roster-carryover';

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
    ledger: { requires: [], produces: ['campaign.mission_results', 'roster.surviving_units'] },
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
      const deps = { kindOf: () => 'squad' as const, names: namesJson as NamesJson, displayName: (t: string) => t };
      const merged = applyRosterCarryover({}, end.ledger, [], deps).ledger;
      return (merged['campaign.mission_results'] as Record<string, { lost: number }>).rn_mission.lost;
    };
    expect(lostOf({ remove: true, kill: true })).toBe(1);
    expect(lostOf({ remove: true, kill: false })).toBe(0);
    expect(lostOf({ remove: false, kill: true })).toBe(1);
  });
});

// The lead's roster ruling of 20 Nov 2026: a side-0 man a script removed comes BACK onto the brigade roster, alive; an
// abducted one is MISSING (`roster.missing`): no memorial, off the roster. Here through `applyRosterCarryover`, the
// victory write main.ts makes, with the real callsign tables.
// Falsified: dropping the kept-removal line in `checkEnd`, and reading a missing man's slot as a vacancy.
describe('the roster keeps a removed man and lists an abducted one as missing (GH-1380, the lead, 20 Nov 2026)', () => {
  const deps = (cap?: number): RosterCarryoverDeps => ({
    kindOf: () => 'squad',
    names: namesJson as NamesJson,
    displayName: (t) => t,
    ...(cap !== undefined ? { cap } : {}),
  });
  const write = (o: { remove: boolean; kill: boolean }, cap?: number): CampaignLedger =>
    applyRosterCarryover({}, finished(o).end.ledger, [], deps(cap)).ledger;
  const count = (l: CampaignLedger): [number, number] => [l['roster.surviving_units']?.length ?? -1, l['roster.reserve']?.length ?? -1];

  it('the removed man is on the written roster; the destroyed one is not, and no memorial is written for the removal', () => {
    expect(count(write({ remove: true, kill: true }))).toEqual([2, 0]);
    expect(count(write({ remove: false, kill: true }))).toEqual([2, 0]); // the control: the same two, the destroyed man gone
    expect(count(write({ remove: true, kill: false }))).toEqual([3, 0]);
    expect(write({ remove: true, kill: false })['roster.lost']).toEqual([]);
  });

  it('ROSTER_CAP is unchanged: the cap applies AFTER the kept man is added, and nothing is deleted', () => {
    // Three home (the removed man among them) against a cap of 2: two active, one stood down, three in all.
    expect(count(write({ remove: true, kill: false }, 2))).toEqual([2, 1]);
    // The control without the removal: the same three, the same split.
    expect(count(write({ remove: false, kill: false }, 2))).toEqual([2, 1]);
    // And with the destroyed man gone: two under a cap of 2, nobody stood down.
    expect(count(write({ remove: true, kill: true }, 2))).toEqual([2, 0]);
  });

  // `checkEnd` writes `roster.missing` (pinned in packages/sim/src/mission.test.ts); no shipped path produces one, so the
  // carryover half is driven directly. Ari (slot 0) was abducted, Ben (slot 1) came home, Cal (slot 2) was killed, and a
  // fresh body came home. The control is Cal: his memorial is written and his slot is a vacancy the fresh body takes. Ari
  // gets neither: no memorial, and his slot is not handed on.
  it('a missing man keeps his record and his slot, gets no memorial, and is not on the roster; the killed one is a memorial', () => {
    const ari = { type: 'inf_squad', veterancy: 2, missions: 3, kills: 4, name: 'Ari', slot: 0 };
    const before: CampaignLedger = {
      'roster.surviving_units': [ari, { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0, name: 'Ben', slot: 1 }, { type: 'inf_squad', veterancy: 1, missions: 2, kills: 1, name: 'Cal', slot: 2 }],
      'campaign.slots_issued': 3,
    };
    const produced: CampaignLedger = {
      'roster.surviving_units': [{ type: 'inf_squad', veterancy: 0, missions: 2, kills: 0, name: 'Ben' }, { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0 }],
      'roster.missing': [{ ...ari, missionId: 'm2' }],
    };
    const cal: LostRecord = { slot: 2, name: 'Cal', type: 'inf_squad', veterancy: 1, missions: 2, kills: 1, missionId: 'm2', tick: 40 };
    const out = applyRosterCarryover(before, produced, [cal], deps()).ledger;
    expect(out['roster.missing']).toEqual([{ ...ari, missionId: 'm2' }]);
    expect(out['roster.lost']).toEqual([cal]);
    expect(out['roster.surviving_units']?.map((r) => [r.name, r.slot])).toEqual([['Ben', 1], [expect.any(String), 2]]);
    expect([...(out['roster.surviving_units'] ?? []), ...(out['roster.reserve'] ?? [])].some((r) => r.name === 'Ari' || r.slot === 0)).toBe(false);
  });

  it('roster.missing is shape-checked like the other roster keys, and a save without it loads unchanged', () => {
    const old: LedgerData = { 'roster.surviving_units': [{ type: 'inf_squad', veterancy: 0 }] };
    expect(sanitiseLedger(old)).toBe(old);
    const good: CampaignLedger = { 'roster.missing': [{ type: 'inf_squad', veterancy: 1, missionId: 'm2', name: 'Ari', slot: 0 }] };
    expect(sanitiseLedger(good)).toBe(good);
    const bad = { 'roster.missing': [{ type: 'inf_squad', veterancy: 1 }, null, { type: 'inf_squad', veterancy: 1, missionId: 'm2' }] } as unknown as LedgerData;
    expect(sanitiseLedger(bad)['roster.missing']).toEqual([{ type: 'inf_squad', veterancy: 1, missionId: 'm2' }]);
    expect('roster.missing' in sanitiseLedger({ 'roster.missing': {} } as unknown as LedgerData)).toBe(false);
  });
});
