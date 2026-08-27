/**
 * Task B3.9: which tiles a `structureHit`/`structureDestroyed` event dirties,
 * and whether a hit is even worth a redraw. Pure, plain-number logic --
 * deliberately no `Sim` import, the same "the pure builder must stay
 * ignorant of Sim" convention every other file in this directory keeps
 * (`buildings.ts`'s own `StructureFootprint` doc comment states it
 * explicitly: "the minimum this builder needs and nothing that would
 * require it to import Sim itself"). `ThreeRenderer.ts` is the one place a
 * structure event and a live `Sim` cross that boundary, exactly as it
 * already does for `structureFootprintsFor`: it looks up the hit/destroyed
 * structure's own footprint tiles and current hp/maxHp, and hands plain
 * numbers to the functions below.
 *
 * A structure taking damage and a structure dying do NOT invalidate the
 * same set of terrain LAYERS, even though they share the same tile list (a
 * structure's own footprint, fixed for its whole life -- structures are
 * never added or moved after boot). Damage darkens the walls this
 * structure's own boxes draw (`buildings.ts`'s `wear`), and nothing else:
 * `ground.ts`/`scatter.ts`/`grove.ts` never read a structure's hp, only
 * whether its tiles are `blocked`. Death flips `blocked` across the whole
 * footprint at once, which those three layers DO read (open ground where a
 * building's box used to stand), on top of removing the box entirely.
 * `dirtyForStructureHit` and `dirtyForStructureDestroyed` report exactly
 * that distinction (`kind: 'wear'` vs `'unblocked'`) so the caller does not
 * have to re-derive it from scratch at every call site.
 */

export type StructureDirtyKind = 'wear' | 'unblocked';

/** Which tiles changed, and what kind of change it was -- see this module's
 *  own top comment for what the two kinds mean for the four terrain layers. */
export interface StructureDirty {
  readonly kind: StructureDirtyKind;
  readonly tiles: readonly number[];
}

/**
 * Which eighth of max HP `hp` falls into, 0 (destroyed) .. 8 (untouched).
 *
 * This is the renderer-side counterpart of `packages/render/src/grind.ts`'s
 * `structureHpBand` -- the exact same formula, deliberately duplicated
 * rather than imported. `grind.ts` takes `Fx` (a `@lions/sim` type alias for
 * `number`, `packages/sim/src/fixed.ts`) and exists to keep the renderer's
 * own visible-wear step and the debug overlay's log-coalescing band in sync
 * with each other; pulling it in here would import `@lions/sim` into a
 * `terrain/` file for no reason beyond a type alias, breaking the
 * Sim-ignorance every sibling builder in this directory keeps on purpose. A
 * `structureHit`/`structureDestroyed` event's `hp`/`maxHp` fields are plain
 * numbers by the time `ThreeRenderer.ts` (the one place with both an event
 * and a `Sim`) reaches this function, so nothing is lost by taking `number`
 * here instead. `dirty.test.ts` proves the two formulas agree across a
 * spread of hp/maxHp values, including the `maxHp <= 0` edge, so they cannot
 * silently drift apart.
 *
 * Eight steps across `buildings.ts`'s own `wear = 0.45 + 0.55 * integrity`
 * ramp -- fine enough that a rifle plinking a 200 HP panel triggers a
 * handful of redraws rather than one per round, coarse enough the eye
 * cannot tell the difference from a redraw on every hit. This is the
 * quantisation that makes wiring `structureHit` into a real rebuild
 * survivable at all (see `ThreeRenderer.ts`'s own `onEvents` doc comment for
 * the cost it exists to avoid): without it, this task's incremental
 * per-structure rebuild would still fire on every round fired at a
 * structure, not merely the handful of hits that visibly change anything.
 */
export function structureWearStep(hp: number, maxHp: number): number {
  return maxHp > 0 ? Math.max(0, Math.min(8, Math.ceil((hp * 8) / maxHp))) : 8;
}

/** `dirtyForStructureHit`'s result: the dirty region (or `null` when the hit
 *  did not cross a wear step -- most hits, by design, see
 *  `structureWearStep`'s own doc comment) plus the step to remember for the
 *  NEXT hit's own comparison. */
export interface StructureHitDirty {
  readonly dirty: StructureDirty | null;
  /** The caller owns per-structure storage across calls (mirrors
   *  `PixiRenderer`'s own lazily-grown `structureWear: Uint8Array`,
   *  `renderer.ts`'s `bumpStructureWear`) -- this function only decides
   *  whether THIS hit changed the step; it does not remember anything
   *  itself, which is what keeps it pure. */
  readonly wearStep: number;
}

/**
 * A `structureHit` on a structure whose own footprint is `tiles`, currently
 * at `hp`/`maxHp`, having last been recorded at `prevWearStep` -- which
 * tiles (if any) need their box geometry recomputed.
 *
 * `tiles` passes straight through into the result unchanged (never
 * filtered, never replaced by "every tile on the map") -- damage never
 * changes WHICH tiles a structure occupies, only how its own boxes are
 * tinted, so the dirty region is exactly the footprint the caller already
 * knows, no smaller and no larger.
 */
export function dirtyForStructureHit(
  tiles: readonly number[],
  prevWearStep: number,
  hp: number,
  maxHp: number
): StructureHitDirty {
  const wearStep = structureWearStep(hp, maxHp);
  if (wearStep === prevWearStep) return { dirty: null, wearStep };
  return { dirty: { kind: 'wear', tiles }, wearStep };
}

/**
 * A `structureDestroyed` on a structure whose own footprint is `tiles` --
 * always dirty (a structure only ever leaves this way once), `kind:
 * 'unblocked'` because `destroyStructure` unblocks the whole footprint at
 * once (`@lions/sim`'s own `Sim.destroyStructure`), not merely darkens it.
 * `tiles` passes through unchanged for the same reason `dirtyForStructureHit`
 * does: the footprint IS the dirty region, not an approximation of it.
 */
export function dirtyForStructureDestroyed(tiles: readonly number[]): StructureDirty {
  return { kind: 'unblocked', tiles };
}
