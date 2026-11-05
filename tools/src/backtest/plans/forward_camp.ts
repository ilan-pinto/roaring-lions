// The forward-camp build plans of the two Build-up missions (GH-277, the lead's rulings of 4 Nov 2026): the shipped
// winning plan, plus a `kdf_forward_camp` ordered at 0:00 and used.
//
// Side-effect free, like the plans beside it: this module exports closures and runs nothing.
//
// How the shipped plan is reused without being copied. The engineers are the plan's own `demo_squad`, which the shipped
// plan sends to raze a building. While the camp is going up they are its builders, so the shipped plan is handed an EMPTY
// demo list that is filled with the real squad only once the camp stands. The list is one shared array: the shipped plan
// reads `ids('demo_squad')` once, and queues commands with that array afterwards.
//
// What a player does with a camp: the camp is ordered at 0:00 and the rest of the purse buys what the shipped plan buys,
// as the money arrives. Whatever the camp's line produces is taken out of the shipped plan's hands (it would send a
// squad bought at the forward door back to the rear) and mustered where the fight is. Where the shipped plan buys nothing
// (Umm Zeitoun II), the build plan buys rifle squads and AT teams on the camp's line whenever the purse allows.
import { fx, type Sim, type MissionRuntime, type SimEvent } from '@lions/sim';
import { runNotes, type Plan } from '../playtest-run';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

export interface ForwardCampSpec {
  /** Top-left tile of the 2x2 pad. */
  x: number;
  y: number;
  /** Where a body that came out of the camp's door is sent. */
  muster: [number, number];
  /** When set, the plan buys these on the camp's line, in turn, whenever the purse allows, until `buyUntil` s. */
  buys?: readonly string[];
  buyUntil?: number;
  /** A purchase the camp displaces at 0:00 (Umm Zeitoun II's Remetz): made as soon as the purse allows, then parked. */
  defer?: { unit: string; post: [number, number]; until: number };
}

/** What a run of a build plan recorded: when the camp stood, and what its line produced. */
export interface ForwardCampRecord {
  ordered: boolean;
  /** Seconds from the start until `structureComplete` for the camp; -1 if it never stood. */
  doneS: number;
  /** Bodies that came out of the camp's door. */
  fromCamp: number;
}

export function forwardCampPlan(
  base: Plan,
  spec: ForwardCampSpec
): { plan: Plan; onEvents: (evs: readonly SimEvent[]) => void; record: ForwardCampRecord } {
  const record: ForwardCampRecord = { ordered: false, doneS: -1, fromCamp: 0 };
  let campStructure = -1;
  let simRef: Sim | undefined;
  const onEvents = (evs: readonly SimEvent[]): void => {
    for (const e of evs) {
      if (e.kind !== 'structureComplete' || record.doneS >= 0 || simRef === undefined) continue;
      if (campStructure < 0) campStructure = simRef.structureAt(spec.x, spec.y);
      if (e.structure === campStructure) {
        record.doneS = e.tick / 20;
        runNotes.forwardCampDoneS = record.doneS;
      }
    }
  };
  const plan: Plan = (sim: Sim, rt: MissionRuntime, ids, at) => {
    simRef = sim;
    const real = ids('demo_squad');
    const lent: number[] = [];
    const ours = new Set<number>();
    let released = false;
    // The camp first, so its 350 comes off the purse before the shipped plan's t=0 purchase asks for the rest.
    at(0, () => {
      record.ordered = rt.requestConstruct('kdf_forward_camp', spec.x, spec.y, real);
      runNotes.forwardCampFromCamp = 0;
    });
    const gated = (t: string): number[] => (t === 'demo_squad' ? lent : ids(t).filter((i) => !ours.has(i)));
    base(sim, rt, gated, at);
    for (let s = 2; s <= 400; s += 2)
      at(s, () => {
        if (!released && record.doneS >= 0) {
          released = true;
          lent.push(...real);
        }
      });
    if (spec.defer !== undefined) {
      const d = spec.defer;
      let bought = ids(d.unit).length > 0;
      let parked = false;
      for (let s = 2; s <= d.until; s += 2)
        at(s, () => {
          if (!bought) bought = rt.requestBuild(d.unit);
          const have = ids(d.unit).filter((i) => sim.state.alive[i] === 1);
          if (have.length > 0 && !parked) {
            parked = true;
            sim.queueCommand({ kind: 'move', ids: have, ...M(d.post[0], d.post[1]) });
          }
        });
    }
    // Everything that exists is "known" until the camp stands; after that, a body not seen before that appears at the
    // camp's door came out of its line (a purchase at the rear door appears far from it and is left to the shipped plan).
    const known = new Set<number>();
    let turn = 0;
    for (let s = 2; s <= (spec.buyUntil ?? 400); s += 2)
      at(s, () => {
        const appeared: number[] = [];
        for (let i = 0; i < sim.entityCount; i++) if (!known.has(i)) { known.add(i); appeared.push(i); }
        if (record.doneS < 0) return;
        if (spec.buys !== undefined && s % 4 === 0 && s <= (spec.buyUntil ?? 0) && rt.requestBuild(spec.buys[turn % spec.buys.length], 1)) turn++;
        const fresh = appeared.filter((i) => {
          if (sim.state.side[i] !== 0 || sim.state.alive[i] !== 1) return false;
          const dx = sim.state.posX[i] / 65536 - (spec.x + 1);
          const dy = sim.state.posY[i] / 65536 - (spec.y + 1);
          return dx * dx + dy * dy <= 25;
        });
        if (fresh.length > 0) {
          for (const i of fresh) ours.add(i);
          record.fromCamp += fresh.length;
          runNotes.forwardCampFromCamp = record.fromCamp;
          sim.queueCommand({ kind: 'attackMove', ids: fresh, ...M(spec.muster[0], spec.muster[1]) });
        }
      });
  };
  return { plan, onEvents, record };
}

/** Ein Qasab III: the camp at the south landing, at the foot of the causeway; the shipped plan buys, the camp's line takes a share. */
export const EQ3_CAMP: ForwardCampSpec = { x: 21, y: 34, muster: [24, 19] };

/** Umm Zeitoun IV (GH-277, second wave): the camp on the open road south of the escarpment, the line buys rifle squads and AT teams for the push north. */
export const UZ4_CAMP: ForwardCampSpec = { x: 26, y: 38, muster: [30, 20], buys: ['inf_squad', 'at_team'], buyUntil: 240 };

/** Mission id to its camp spec: the one table the plans (playtest.ts) and gate 11 both read, so a spec with `buys` cannot dodge the gate. */
export const FORWARD_CAMP_SPECS: Readonly<Record<string, ForwardCampSpec>> = {
  ein_qasab_3_buildup: EQ3_CAMP,
  umm_zeitoun_4_clearance: UZ4_CAMP
};
