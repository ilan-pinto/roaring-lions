/**
 * What the projected-fire panel says about one hovered enemy, as one word
 * (GH-345, spec §a beat 5).
 *
 * The panel itself (`hud.ts`'s `projectedFireHtml`) and the tutorial's
 * `hover.projection` predicate both read this, so the lesson "hover the one
 * in cover" is satisfied by exactly the hover the panel words as cover --
 * never by a second derivation that could disagree with what is on screen.
 *
 * Pure: it takes the sim's own `projectHit` answers, already computed, and
 * never asks the sim anything (invariant 4 is not even reachable from here).
 *
 *  - Any `shot` wins, and the BEST one (highest pHit) is the one described:
 *    `cover` when the target's ground is costing the shot anything, else
 *    `moving` when its motion is, else plain `shot`. Cover outranks motion
 *    because it is the one the player can act on by moving themselves.
 *  - No shot and anyone unidentified: `unidentified` (the remedy is to keep
 *    looking, which outranks "out of reach" for the unit that could see it).
 *  - No shot and someone holding fire (pinned, or a cold ambush): `holding`.
 *  - Otherwise `out_of_reach`: out of range, or no line of sight -- the sim's
 *    `noSolution` does not say which (Stage 4 may add a reason).
 */

import { fx, type HitProjection } from '@lions/sim';

export type FireState = 'unidentified' | 'cover' | 'moving' | 'out_of_reach' | 'shot' | 'holding';

/** A factor this close to 1 is not a penalty worth naming -- the same
 *  threshold `worstPenalties` uses, so the panel never calls a target "in
 *  cover" when it prints no cover penalty. */
export const PENALTY_THRESHOLD = 0.995;

export function fireState(projections: readonly HitProjection[]): FireState | null {
  if (projections.length === 0) return null;
  let best: Extract<HitProjection, { kind: 'shot' }> | null = null;
  let unidentified = false;
  let holding = false;
  for (const p of projections) {
    if (p.kind === 'shot') {
      if (best === null || p.pHit > best.pHit) best = p;
    } else if (p.kind === 'unidentified') unidentified = true;
    else if (p.kind === 'holdingFire') holding = true;
  }
  if (best !== null) {
    if (fx.toNumber(best.factors.coverMod) < PENALTY_THRESHOLD) return 'cover';
    if (fx.toNumber(best.factors.motionMod) < PENALTY_THRESHOLD) return 'moving';
    return 'shot';
  }
  if (unidentified) return 'unidentified';
  if (holding) return 'holding';
  return 'out_of_reach';
}
