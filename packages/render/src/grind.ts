// Shared predicate and band math for blade demolition presentation.
//
// The renderer (dust placement) and the debug overlay (log coalescing) both
// need to answer the same question — "is this structureHit a blade grinding
// its target, or something else hitting a building?" — and both need to slot
// a building's remaining HP into the same eighths the renderer already draws
// with. Keeping one copy of each here means the two views can never drift
// out of sync with each other, or with what the sim actually did.

import type { Fx, Sim } from '@lions/sim';

/**
 * True when a `structureHit` on `structure` is a blade unit's own grind,
 * not incidental damage from something else.
 *
 * All three clauses are load-bearing:
 *  - `e.by >= 0`: some hits (e.g. area effects) carry no attributed unit.
 *  - `bladeDemolition`: a `charges` demolisher can also be shooting — the KDF
 *    demo squad carries a `charges` weapon at 1.5-tile range, which is inside
 *    DEMO_RANGE_SQ (2 tiles). Halted beside an enemy-garrisoned building it is
 *    simultaneously auto-designated on that building (`demoTarget` points at
 *    it) AND firing at it, so `demoTarget` alone would misclassify every one
 *    of its shots as blade grinding.
 *  - `demoTarget[e.by] === structure`: a blade unit can be lined up on one
 *    building while some other event lands damage on a different one.
 */
export function isGrindingHit(sim: Sim, by: number, structure: number): boolean {
  return (
    by >= 0 &&
    sim.unitTypes[sim.state.typeIdx[by]].bladeDemolition &&
    sim.state.demoTarget[by] === structure
  );
}

/**
 * Which eighth of max HP `hp` falls into, 0 (destroyed) .. 8 (untouched).
 * This is the renderer's pre-existing visible-wear step (`bumpStructureWear`)
 * — the design's "one notion of a band" means both the redraw threshold and
 * the log coalescing must use this exact expression, ceil and all, so a log
 * line and the darkening step it reports never fall a bite out of step.
 */
export function structureHpBand(hp: Fx, max: Fx): number {
  return max > 0 ? Math.max(0, Math.min(8, Math.ceil((hp * 8) / max))) : 8;
}
