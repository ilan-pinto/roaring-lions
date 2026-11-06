/**
 * Rotor wash: the dust ring a helicopter throws onto the ground beneath it, and
 * (GH-984 N3) the wash that flattens the grass and thrashes the crowns
 * (`terrain/disturb.ts` takes its strength and radius from here). Presentation
 * only -- every input is a number the renderer already measured, and nothing
 * here touches `Sim`.
 *
 * Strength is `heightFactor * speedFactor`, 0..1:
 *  - HEIGHT: full at the ground (`ROTOR_WASH_FULL_HEIGHT_WU`, ground effect: a
 *    landing or a lift-off is the peak), falling linearly to nothing at
 *    `ROTOR_WASH_NONE_HEIGHT_WU` above the drawn ground. A high aircraft
 *    throws no dust.
 *  - SPEED: hovering is strongest. Forward flight carries the downwash aft
 *    and thins the ring, so full speed keeps `1 - ROTOR_WASH_SPEED_LOSS`.
 *
 * The renderer draws every airborne air unit at one constant lift
 * (`AIR_LIFT_PX`, 0.357 wu) and brings a carrier down to the ground over
 * `airLiftFrac` when it lands, so the height this curve reads runs 0.357 -> 0
 * on a landing. Until GH-984 N3 the curve was already FULL (1.0) from 0.6 wu
 * down, which put the whole drawn range on its flat top: a hover and a
 * touchdown threw identical dust and nothing could "peak" on a landing. Its
 * full point is now the ground, so a hover reads 0.76 and a touchdown 1.0
 * (`rotor-wash.test.ts` pins it strictly monotone over a landing).
 */
export const ROTOR_WASH_FULL_HEIGHT_WU = 0;
export const ROTOR_WASH_NONE_HEIGHT_WU = 1.5;
export const ROTOR_WASH_SPEED_LOSS = 0.5;
export const ROTOR_WASH_FULL_SPEED_TILES_S = 2.0;
/** Below this strength no puff is spawned at all. */
export const ROTOR_WASH_MIN_STRENGTH = 0.08;
/**
 * Spawn cadence. Above `FRAME_DT_CEILING_MS` (100) by design: the emission
 * accumulator is fed the clamped frame dt, so it can never bank a backlog.
 */
export const ROTOR_WASH_INTERVAL_MS = 200;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Where `heightWu` sits between the curve's full and none heights, 0 at full, 1 at none (the wash radius reads it). */
export function rotorWashHeightNorm(heightWu: number): number {
  return clamp01((heightWu - ROTOR_WASH_FULL_HEIGHT_WU) / (ROTOR_WASH_NONE_HEIGHT_WU - ROTOR_WASH_FULL_HEIGHT_WU));
}

export function rotorWashStrength(heightWu: number, speedTilesS: number): number {
  const h = 1 - rotorWashHeightNorm(heightWu);
  const s = 1 - ROTOR_WASH_SPEED_LOSS * clamp01(speedTilesS / ROTOR_WASH_FULL_SPEED_TILES_S);
  return h * s;
}

/**
 * How fast the dust ring's puffs fly, as a multiple of the emitter's authored speed: a strong wash (a low hover, a
 * touchdown) throws a wider ring, a weak one a tight ring. 1 at full strength, `1 - ROTOR_WASH_PUFF_SPEED_SPREAD` at none.
 * The count and size already follow the strength (`ParticleSystem.spawn`'s magnitude).
 */
export const ROTOR_WASH_PUFF_SPEED_SPREAD = 0.5;
export function rotorWashPuffSpeed(strength: number): number {
  return 1 - ROTOR_WASH_PUFF_SPEED_SPREAD * (1 - clamp01(strength));
}

/**
 * Rotor wash is dated off the SIM clock (GH-391). Emission slot `k` is the
 * instant `k * ROTOR_WASH_INTERVAL_MS` of presentation sim time; a frame
 * emits every slot it has not emitted yet whose puffs could still be alive,
 * each born already as old as sim time says it is, with randomness seeded by
 * (entity, slot). The puffs in a frozen frame are therefore a pure function
 * of sim time -- not of how many frames, of what length, were drawn on the
 * way -- and a zero-time repaint (same sim time) emits nothing.
 */
export function washSlotAt(simMs: number): number {
  return Math.floor(simMs / ROTOR_WASH_INTERVAL_MS);
}

/**
 * The slots one frame must emit: from the first not yet emitted (`lastEmitted`
 * + 1, or -1 for none) to `washSlotAt(simMs)`, but never further back than a
 * puff of `maxLifeMs` could still be alive. Returns `[first, last]`, empty
 * when `first > last`.
 */
export function washSlotsDue(lastEmitted: number, simMs: number, maxLifeMs: number): [number, number] {
  const last = washSlotAt(simMs);
  const reach = Math.max(0, Math.ceil(maxLifeMs / ROTOR_WASH_INTERVAL_MS) - 1);
  return [Math.max(lastEmitted + 1, last - reach), last];
}

/** Seconds a puff of slot `slot` has lived at `simMs`. */
export function washAgeSec(slot: number, simMs: number): number {
  return Math.max(0, simMs - slot * ROTOR_WASH_INTERVAL_MS) / 1000;
}

/** mulberry32 seeded from (entity, slot): pure, no global stream. */
export function washRand(entityId: number, slot: number): () => number {
  let a = (Math.imul(entityId + 1, 0x9e3779b1) ^ Math.imul(slot + 1, 0x85ebca6b)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
