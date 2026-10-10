/**
 * Main-rotor spin phase as a pure function of SIM time (GH-391).
 *
 * It used to be an accumulator fed the clamped frame delta, so the blade
 * angle in a frozen frame was the sum of every wall-clock frame since boot:
 * two captures of one commit photographed the rotor at different angles,
 * which is what put the visual gate's `vehicle` scenario (a parked
 * `heli_peten` in shot) at 100-316 px against a 300 px budget on CI.
 * Presentation only; nothing here is read back by the sim.
 */
const TWO_PI = Math.PI * 2;

/** Phase in [0, 2*PI) after `simMs` of sim time at `radPerSec`. */
export function rotorSpinPhase(simMs: number, radPerSec: number): number {
  const p = (radPerSec * simMs / 1000) % TWO_PI;
  return p < 0 ? p + TWO_PI : p;
}
