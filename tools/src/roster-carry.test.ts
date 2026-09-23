// tools/src/roster-carry.test.ts
//
// The sim half of the slot's round trip, measured rather than argued. Two facts
// `packages/app/src/roster-slots.ts` rests on and neither is visible from
// `packages/app`:
//
//   1. `slot` reaches a live mission -- `entityRoster.set(id, origin)`
//      (mission.ts:1304) stores the APP'S OWN object and `rosterEntryOf` hands it
//      back, so the HUD card (Task 8) can read a field @lions/sim has never heard
//      of. If that ever stops being true the card silently shows nothing.
//   2. `checkEnd` DROPS it for a fielded survivor and KEEPS it for an unfielded
//      pool entry. That asymmetry is the entire reason `reattachSlots` exists;
//      if a future sim change spreads `origin` instead, this test goes red and
//      the app-side rule can be deleted rather than left running for nothing.
//
// Lives under tools/ and not packages/sim/ because this plan does not open that
// package, tests included. `first_light_fence.test.ts`'s `passiveResult()` is the
// sim-construction idiom followed here, including its 424242 seed.
//
// **Why the run ends in DEFEAT, and why that is irrelevant.** `checkEnd`
// (mission.ts:1842-1888) builds the produced roster from ONE block on both
// verdicts -- `this.resultValue` is decided above it and read nowhere inside
// it -- so the rebuild this file pins is verdict-blind. A passive
// `khan_rafid_1_recon` is simply the cheapest deterministic way to make that
// block run with survivors still standing: its `get_two_in` primary is an
// `evacuate_before` with a 240 s deadline, the one objective type that can
// reach 'failed' (mission.ts:1851), so an all-idle run ends at tick 4799 with
// the whole force alive instead of running the 20-minute ceiling out. It is
// the mission's END, not its outcome, that this file is about; the app's own
// seam runs the victory branch and reaches the same rebuilt entries.
//
// The mission draws `inf_squad` and `at_team` from the ledger and nothing
// else, which is what makes one slotted entry fielded and the other a
// pass-through in the same run.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, units } from '@lions/data';
import {
  MissionRuntime,
  Sim,
  type LedgerData,
  type MissionJson,
  type TunnelRouteJson,
} from '@lions/sim';
import type { RosterEntry } from '../../packages/app/src/ledger-store';

const MISSION_ID = 'khan_rafid_1_recon';
/** The `evacuate_before` deadline is 240 s; 20 minutes of ticks is the same
 *  ceiling `playtest.ts` gives every mission, and is here only so a runtime
 *  that never ends fails loudly instead of hanging. */
const MAX_TICKS = 20 * 60 * 20;

/** The two entries this file argues from. `Barkai` is an `inf_squad`, which
 *  this mission's `from_ledger` placement draws; `Nachshon` is an `mbt_lavi`,
 *  which no placement here draws at all, so it is still in `rosterPool` when
 *  `checkEnd` runs. */
const FIELDED: RosterEntry = { type: 'inf_squad', veterancy: 1, missions: 2, kills: 3, name: 'Barkai', slot: 42 };
const POOLED: RosterEntry = { type: 'mbt_lavi', veterancy: 0, missions: 1, kills: 0, name: 'Nachshon', slot: 43 };

interface RoundTrip {
  /** What `rosterEntryOf` answered for the fielded body while it was alive. */
  live: Readonly<RosterEntry> | undefined;
  /** The roster `checkEnd` produced, off the `missionEnd` event. */
  produced: RosterEntry[];
  result: string;
  aliveAtEnd: boolean;
}

let trip: RoundTrip;

function runMission(): RoundTrip {
  const mission = (missions as Record<string, unknown>)[MISSION_ID] as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (const r of tunnelRoutes) sim.addTunnel(r);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));

  // The app's own widened entries, handed to a runtime typed to `@lions/sim`'s
  // narrower one. That this compiles proves nothing -- a subtype is always
  // assignable to its supertype. The evidence for fact 1 is OBJECT IDENTITY:
  // `rosterEntryOf` hands back the very object put in here, so a field the sim
  // has never heard of is still on it (`trip.live?.slot` below reads 42).
  const roster: RosterEntry[] = [{ ...FIELDED }, { ...POOLED }];
  const ledger: LedgerData = { 'roster.surviving_units': roster };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u: string) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    tunnels: tunnelRoutes,
    ledger,
    unitInfo: () => null,
  });
  rt.start();

  // `playerIds` is private, so the fielded body is found the way a screen would
  // find it: by asking the runtime which ledger entry each entity came from.
  let fielded = -1;
  for (let id = 0; id < sim.entityCount; id++) {
    if (rt.rosterEntryOf(id)?.name === FIELDED.name) fielded = id;
  }
  const live = fielded < 0 ? undefined : (rt.rosterEntryOf(fielded) as Readonly<RosterEntry> | undefined);

  let produced: RosterEntry[] = [];
  let t = 0;
  for (; t < MAX_TICKS; t++) {
    for (const me of rt.step(sim.tick())) {
      if (me.kind === 'missionEnd') produced = me.ledger['roster.surviving_units'] ?? [];
    }
    if (rt.result !== 'ongoing') break;
  }
  if (t >= MAX_TICKS) throw new Error(`${MISSION_ID} never ended inside ${MAX_TICKS} ticks`);
  return { live, produced, result: rt.result, aliveAtEnd: fielded >= 0 && sim.state.alive[fielded] === 1 };
}

beforeAll(() => {
  trip = runMission();
});

describe('a slot survives the sim it was never declared to', () => {
  it('is readable through rosterEntryOf on a fielded unit, and dropped by checkEnd', () => {
    // The run has to have fielded the entry and brought it home, or both
    // assertions below would pass for the wrong reason.
    expect(trip.live, 'no entity was drawn from the slotted ledger entry').toBeDefined();
    expect(trip.aliveAtEnd, 'the fielded body died, so there is no survivor to rebuild').toBe(true);

    // Fact 1: the runtime hands the app back its OWN object, slot and all.
    expect(trip.live?.slot).toBe(42);

    // Fact 2, the half `reattachSlots` exists for: the survivor is rebuilt
    // field by field, so the name comes home and the slot does not.
    const survivor = trip.produced.find((r) => r.name === FIELDED.name);
    expect(survivor, 'the fielded survivor is missing from the produced roster').toBeDefined();
    expect(survivor?.missions, 'this entry was not rebuilt by checkEnd at all').toBe(3);
    expect(survivor?.slot).toBeUndefined();
  });

  it('keeps a slot on an entry the mission never fields', () => {
    // `{ ...left }` (mission.ts:1887) is a full spread, so an entry no
    // `from_ledger` placement drew comes back exactly as it went in.
    const pooled = trip.produced.find((r) => r.name === POOLED.name);
    expect(pooled, 'the unfielded pool entry is missing from the produced roster').toBeDefined();
    expect(pooled?.slot).toBe(43);
    expect(pooled).toEqual(POOLED);
  });
});
