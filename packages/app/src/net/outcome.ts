/**
 * How a versus match ends (spec §2.3, version one; N1b task 10). The rule is
 * read from sim state alone and checked on hash ticks only, so both machines
 * -- which hold the same state at the same tick -- reach the same result on
 * the same tick without saying a word to each other. Nothing here writes to
 * the sim (invariant 4): it counts what is alive.
 *
 * A room's own endings (a seat surrendered, a seat left) arrive from the
 * room instead, and wait behind the frames the transport still holds
 * (`matchResult`, R-B11): a result the sim reaches while draining them wins.
 *
 * A result the sim reached is told to the room once (`reportOver`, L-1): the
 * room closes itself two minutes after both seats have reported it. That
 * ending (`over`) is no result of its own -- the panel is already up.
 */
import { units } from '@lions/data';
import { endingLoser, type MatchConfig, type Seat } from '@lions/net';
import { isHashTick } from './frame-step';

/** Each side's surviving force value, by SIDE (index 0 is side 0). */
export type Forces = readonly [number, number];

export type MatchOutcome =
  | { kind: 'ongoing' }
  | { kind: 'won'; side: 0 | 1; by: 'annihilation' | 'surrender' | 'left' | 'forfeit' }
  /** Decided on surviving unit value (the lead's ruling, 2026-10-13): every
   *  unit on both sides immobile (`stalemate`), or the 25-minute cap (`time`). */
  | { kind: 'won'; side: 0 | 1; by: 'stalemate' | 'time'; forces: Forces }
  | { kind: 'draw'; by: 'mutual' }
  | { kind: 'draw'; by: 'stalemate' | 'time'; forces: Forces };

/** A decided match: what the end panel shows. */
export type MatchResult = Exclude<MatchOutcome, { kind: 'ongoing' }>;

/** 25 minutes of 20 Hz ticks. */
export const MATCH_CAP_TICKS = 25 * 60 * 20;

/** The slice of `Sim` the rule reads. */
export interface OutcomeSim {
  readonly entityCount: number;
  readonly state: {
    readonly side: ArrayLike<number>;
    readonly alive: ArrayLike<number>;
    readonly typeIdx: ArrayLike<number>;
    /** 1 once a unit's weapons are knocked out for good (`firepower_kill`,
     *  `combat_ineffective`): never cleared, and hashed. Such a hull is not a
     *  combat unit (R-B20). */
    readonly firepowerKilled?: ArrayLike<number>;
    /** 1 while a unit is stuck (`mobility_kill`, `combat_ineffective`), and
     *  hashed; `stepMovement` skips such a unit outright. Not for good since
     *  GH-706: a GROUND hull's crew fixes it to slowed after 90 s of quiet (a
     *  workshop clears it too), so only an aircraft's -- a forced landing,
     *  which no crew can re-rig -- is permanent. */
    readonly mobilityKilled: ArrayLike<number>;
  };
  readonly unitTypes: readonly {
    readonly id: string;
    readonly weapons: readonly unknown[];
    /** Q16.16 tiles a tick; 0 is a type with no movement at all. */
    readonly stepPerTick: number;
    /** An aircraft: its mobility kill is a forced landing, never field-fixed. */
    readonly isAir: boolean;
  }[];
}

/** A unit type's value: its logistics cost from the unit data, the number
 *  the cost curve prices (`tools/validate_balance.py`). 0 for a type the data
 *  does not know, so an unknown never tips a result. */
export function unitCost(typeId: string): number {
  const u = (units as Record<string, { cost?: { logistics?: number } } | undefined>)[typeId];
  return u?.cost?.logistics ?? 0;
}

/** Whether unit `i` can never move again: a mobility-killed AIRCRAFT (a
 *  forced landing; GH-706), or a type with no movement. Read from hashed sim
 *  state only, so both seats agree. A stuck GROUND hull is NOT immobile since
 *  GH-706: its crew field-fixes it to slowed after 90 s of quiet, so the fight
 *  can still close. Nor is a pinned, garrisoned, carried, buried, braced or
 *  halted unit: each of those ends, and the sim keeps no flag for them that
 *  says otherwise. */
function immobile(sim: OutcomeSim, i: number): boolean {
  const type = sim.unitTypes[sim.state.typeIdx[i]];
  if (sim.state.mobilityKilled[i] === 1 && type?.isAir === true) return true;
  return (type?.stepPerTick ?? 0) <= 0;
}

/** Whether every living unit of the two playing sides is immobile. */
function allImmobile(sim: OutcomeSim): boolean {
  const { side: sides, alive } = sim.state;
  for (let i = 0; i < sim.entityCount; i++) {
    if (alive[i] === 0 || (sides[i] !== 0 && sides[i] !== 1)) continue;
    if (!immobile(sim, i)) return false;
  }
  return true;
}

/** Each playing side's surviving value: the sum of its living units' costs. */
export function forcesOf(sim: OutcomeSim, costOf: (typeId: string) => number = unitCost): [number, number] {
  const out: [number, number] = [0, 0];
  const { side: sides, alive, typeIdx } = sim.state;
  for (let i = 0; i < sim.entityCount; i++) {
    const side = sides[i];
    if (alive[i] === 0 || (side !== 0 && side !== 1)) continue;
    out[side] += costOf(sim.unitTypes[typeIdx[i]]?.id ?? '');
  }
  return out;
}

/** The higher surviving value wins; equal values draw. */
function byForces(sim: OutcomeSim, by: 'stalemate' | 'time', costOf: (typeId: string) => number): MatchResult {
  const forces = forcesOf(sim, costOf);
  if (forces[0] === forces[1]) return { kind: 'draw', by, forces };
  return { kind: 'won', side: forces[0] > forces[1] ? 0 : 1, by, forces };
}

/** The two playing sides. A third (civilians) neither keeps a side standing nor wins. */
const SIDES: readonly (0 | 1)[] = [0, 1];

/** Whether `side` still has a living unit that can fight: one that carries a
 *  weapon and has not had its firepower knocked out. A drone, a truck, a
 *  dozer or a hull whose guns are gone for good cannot win a fight, so it
 *  does not keep a side standing (spec §2.3: "no combat unit alive"; R-B20) --
 *  otherwise a beaten side holds the match to the 25-minute draw. */
function armedStanding(sim: OutcomeSim, side: 0 | 1): boolean {
  const { side: sides, alive, typeIdx, firepowerKilled } = sim.state;
  for (let i = 0; i < sim.entityCount; i++) {
    if (alive[i] === 0 || sides[i] !== side) continue;
    if (firepowerKilled?.[i] === 1) continue;
    if ((sim.unitTypes[typeIdx[i]]?.weapons.length ?? 0) > 0) return true;
  }
  return false;
}

/** Spec §2.3, version one, read from sim state alone so both machines agree:
 *  a side with no living armed unit has lost; both on the same tick is a
 *  draw. With both standing, the lead's ruling (2026-10-13) settles two more
 *  cases by surviving unit value (`forcesOf`), the higher total winning and
 *  equal totals drawing: every living unit on both sides immobile (nothing
 *  can ever close the distance -- a stalemate, ended at once), and the
 *  25-minute cap, which until then was always a draw. There is no production
 *  in a sandbox, so the counts are the whole test. */
export function outcomeOf(sim: OutcomeSim, tick: number, costOf: (typeId: string) => number = unitCost): MatchOutcome {
  const standing = SIDES.filter((side) => armedStanding(sim, side));
  if (standing.length === 0) return { kind: 'draw', by: 'mutual' };
  if (standing.length === 1) return { kind: 'won', side: standing[0], by: 'annihilation' };
  if (allImmobile(sim)) return byForces(sim, 'stalemate', costOf);
  if (tick >= MATCH_CAP_TICKS) return byForces(sim, 'time', costOf);
  return { kind: 'ongoing' };
}

/** The rule, asked only on the frame that closes a hash window (`isHashTick`,
 *  keyed by the FRAME's tick like the hash itself): both seats run the same
 *  frames into the same state, so both decide on the same tick, and the
 *  hash sent on that tick covers the state the decision was read from. The
 *  cap is measured on the sim's own tick count. Null while it is ongoing,
 *  on any other tick, and without a room. */
export function hashTickOutcome(frameTick: number, config: MatchConfig | null, sim: OutcomeSim & { readonly tickCount: number }): MatchResult | null {
  if (!isHashTick(frameTick, config)) return null;
  const o = outcomeOf(sim, sim.tickCount);
  return o.kind === 'ongoing' ? null : o;
}

/** A result this seat's sim reached, and the frame tick it was read on:
 *  what it reports to the room as `over` (L-1). */
export interface LocalDecision { readonly result: MatchResult; readonly tick: number }

/** `hashTickOutcome`, remembered with the frame tick that decided it: the
 *  first decision stands. Both seats read it on the same frame tick, so both
 *  report the same `over` tick. */
export function decideOnHashTick(
  prev: LocalDecision | null, frameTick: number, config: MatchConfig | null, sim: OutcomeSim & { readonly tickCount: number },
): LocalDecision | null {
  if (prev !== null) return prev;
  const result = hashTickOutcome(frameTick, config, sim);
  return result === null ? null : { result, tick: frameTick };
}

/** Tells the room this seat's result as its panel goes up (L-1, R-B26) --
 *  only when the panel shows the result the SIM reached (`matchResult` hands
 *  back that very object). A result taken from the room's own ending (a
 *  surrender, a leave) owes nothing: that room has ended already. The
 *  transport sends one `over` however often it is asked. */
export function reportOver(room: { over(tick: number): void } | null, shown: MatchResult, local: LocalDecision | null): void {
  if (room !== null && local !== null && shown === local.result) room.over(local.tick);
}

/** The other playing side. */
function opponentOf(side: 0 | 1): 0 | 1 {
  return SIDES.find((s) => s !== side) ?? side;
}

/** The room's `ended`, as a result for this seat. A surrender, a leave and
 *  a forfeit (60 s disconnected) name the seat that gave the match up
 *  (`endingLoser`, one rule for both seats), and its side loses. A `left`
 *  from an older room names nobody: the seat that left closed its own socket
 *  and never hears it, so whoever hears it stayed and wins. `void` (a desync,
 *  or both seats dropped at once), `expired` and `over` (the room closing
 *  itself after the result the sims reached, L-1) are no result. */
export function roomEndingOutcome(
  reason: string,
  seat: Seat | undefined,
  viewer: 0 | 1,
  sideOfSeat: (seat: Seat) => 0 | 1,
): MatchResult | null {
  const loser = endingLoser(reason, seat);
  if (loser !== null && (reason === 'surrender' || reason === 'left' || reason === 'forfeit')) return { kind: 'won', side: opponentOf(sideOfSeat(loser)), by: reason };
  if (reason === 'left') return { kind: 'won', side: viewer, by: 'left' };
  return null;
}

/** What the panel shows after a frame's stepping, or null to keep going
 *  (R-B11). The sim's own result wins: it is the one both seats reach. A
 *  room's ending shows only once `drained` -- the transport yielded nothing
 *  more -- because the frames it still holds were issued before the ending
 *  and may decide the match on a tick the other seat has already reached. */
export function matchResult(local: MatchResult | null, ending: MatchResult | null, drained: boolean): MatchResult | null {
  if (local !== null) return local;
  if (ending !== null && drained) return ending;
  return null;
}
