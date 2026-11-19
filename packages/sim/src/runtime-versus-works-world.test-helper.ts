import { fx } from './fixed';
import { FWD_CAMP_WORK, FWD_ENGINEER, FWD_SQUAD } from './runtime-forward-world.test-helper';
import { MissionRuntime, type MissionJson } from './mission';
import type { Checkpoint } from './runtime-sink-world.test-helper';
import { Sim } from './sim';

// The versus works world (the lead's ruling, 18 Nov 2026: field works as a room option in KDF v KDF annihilation): a
// WORKS-ONLY runtime (`ctx.worksOnly`) over a sim whose forces were spawned by hand, as `versusSpawns` spawns a room's, so
// the runtime holds no `playerIds` and must find each side's engineer itself. Both sides raise from their own purse
// (1,000 each, no income), through `raiseWorks` / `cancelWorks` commands down the sim's queue, as a room's frames reach it:
//   - side 0 raises a post, then asks for the very key side 1 asked for in the same tick (refused, uncharged, as an `overlap`);
//   - side 1 raises a production work, which completes and appends a line at the tail of `lines[1]`;
//   - side 1 raises a post and cancels it half built (a partial refund to side 1's purse, its count back);
//   - side 1 asks to cancel side 0's site and is refused.
// It is the snapshot witness's world for the side-1 rows (`worksOfferList1`, `worksPending1`, `worksSites1`,
// `appendedAnchors1`). The file name is not matched by vitest's `*.test.ts` glob on purpose, as `golden-worlds.test-helper.ts`.

/** A plain work: 150 logistics, 4 s, 2x2, no production line. */
export const VW_POST = {
  id: 'vw_post',
  name: 'Post',
  hp_per_tile: 300,
  owner: 0,
  buildable: { cost: { logistics: 150 }, build_time_s: 4, footprint: [2, 2] },
};

export function versusWorksMission(): MissionJson {
  return {
    id: 'versus_works',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [],
    field_works: { vw_post: 2, fwd_camp: 1 },
  } as unknown as MissionJson;
}

/** Each side's two engineers and a squad, spawned by the world (not the runtime). Side 0 west, side 1 east. */
export const VW_START: readonly (readonly [number, string, number, number])[] = [
  [0, 'fwd_engineer', 8, 10],
  [0, 'fwd_engineer', 20, 20],
  [0, 'fwd_squad', 6, 14],
  [1, 'fwd_engineer', 38, 10],
  [1, 'fwd_engineer', 28, 20],
  [1, 'fwd_squad', 40, 14],
];
/** Where the world raises: side 0's post, side 1's camp, side 1's post (cancelled), the contested key. */
export const VW_PADS = { post0: [10, 10], camp1: [34, 10], post1: [34, 16], contested: [24, 20] } as const;
export const VW_TICKS = 400;

export function versusWorksWorld(): { sim: Sim; rt: MissionRuntime } {
  const sim = new Sim({ seed: 0x5677, width: 48, height: 32, capacity: 32, humanHeld: [true, true] });
  const types = new Map<string, number>();
  for (const t of [FWD_SQUAD, FWD_ENGINEER]) types.set(t.id, sim.addUnitType(t));
  for (const s of [VW_POST, FWD_CAMP_WORK]) sim.addStructureType(s as never);
  for (const [side, unit, x, y] of VW_START) sim.spawn(types.get(unit) ?? 0, side, fx.from(x + 0.5), fx.from(y + 0.5));
  const rt = new MissionRuntime(sim, versusWorksMission(), {
    typeIdOf: (u) => {
      const t = types.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: {},
    zones: {},
    economy: { logisticsStart: [1000, 1000], logisticsRatePerMin: [0, 0] },
    worksOnly: true,
  });
  rt.start();
  return { sim, rt };
}

function must(ok: boolean, what: string): void {
  if (!ok) throw new Error(`versus works world: ${what}`);
}

/** The world's inputs, as commands down the sim's queue (a room's path). `i` is the tick count BEFORE the tick. */
export function versusWorksDrive(sim: Sim, rt: MissionRuntime, i: number): void {
  const raise = (side: 0 | 1, works: string, [x, y]: readonly [number, number]): void => {
    sim.queueCommand({ kind: 'raiseWorks', side, works, x, y, ids: [] });
  };
  if (i === 1) raise(0, 'vw_post', VW_PADS.post0);
  if (i === 2) raise(1, 'fwd_camp', VW_PADS.camp1);
  if (i === 5) {
    // Both sides ask for one key in one frame, side 1 first: side 1 is charged, and side 0's request, which the sim would
    // refuse as an overlap, is refused before any charge (`otherSidePending`).
    must(rt.constructReason('vw_post', VW_PADS.contested[0], VW_PADS.contested[1], undefined, 0) === null, 'side 0 to be free to ask before side 1 is charged');
    raise(1, 'vw_post', VW_PADS.contested);
    raise(0, 'vw_post', VW_PADS.contested);
  }
  if (i === 6) {
    must(rt.constructReason('vw_post', VW_PADS.contested[0], VW_PADS.contested[1], undefined, 0) === 'overlap', 'side 0 refused on a site side 1 opened');
    // The contested site was side 1's, and side 1 takes it down at once (a full refund: nothing was built).
    const site = rt.unstakedWorksAt(VW_PADS.contested[0], VW_PADS.contested[1], 1)?.site ?? -1;
    must(site >= 0, 'side 1 to hold the contested site');
    must(!rt.canCancelWorks(site, 0), 'side 0 refused a cancel of side 1\'s site');
    sim.queueCommand({ kind: 'cancelWorks', side: 0, site });
    sim.queueCommand({ kind: 'cancelWorks', side: 1, site });
  }
  if (i === 160) raise(1, 'vw_post', VW_PADS.post1);
  if (i === 320) {
    const site = rt.unstakedWorksAt(VW_PADS.post1[0], VW_PADS.post1[1], 1)?.site ?? rt.worksAt(sim.structureAt(VW_PADS.post1[0], VW_PADS.post1[1]), 1)?.site ?? -1;
    must(site >= 0, 'side 1 to hold its post site at 320');
    sim.queueCommand({ kind: 'cancelWorks', side: 1, site });
  }
}

export function versusWorksAdvance(w: { readonly sim: Sim; readonly rt: MissionRuntime }): void {
  w.rt.applyQueued();
  w.rt.step(w.sim.tick());
}

/** Walk the world to its end, checking at the moments that matter and every 20 ticks: the census's walk. */
export function walkVersusWorks(at: (c: Checkpoint) => void): void {
  const { sim, rt } = versusWorksWorld();
  const look = (label: string): void => at({ label, rt, sim });
  look('versusWorks@0');
  for (let t = 1; t <= VW_TICKS; t++) {
    versusWorksDrive(sim, rt, t - 1);
    if (t === 3) {
      // Between the queue and the tick: side 1's camp is charged and not yet answered, the one moment `worksPending1` holds it.
      rt.applyQueued();
      look('versusWorks@3- (side 1 charged, the sim not yet answered)');
      rt.step(sim.tick());
      look('versusWorks@3 (both sides staking)');
      continue;
    }
    versusWorksAdvance({ sim, rt });
    if (t % 20 === 0) look(`versusWorks@${t}`);
  }
}
