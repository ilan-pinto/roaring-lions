import { describe, expect, it } from 'vitest';
import type { LedgerRosterEntry } from '@lions/sim';
import { deployRosterView, drawFromPool } from './deploy-roster';
import { ROSTER_CAP } from '../roster-cap';

const pool = (): LedgerRosterEntry[] => [
  { type: 'inf_squad', veterancy: 2, name: '1-1 Erez', missions: 4, kills: 7 },
  { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0 },
  { type: 'inf_squad', veterancy: 3, name: '1-3 Nachshon', missions: 9, kills: 21 },
  { type: 'at_team', veterancy: 1, name: '2-1 Gachelet', missions: 3, kills: 5 },
  { type: 'recon_drone', veterancy: 0, missions: 2, kills: 0 },
];

// beit_sahwan_2_foothold's own shape, read from the file: two ledger-drawn
// inf_squad, one ledger-drawn at_team, and four placements that draw nothing.
const force = [
  { unit: 'apc_eitan', count: 1 },
  { unit: 'inf_squad', count: 2, from_ledger: true },
  { unit: 'at_team', count: 1, from_ledger: true },
  { unit: 'mortar_team', count: 1 },
];
const mission = { ledger: { requires: ['roster.surviving_units'] }, starting_force: force };
const name = (id: string): string => id.replace(/_/g, ' ');

describe('drawFromPool', () => {
  // The oracle is mission.ts:1256-1263: findIndex by type, splice, up to
  // `count`, placements in array order. Indices, not entries, because the
  // selection is expressed as a permutation of the pool and an index is the
  // only handle that survives one.
  it('reproduces the spawner draw order, as indices into the pool', () => {
    expect(drawFromPool(pool(), force)).toEqual([0, 1, 3]);
  });

  it('a placement that is not from_ledger draws nothing', () => {
    expect(drawFromPool(pool(), [{ unit: 'inf_squad', count: 2 }])).toEqual([]);
  });

  it('a second placement of the same type continues where the first stopped', () => {
    const two = [
      { unit: 'inf_squad', count: 1, from_ledger: true },
      { unit: 'inf_squad', count: 1, from_ledger: true },
    ];
    expect(drawFromPool(pool(), two)).toEqual([0, 1]);
  });

  it('stops short rather than inventing an index when the pool runs dry', () => {
    const thin: LedgerRosterEntry[] = [{ type: 'inf_squad', veterancy: 0 }];
    expect(drawFromPool(thin, force)).toEqual([0]);
  });
});

describe('deployRosterView', () => {
  it('is null when the mission reads nothing from the ledger', () => {
    expect(deployRosterView({ ledger: { requires: [] } }, {}, name)).toBeNull();
  });

  it('eligible is one row per BODY, in pool order, for every drawable type', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect(v?.eligible.map((e) => e.poolIndex)).toEqual([0, 1, 2, 3]);
    expect(v?.eligible.map((e) => e.type)).toEqual(['inf_squad', 'inf_squad', 'inf_squad', 'at_team']);
  });

  it('demand is the mission’s own counts — deploy chooses who, never how many', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect([...(v?.demand ?? [])]).toEqual([
      ['inf_squad', 2],
      ['at_team', 1],
    ]);
  });

  // The drone is in the pool and no placement can draw it. It is shown as
  // reserve and is never selectable: there is no slot for it. Named
  // `undrawable`, not `benchable` (pre-flight P2): "benchable" implies a
  // player action, and nobody benches this -- it was never eligible.
  it('undrawable is what no placement can draw', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect(v?.undrawable.map((e) => e.type)).toEqual(['recon_drone']);
  });

  it('carries the name, stripes and record a player picks by, humanised', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect(v?.eligible[2]).toEqual({
      poolIndex: 2,
      type: 'inf_squad',
      typeName: 'inf squad',
      veterancy: 3,
      name: '1-3 Nachshon',
      missions: 9,
      kills: 21,
    });
  });

  // WP-G-E2 (GH-174) landed on this branch first and filled `ROSTER_CAP`
  // (packages/app/src/roster-cap.ts) before this task started -- the cap is
  // a real number today, not a placeholder this task leaves null. Pins that
  // the adapter hands it straight through.
  it('reports the roster cap', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect(v?.cap).toBe(ROSTER_CAP);
  });

  it('a missing roster key is an empty view, not a throw', () => {
    const v = deployRosterView(mission, {}, name);
    expect(v?.eligible).toEqual([]);
    expect(v?.undrawable).toEqual([]);
  });
});
