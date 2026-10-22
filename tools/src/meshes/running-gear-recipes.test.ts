/**
 * The recipes against the design doc's own table, as LITERALS.
 *
 * `running-gear-recipes.ts` is what the pass reads, so a wrong number there
 * would agree with itself everywhere downstream: the pass tags the wrong
 * faces, the extras declare the wrong radius, and the runtime turns the wheel
 * at the wrong rate, all consistently. This file is the one oracle that does
 * not import its answer from the code under test: the numbers below are
 * copied from `docs/superpowers/specs/2026-10-12-wheels-and-tracks-design.md`
 * §1 (front axle first), and a recipe more than 2 cm off them is red.
 */
import { describe, expect, it } from 'vitest';
import { RUNNING_GEAR_RECIPES } from './running-gear-recipes';
import { RG_SPIN_VEHICLES, RG_STEER_VEHICLES, RG_TRACK_VEHICLES } from './running-gear-contract';

/** id -> [axle x front to back, axle y, radius], per the doc's table. */
const DOC: Record<string, { x: number[]; y: number; r: number }> = {
  jeep_shoded: { x: [1.64, -1.27], y: 0.43, r: 0.43 },
  scout_shachaf: { x: [1.41, -1.4], y: 0.537, r: 0.536 },
  apc_kipod: { x: [2.3, 0.17, -1.96], y: 0.75, r: 0.755 },
  apc_eitan: { x: [2.29, 0.72, -0.74, -2.14], y: 0.66, r: 0.66 },
  technical: { x: [1.69, -1.19], y: 0.307, r: 0.316 },
  gun_truck: { x: [1.77, -1.47], y: 0.415, r: 0.425 },
  rocket_battery: { x: [1.96, -0.9, -1.79], y: 0.48, r: 0.48 },
  ifv_namer: { x: [2.86, 1.67, 0.56, -0.56, -1.67, -2.85], y: 0.54, r: 0.49 },
  // GH-709: measured on the shipped `hull_rubber` (circle fit to each rim).
  spg_long_range: { x: [2.375, 1.49, 0.555, -0.31, -1.16, -2.02], y: 0.39, r: 0.34 },
};
const TOL = 0.02;

describe('running-gear recipes against the design doc', () => {
  for (const [id, want] of Object.entries(DOC)) {
    it(`${id}: axles and radii within 2 cm of the doc`, () => {
      const recipe = RUNNING_GEAR_RECIPES[id];
      expect(recipe).toBeDefined();
      for (const side of ['r', 'l'] as const) {
        const wheels = recipe.wheels.filter((w) => w.side === side);
        expect(wheels.map((w) => w.x).length).toBe(want.x.length);
        wheels.forEach((w, i) => {
          expect(Math.abs(w.x - want.x[i])).toBeLessThanOrEqual(TOL);
          expect(Math.abs(w.y - want.y)).toBeLessThanOrEqual(TOL);
          expect(Math.abs(w.r - want.r)).toBeLessThanOrEqual(TOL);
        });
      }
    });
  }

  it('covers exactly the approved lists (A1, A2, A9)', () => {
    const spin = Object.keys(RUNNING_GEAR_RECIPES).filter((id) => RUNNING_GEAR_RECIPES[id].wheels.length > 0).sort();
    const track = Object.keys(RUNNING_GEAR_RECIPES).filter((id) => RUNNING_GEAR_RECIPES[id].track).sort();
    const steer = Object.keys(RUNNING_GEAR_RECIPES).filter((id) => RUNNING_GEAR_RECIPES[id].wheels.some((w) => w.steer)).sort();
    expect(spin).toEqual([...RG_SPIN_VEHICLES].sort());
    expect(track).toEqual([...RG_TRACK_VEHICLES].sort());
    expect(steer).toEqual([...RG_STEER_VEHICLES].sort());
    // A3/A4: the Lavi's and the D9's road wheels do not spin.
    expect(RUNNING_GEAR_RECIPES.mbt_lavi.wheels).toEqual([]);
    expect(RUNNING_GEAR_RECIPES.dozer_d9.wheels).toEqual([]);
    // A5: the Tzav waits for E6.
    expect(RUNNING_GEAR_RECIPES.demo_tzav).toBeUndefined();
  });

  it('steers the front axle only', () => {
    for (const id of RG_STEER_VEHICLES) {
      for (const side of ['r', 'l'] as const) {
        const wheels = RUNNING_GEAR_RECIPES[id].wheels.filter((w) => w.side === side);
        expect(wheels.map((w) => w.steer === true)).toEqual(wheels.map((_, i) => i === 0));
      }
    }
  });
});
