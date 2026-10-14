/**
 * Idle exhaust dated off the SIM clock (GH-391), the same slot-and-seed
 * pattern `rotor-wash.ts` uses. Slot `k` is the window
 * [k * interval, (k + 1) * interval) of presentation sim time; its puffs are
 * seeded by (entity, slot) and trickle out over `emitOverMs`, so the slot is
 * only emitted once the whole trickle has elapsed (a frame at sim time `t`
 * emits slots with `k * interval + emitOverMs <= t`). Every puff is then born
 * with an age that is a function of sim time alone.
 *
 * A fixed visual cost, accepted: the first puff of a window appears
 * `emitOverMs - interval` (0 when they match) later than it used to.
 */
import { VEHICLE_BAND_CLEAN, vehicleWispsAtBand } from './vehicle-damage';
import { washRand } from './rotor-wash';

/** Newest slot whose last particle is due at `simMs`; -1 before any. */
export function exhaustSlotDue(simMs: number, intervalMs: number, emitOverMs: number): number {
  return Math.floor((simMs - emitOverMs) / intervalMs);
}

/**
 * `[first, last]` slots to emit this frame: `lastEmitted + 1` up to the newest
 * due, never further back than a puff (`maxLifeMs` plus the trickle) can live.
 */
export function exhaustSlotsDue(
  lastEmitted: number,
  simMs: number,
  intervalMs: number,
  emitOverMs: number,
  maxLifeMs: number
): [number, number] {
  const last = exhaustSlotDue(simMs, intervalMs, emitOverMs);
  const reach = Math.max(0, Math.ceil((maxLifeMs + emitOverMs) / intervalMs));
  return [Math.max(lastEmitted + 1, last - reach), last];
}

/** Seconds since slot `slot` opened. */
export function exhaustSlotAgeSec(slot: number, simMs: number, intervalMs: number): number {
  return Math.max(0, simMs - slot * intervalMs) / 1000;
}

/** Seeded like rotor wash, salted so the two never share a stream. */
export function exhaustRand(entityId: number, slot: number): () => number {
  return washRand(entityId + 0x10000, slot);
}

/**
 * Does this unit trail the thin damage wisp? Never an aircraft: the wisp is a
 * ground particle with no height, and a helicopter's engine deck is out of its
 * reach (a helicopter still scars, `vehicle-damage.ts`). Otherwise either:
 *  - Pass C2/C4 (P3): a hard-skinned vehicle that has lost its mobility, its
 *    firepower or both (a soft unit never rolls a component); or
 *  - GH-31: any hull DRAWN at a badly damaged band, 2..1
 *    (`vehicleWispsAtBand`), soft-skinned or not -- the lead's ruling that a
 *    nearly dead hull always says so. `drawnBand` is the band the renderer
 *    last drew the hull's scar at (`vehicleDrawnBand`), so the smoke and the
 *    scar cannot disagree; a unit with no mesh hull (infantry) passes the
 *    clean default and is decided by the first rule alone.
 * Either way it is the ONE wisp: no second emitter, no fire on a living hull.
 */
export function vehicleTrailsDamageSmoke(
  type: { readonly isSoft: boolean; readonly isAir: boolean },
  mobilityKilled: number,
  firepowerKilled: number,
  drawnBand: number = VEHICLE_BAND_CLEAN
): boolean {
  if (type.isAir) return false;
  if (!type.isSoft && (mobilityKilled === 1 || firepowerKilled === 1)) return true;
  return vehicleWispsAtBand(drawnBand);
}
