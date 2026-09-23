// tools/src/deploy_choice.test.ts
// Deploy as a decision, against the real spawner (shell-upgrade Phase 3,
// Task 4; spec Decision 4; plan R-3/R-5).
//
// The app never filters the roster pool -- it PERMUTES it, and the sim's own
// draw (`mission.ts:1256-1263`, findIndex by type + splice) takes the front of
// each type. This file proves both halves against a shipped mission rather
// than against a replica: the chosen veterans are the ones on the map, and a
// benched one comes back out of `rosterPool` (`mission.ts:1887`) into the
// ledger the mission produces, unchanged. A permutation that dropped an entry
// would delete a veteran from the player's brigade for good, which is why
// this is a tools test with a real runtime and not a jsdom test with a fake.
//
// What it drives is the app's own seam, not a lookalike of it:
// `deployRosterView` (what the screen may offer), `defaultSelection` and
// `toggleEntry` (what a click does), and `deployedLedger` -- the one function
// `main.ts` calls to build the ledger it hands `new MissionRuntime`. So the
// rule that decides which ledger the runtime sees is the rule under test
// here, and a change to it in `packages/app` reaches this file.
//
// The fixture is `beit_sahwan_2_foothold` because its starting force draws
// `inf_squad` x2 and `at_team` x1 from the ledger (read from the mission's own
// JSON below, never transcribed), so a pool of three squads makes the choice
// real. A passive run of it ENDS -- measured: victory at tick 7033 on the
// harness seed, `hold_west` held with no orders -- so `runToEnd` produces the
// ledger rather than hitting its ceiling. On that seed every body the ledger
// fielded dies before the end; that is the passive run's price, not this
// file's subject, and it is why the "unless its unit died" clause below is
// exercised on every fielded entry. The survivor half of the round trip --
// a fielded body that comes home under its own name -- is
// `roster-carry.test.ts`'s.
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import type { LedgerData, LedgerRosterEntry, MissionJson } from '@lions/sim';
import { deployRosterView, type DeployRosterView } from '../../packages/app/src/ui/deploy-roster';
import {
  defaultSelection,
  deployedLedger,
  isComplete,
  permutePool,
  slotsLeft,
  toggleEntry,
  type DeploySelection,
} from '../../packages/app/src/ui/deploy-select';
import { missionWorld, type MissionWorld } from './mission-harness';

const MISSION_ID = 'beit_sahwan_2_foothold';
/** The mission JSON the runtime runs -- the same object `missionWorld` hands it. */
const MISSION = missions[MISSION_ID] as unknown as MissionJson;

const POOL: readonly LedgerRosterEntry[] = [
  { type: 'inf_squad', veterancy: 2, name: '1-1 Erez', missions: 4, kills: 7 },
  { type: 'inf_squad', veterancy: 0, name: '1-2 Dekel', missions: 1, kills: 0 },
  { type: 'inf_squad', veterancy: 3, name: '1-3 Nachshon', missions: 9, kills: 21 },
  { type: 'at_team', veterancy: 1, name: '2-1 Gachelet', missions: 3, kills: 5 },
];

/** A fresh campaign ledger per call: the runtime copies the pool array at
 *  construction, but a test that shared one ledger object across worlds
 *  could still pass on a mutation the next world happened to repair. */
const campaign = (): LedgerData => ({ 'roster.surviving_units': [...POOL] });

const view = (): DeployRosterView => {
  const v = deployRosterView(MISSION, campaign(), (id) => id);
  if (v === null) throw new Error(`fixture: ${MISSION_ID} no longer reads roster.surviving_units`);
  return v;
};

/** The worked example: bench the default first squad (Erez), field the third (Nachshon). */
const benchErezFieldNachshon = (v: DeployRosterView): DeploySelection =>
  toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2);

interface Fielded {
  world: MissionWorld;
  /** Pool name -> the entity the spawner drew for it, read back through the
   *  runtime's own `rosterEntryOf` (`playerIds` is private). */
  byName: Map<string, number>;
}

function field(ledger: LedgerData): Fielded {
  const world = missionWorld(MISSION_ID, ledger);
  const byName = new Map<string, number>();
  for (let id = 0; id < world.sim.entityCount; id++) {
    const name = world.runtime.rosterEntryOf(id)?.name;
    if (name !== undefined) byName.set(name, id);
  }
  return { world, byName };
}

const namesOnMap = (ledger: LedgerData): string[] => [...field(ledger).byName.keys()].sort();

const nameOf = (e: LedgerRosterEntry): string => {
  if (e.name === undefined) throw new Error('fixture: every POOL entry is named');
  return e.name;
};

describe('the deploy choice, against the real spawner', () => {
  it('an untouched screen hands the runtime the ledger itself, and fields the default force', () => {
    const ledger = campaign();
    // No change on the screen is no change at all: the same object, so the
    // runtime is handed exactly what it was handed before deploy was a
    // decision -- which is what keeps every playtest plan byte-identical.
    expect(deployedLedger(ledger, null)).toBe(ledger);
    expect(namesOnMap(deployedLedger(ledger, null))).toEqual(['1-1 Erez', '1-2 Dekel', '2-1 Gachelet']);
    // And a screen that reported its own default back fields the same force:
    // the default selection permutes to the identity (Task 2's property),
    // here through the real spawner rather than through `drawFromPool`.
    const v = view();
    expect(permutePool(POOL, defaultSelection(v))).toEqual(POOL);
    expect(namesOnMap(deployedLedger(campaign(), defaultSelection(v)))).toEqual([
      '1-1 Erez',
      '1-2 Dekel',
      '2-1 Gachelet',
    ]);
  });

  it('fields the veteran the player picked, and not the one they benched', () => {
    const v = view();
    const sel = benchErezFieldNachshon(v);
    expect([...sel.chosen].sort()).toEqual([1, 2, 3]);
    expect(namesOnMap(deployedLedger(campaign(), sel))).toEqual(['1-2 Dekel', '1-3 Nachshon', '2-1 Gachelet']);
  });

  it('the benched veteran is still in the ledger the mission produces, unchanged', () => {
    const sel = benchErezFieldNachshon(view());
    const { world, byName } = field(deployedLedger(campaign(), sel));
    expect(byName.has('1-1 Erez'), 'the benched squad was fielded anyway').toBe(false);
    const roster = world.runToEnd()['roster.surviving_units'] ?? [];
    expect(roster.map((r) => r.name)).toContain('1-1 Erez');
    // Benched, so it served no mission and earned nothing: it comes back
    // field for field as it went in.
    expect(roster.find((r) => r.name === '1-1 Erez')).toEqual(POOL[0]);
  });

  // Pre-flight scan M3: the brief's version asserted `length >= POOL.length - 3`,
  // which is `>= 1` and stays green on the very data loss this file exists
  // for. This asserts the invariant itself, for EVERY selection the screen
  // would let the player deploy, not only the worked example above.
  it('for every deployable choice: fields exactly the chosen, returns every benched entry unchanged, loses nobody who did not die', () => {
    const v = view();
    const eligible = v.eligible.map((e) => e.poolIndex);
    const deployable: DeploySelection[] = [];
    for (let mask = 0; mask < 1 << eligible.length; mask++) {
      const sel: DeploySelection = { chosen: new Set(eligible.filter((_, k) => (mask & (1 << k)) !== 0)) };
      // What the screen would enable Deploy for (`isComplete`), and never more
      // of a type than the mission asks for (`toggleEntry` refuses that).
      if (!isComplete(v, sel)) continue;
      if ([...v.demand.keys()].some((type) => slotsLeft(v, sel, type) < 0)) continue;
      deployable.push(sel);
    }
    // Two of three squads times the one AT team. Guards the loop below
    // against passing vacuously over an empty list.
    expect(deployable).toHaveLength(3);

    for (const sel of deployable) {
      const chosenNames = [...sel.chosen].map((i) => nameOf(POOL[i])).sort();
      const label = `chosen ${chosenNames.join(', ')}`;
      const { world, byName } = field(deployedLedger(campaign(), sel));
      expect([...byName.keys()].sort(), `${label}: the field is not the choice`).toEqual(chosenNames);

      const produced = world.runToEnd()['roster.surviving_units'] ?? [];
      POOL.forEach((entry, i) => {
        const name = nameOf(entry);
        const home = produced.filter((r) => r.name === name);
        expect(home.length, `${label}: ${name} came home ${home.length} times`).toBeLessThanOrEqual(1);
        if (!sel.chosen.has(i)) {
          expect(home[0], `${label}: benched ${name} is not back unchanged`).toEqual(entry);
          return;
        }
        const id = byName.get(name);
        const died = id !== undefined && world.sim.state.alive[id] === 0;
        expect(home.length === 1 || died, `${label}: ${name} is missing from the ledger and did not die`).toBe(true);
      });
    }
  });

  it('never invents a roster: a campaign with none yet is not a gutted one', () => {
    // The spawner reads an ABSENT roster as a fresh start (full placements,
    // fresh bodies) and an EMPTY one as a gutted brigade (one remnant per
    // placement, `mission.ts:1254-1265`). Pinned both ways so the difference
    // this guards is shown to be real, not assumed.
    const squads = (ledger: LedgerData): number => {
      const { world } = field(ledger);
      const { sim } = world;
      let n = 0;
      for (let id = 0; id < sim.entityCount; id++) {
        if (sim.state.side[id] === 0 && sim.unitTypes[sim.state.typeIdx[id]].id === 'inf_squad') n++;
      }
      return n;
    };
    expect(squads({ 'roster.surviving_units': [] }), 'premise: an empty roster fields one remnant').toBe(1);

    const fresh: LedgerData = {};
    const out = deployedLedger(fresh, { chosen: new Set([0]) });
    expect(out).toBe(fresh);
    expect('roster.surviving_units' in out).toBe(false);
    expect(squads(out)).toBe(2);
  });
});
