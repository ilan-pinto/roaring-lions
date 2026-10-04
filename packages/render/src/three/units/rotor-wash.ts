/**
 * Rotor wash: the dust ring a helicopter or low drone throws onto the ground
 * beneath it. Presentation only -- every input is a number the renderer
 * already measured, and nothing here touches `Sim`.
 *
 * Strength is `heightFactor * speedFactor`, 0..1:
 *  - HEIGHT: full at or below `ROTOR_WASH_FULL_HEIGHT_WU` above the drawn
 *    ground, falling linearly to nothing at `ROTOR_WASH_NONE_HEIGHT_WU`.
 *    A high aircraft throws no dust.
 *  - SPEED: hovering is strongest. Forward flight carries the downwash aft
 *    and thins the ring, so full speed keeps `1 - ROTOR_WASH_SPEED_LOSS`.
 *
 * Note the renderer today draws every air unit at one constant lift
 * (`AIR_LIFT_PX`, about 0.36 wu), so height is a constant until altitude
 * varies; the curve already reads the DRAWN height, so it needs no change.
 */
export const ROTOR_WASH_FULL_HEIGHT_WU = 0.6;
export const ROTOR_WASH_NONE_HEIGHT_WU = 3.0;
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

export function rotorWashStrength(heightWu: number, speedTilesS: number): number {
  const h = clamp01(
    1 - (heightWu - ROTOR_WASH_FULL_HEIGHT_WU) / (ROTOR_WASH_NONE_HEIGHT_WU - ROTOR_WASH_FULL_HEIGHT_WU)
  );
  const s = 1 - ROTOR_WASH_SPEED_LOSS * clamp01(speedTilesS / ROTOR_WASH_FULL_SPEED_TILES_S);
  return h * s;
}
