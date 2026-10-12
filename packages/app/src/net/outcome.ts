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
 */
import type { MatchConfig, Seat } from '@lions/net';
import { isHashTick } from './frame-step';

export type MatchOutcome =
  | { kind: 'ongoing' }
  | { kind: 'won'; side: 0 | 1; by: 'annihilation' | 'surrender' | 'left' }
  | { kind: 'draw'; by: 'mutual' | 'time' };

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
  };
  readonly unitTypes: readonly { readonly weapons: readonly unknown[] }[];
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
 *  draw; the cap with both standing is a draw (the mirror map has no held
 *  ground to settle it -- that tiebreak arrives with zones in N3). There is
 *  no production in a sandbox, so "no combat unit alive" is the whole test. */
export function outcomeOf(sim: OutcomeSim, tick: number): MatchOutcome {
  const standing = SIDES.filter((side) => armedStanding(sim, side));
  if (standing.length === 0) return { kind: 'draw', by: 'mutual' };
  if (standing.length === 1) return { kind: 'won', side: standing[0], by: 'annihilation' };
  if (tick >= MATCH_CAP_TICKS) return { kind: 'draw', by: 'time' };
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

/** The other playing side. */
function opponentOf(side: 0 | 1): 0 | 1 {
  return SIDES.find((s) => s !== side) ?? side;
}

/** The room's `ended`, as a result for this seat. A surrender names the seat
 *  that surrendered, and its side loses. A `left` names nobody: the seat that
 *  left closed its own socket and never hears it, so whoever hears it stayed
 *  and wins. `void` (a desync) and `expired` are no result. */
export function roomEndingOutcome(
  reason: string,
  seat: Seat | undefined,
  viewer: 0 | 1,
  sideOfSeat: (seat: Seat) => 0 | 1,
): MatchResult | null {
  if (reason === 'surrender' && seat !== undefined) return { kind: 'won', side: opponentOf(sideOfSeat(seat)), by: 'surrender' };
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
