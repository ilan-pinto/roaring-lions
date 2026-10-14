/**
 * A versus match's scoreboard (the lead's ask after the first real friend
 * match, 2026-10-14): for each side, the units it has lost, the enemy units it
 * has destroyed, the value of each, and what it has left.
 *
 * Read from sim state alone, exactly as `outcomeOf` is, so the two seats --
 * which hold the same state at the same tick -- always show the same numbers.
 * Nothing here listens to events: a seat that rejoins mid-match replays the
 * room's log into the same state, and the board it reads is the board the
 * other seat reads. Nothing writes to the sim (invariant 4).
 *
 * In a two-sided match a side's "destroyed" is the other side's "lost": the
 * sim keeps no shooter on a dead unit, so a unit killed by its own side's
 * splash counts as a loss to it and a kill to the enemy. Both seats count it
 * the same way, which is the property that matters.
 */
import type { MatchConfig } from '@lions/net';
import { forcesOf, unitCost, type OutcomeSim } from './outcome';

/** One side's line. Values are the unit data's logistics cost, the number the
 *  remaining-forces rule (`forcesOf`, PR 579) prices. */
export interface SideScore {
  /** Units of this side destroyed. */
  readonly lost: number;
  readonly lostValue: number;
  /** Units of the other side this side has destroyed. */
  readonly destroyed: number;
  readonly destroyedValue: number;
  /** The surviving force value: `forcesOf`, the very number a stalemate or
   *  the time limit is decided on. */
  readonly remaining: number;
}

/** Both sides' lines, by SIDE (index 0 is side 0). */
export type MatchScore = readonly [SideScore, SideScore];

/** The slice of `Sim` the board reads: the outcome's, plus `removed` -- a unit
 *  a mission took off the board without a fight is no loss (a room runs no
 *  mission, so it is never set there; read for the same answer anyway). */
export type ScoreSim = OutcomeSim & { readonly state: OutcomeSim['state'] & { readonly removed?: ArrayLike<number> } };

/** The scoreboard, from sim state alone. */
export function scoreOf(sim: ScoreSim, costOf: (typeId: string) => number = unitCost): MatchScore {
  const lost = [0, 0];
  const lostValue = [0, 0];
  const { side: sides, alive, typeIdx, removed } = sim.state;
  for (let i = 0; i < sim.entityCount; i++) {
    const side = sides[i];
    if (alive[i] !== 0 || (side !== 0 && side !== 1) || removed?.[i] === 1) continue;
    lost[side]++;
    lostValue[side] += costOf(sim.unitTypes[typeIdx[i]]?.id ?? '');
  }
  const remaining = forcesOf(sim, costOf);
  const line = (side: 0 | 1): SideScore => {
    const other = side === 0 ? 1 : 0;
    return {
      lost: lost[side],
      lostValue: lostValue[side],
      destroyed: lost[other],
      destroyedValue: lostValue[other],
      remaining: remaining[side],
    };
  };
  return [line(0), line(1)];
}

/** The board as `viewer` reads it: its own line first. */
export function scoreFor(score: MatchScore, viewer: 0 | 1): { mine: SideScore; theirs: SideScore } {
  return { mine: score[viewer], theirs: score[viewer === 0 ? 1 : 0] };
}

/** Whether a battlefield shows the board: a versus room, and nothing else --
 *  single-player and a sandbox room keep their HUD exactly as it was. */
export function showsScoreboard(config: Pick<MatchConfig, 'mode'> | null): boolean {
  return config?.mode === 'versus';
}
