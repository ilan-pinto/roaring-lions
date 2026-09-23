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
import { missions, names as namesJson, units } from '@lions/data';
import type { LedgerData, LedgerRosterEntry, MissionJson, Sim } from '@lions/sim';
import type { CampaignLedger, LostRecord, RosterEntry } from '../../packages/app/src/ledger-store';
import { nameKind, type NamesJson } from '../../packages/app/src/names';
import { applyRosterCarryover, type RosterCarryoverDeps } from '../../packages/app/src/roster-carryover';
import { lostRecordFor } from '../../packages/app/src/roster-lost';
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
import { startMission } from '../../packages/app/src/mission-start';
import { HARNESS_MAX_TICKS, missionStage, missionWorld, type MissionWorld } from './mission-harness';

const MISSION_ID = 'beit_sahwan_2_foothold';
/** The mission JSON the runtime runs -- the same object `missionWorld` hands it. */
const MISSION = missions[MISSION_ID] as unknown as MissionJson;

/** Slotted, the way every entry of a campaign that has won a mission since
 *  WP-G-E4 is (`roster-slots.ts`): a slot is the identity the memorial and
 *  the cap's eviction order key on, and the one field a benched entry has
 *  that a name-and-type rebuild would not give back (final review, ruling
 *  11). Every assertion below that says "unchanged" therefore says "in its
 *  own slot" too. */
const POOL: readonly RosterEntry[] = [
  { type: 'inf_squad', veterancy: 2, name: '1-1 Erez', missions: 4, kills: 7, slot: 0 },
  { type: 'inf_squad', veterancy: 0, name: '1-2 Dekel', missions: 1, kills: 0, slot: 1 },
  { type: 'inf_squad', veterancy: 3, name: '1-3 Nachshon', missions: 9, kills: 21, slot: 2 },
  { type: 'at_team', veterancy: 1, name: '2-1 Gachelet', missions: 3, kills: 5, slot: 3 },
];

/** A fresh campaign ledger per call: the runtime copies the pool array at
 *  construction, but a test that shared one ledger object across worlds
 *  could still pass on a mutation the next world happened to repair. The
 *  slot counter sits past every slot in `POOL`, as a real save's does, so a
 *  body the victory write slots fresh cannot collide with one by accident. */
const campaign = (): CampaignLedger => ({ 'roster.surviving_units': [...POOL], 'campaign.slots_issued': POOL.length });

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

/** `main.ts`'s own `applyRosterCarryover` deps, over the real unit catalogue
 *  and callsign tables -- the same construction `roster-carryover.test.ts`
 *  uses. */
const carryoverDeps: RosterCarryoverDeps = {
  kindOf: (typeId) => {
    const u = units[typeId as keyof typeof units] as { id: string; role: string } | undefined;
    return nameKind(u ?? { id: typeId, role: 'infantry' }, namesJson as NamesJson);
  },
  names: namesJson as NamesJson,
  displayName: (typeId) => (units[typeId as keyof typeof units] as { name?: string } | undefined)?.name ?? typeId,
};

const nameOf = (e: LedgerRosterEntry): string => {
  if (e.name === undefined) throw new Error('fixture: every POOL entry is named');
  return e.name;
};

/** For every test here that runs a headless mission to its end (`runToEnd`).
 *  That is legitimately long -- thousands of real sim ticks -- and it measured
 *  7.7 s under a loaded `pnpm test` against vitest's 5 s default, which is a
 *  timeout on a machine that is busy, not a hang. A hang is `runToEnd`'s own
 *  job to report: it throws past its twenty-minute tick ceiling. */
const RUNS_TO_END = { timeout: 30_000 };

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

  it('the benched veteran is still in the ledger the mission produces, unchanged', RUNS_TO_END, () => {
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
  it('for every deployable choice: fields exactly the chosen, returns every benched entry unchanged, loses nobody who did not die', RUNS_TO_END, () => {
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

  // Final review, ruling 11. The two tests above pin a benched entry as the
  // RUNTIME hands it back; what the campaign keeps is that roster after the
  // victory write. This is that write, end to end: `applyRosterCarryover`,
  // the function `main.ts` calls on `missionEnd`, handed what `main.ts` hands
  // it -- the ledger the mission was sent IN with as `before` (never the
  // permuted copy the runtime read), the produced ledger, and this mission's
  // memorial records collected off `unitLost` exactly as `main.ts` collects
  // them (`lostRecordFor` over `rosterEntryOf`). Every body fielded on this
  // seed dies, so the memorial list is real and the write has vacated slots
  // to hand out; the benched veteran's must not be one of them.
  //
  // Two halves, because they catch different breaks. Stripping `slot` in
  // `deployedLedger` goes red on the FIRST half (the runtime hands the entry
  // back slotless) and not the second: `reattachSlots` gives a NAMED entry its
  // slot back by name from `before`, so the write would quietly repair it --
  // seen both ways. The second half is the write's own: making `issueSlots`
  // re-slot an already-slotted entry goes red there and not in the first.
  it('after a win, the victory write keeps a benched slotted veteran in its own slot', RUNS_TO_END, () => {
    const before = campaign();
    const { world } = field(deployedLedger(before, benchErezFieldNachshon(view())));
    const lost: LostRecord[] = [];
    const produced = world.runToEnd(HARNESS_MAX_TICKS, (me) => {
      if (me.kind !== 'unitLost') return;
      const record = lostRecordFor(world.runtime.rosterEntryOf(me.entity), me.unit, MISSION_ID, me.tick);
      if (record) lost.push(record);
    });
    expect(world.runtime.result, 'premise: the passive run of this mission is a win').toBe('victory');

    const erez = POOL[0];
    // The runtime hands the benched entry back whole, slot included ...
    expect(produced['roster.surviving_units']?.find((r) => r.name === nameOf(erez))).toEqual(erez);
    expect(lost.length, 'premise: the fielded veterans died, so there are vacated slots').toBeGreaterThan(0);

    const { ledger: next } = applyRosterCarryover(before, produced, lost, carryoverDeps);
    const kept: RosterEntry[] = [...(next['roster.surviving_units'] ?? []), ...(next['roster.reserve'] ?? [])];
    // ... and the victory write keeps it: once, field for field, in slot 0 ...
    expect(kept.filter((r) => r.name === nameOf(erez))).toEqual([erez]);
    // ... and hands that slot to nobody else.
    expect(kept.filter((r) => r.slot === erez.slot).map((r) => r.name)).toEqual([nameOf(erez)]);
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

// --------------------------------------------------- the renderer re-seed
//
// Task 4 review, fix round 1. Moving the runtime past the deploy screen put
// the spawn AFTER `renderer.init()`, and both backends' `init()` end by
// snapshotting `sim.state` twice to seed their interpolation and their fog --
// from what is now an empty sim. `startMission` (`mission-start.ts`) is the
// function `main.ts` builds the runtime through, and it re-seeds the renderer
// after the spawn. This drives it through the same deploy path as everything
// above, with a stand-in renderer, and goes red if the re-seed is skipped or
// cut short.

/** Living side-0 units: what both backends' fog reveals from. */
const livingSide0 = (sim: Sim): number => {
  let n = 0;
  for (let id = 0; id < sim.entityCount; id++) if (sim.state.alive[id] === 1 && sim.state.side[id] === 0) n++;
  return n;
};

/**
 * A stand-in for exactly the renderer state the re-seed is coupled to, modelled
 * on both backends' `snapshot()` (`ThreeRenderer.snapshot()` and
 * `PixiRenderer.snapshot()`, cited by name because WP-A1.3 moves every line in
 * `ThreeRenderer.ts`) and nothing else: `prev`/`cur` position copies taken
 * from `sim.state` on every call, a "moved" flag standing in for the speed
 * those copies imply, and the fog gate that refreshes on every call where
 * `fogTick++ % 4 === 0`, recording how many living side-0 units the refresh
 * saw. Its numbers are literals of its own, never imported from the module
 * under test, so a change to `RESEED_SNAPSHOTS` cannot move both sides at once.
 */
class SeedRecorder {
  calls = 0;
  private fogTick = 0;
  /** Living side-0 units the fog saw at each refresh, in order. */
  readonly fogRefreshes: number[] = [];
  readonly prevX: Int32Array;
  readonly prevY: Int32Array;
  readonly curX: Int32Array;
  readonly curY: Int32Array;
  constructor(private readonly sim: Sim) {
    const n = sim.state.posX.length;
    this.prevX = new Int32Array(n);
    this.prevY = new Int32Array(n);
    this.curX = new Int32Array(n);
    this.curY = new Int32Array(n);
  }
  /** What both backends' `init()` end with: the two `snapshot()` calls in
   *  `ThreeRenderer.init()` (under "Seeds prevX/prevY == curX/curY from the
   *  sim's actual starting positions") and `PixiRenderer.init()` ("prev ==
   *  cur on the first frame"). */
  init(): void {
    this.snapshot();
    this.snapshot();
  }
  snapshot(): void {
    this.calls++;
    if (this.fogTick++ % 4 === 0) this.fogRefreshes.push(livingSide0(this.sim));
    this.prevX.set(this.curX);
    this.prevY.set(this.curY);
    for (let i = 0; i < this.sim.entityCount; i++) {
      this.curX[i] = this.sim.state.posX[i];
      this.curY[i] = this.sim.state.posY[i];
    }
  }
  moved(id: number): boolean {
    return this.curX[id] !== this.prevX[id] || this.curY[id] !== this.prevY[id];
  }
}

describe('the renderer is re-seeded from the force that just spawned', () => {
  it('after the deploy path: every unit at its spawn, still, and the latest fog refresh saw the whole force', () => {
    const stage = missionStage(MISSION_ID);
    const r = new SeedRecorder(stage.sim);
    // `main.ts`'s order since Task 4: `renderer.init()` first, on a sim with
    // nothing in it yet...
    r.init();
    expect(r.fogRefreshes, 'premise: init() seeds the fog from an empty sim').toEqual([0]);
    // ...then the deploy choice, the spawn and the re-seed, in one call.
    const sel = benchErezFieldNachshon(view());
    startMission(stage.sim, stage.mission, stage.context(deployedLedger(campaign(), sel)), r);

    const { sim } = stage;
    const force: number[] = [];
    for (let id = 0; id < sim.entityCount; id++) if (sim.state.alive[id] === 1 && sim.state.side[id] === 0) force.push(id);
    expect(force.length, 'the mission fielded no force at all').toBeGreaterThan(0);

    // Two from init(), three from the re-seed: the least that lands a fog
    // refresh after the spawn (see the fog check below).
    expect(r.calls).toBe(5);
    for (const id of force) {
      // Seeded from the spawn, not the zero-fill: drawn at world (0, 0)
      // otherwise until tick 1.
      expect([r.curX[id], r.curY[id]], `unit ${id} is not where it spawned`).toEqual([
        sim.state.posX[id],
        sim.state.posY[id],
      ]);
      expect(r.curX[id] !== 0 || r.curY[id] !== 0, `unit ${id} is drawn at world (0, 0)`).toBe(true);
      // prev == cur: the first frame lerps nothing in and reads no speed, so
      // no vehicle throws a dust burst off a spike from (0, 0).
      expect(r.moved(id), `unit ${id} still carries the jump from (0, 0)`).toBe(false);
    }
    // The fog's LATEST refresh was taken with the force on the map, so the
    // first frame is not full shroud.
    expect(r.fogRefreshes.at(-1), 'the fog was last refreshed before the force existed').toBe(force.length);
  });
});
