import { fx, ONE, type Fx } from './fixed';
import { OVERMATCH_SHIFT_PER_Z, OVERMATCH_SHIFT_MAX, PEN_HP_FLOOR, PEN_HP_OVERMATCH_DIV, PEN_HP_REF_DAMAGE } from './tuning';

/**
 * Vehicle health (GH-560): what a penetration costs a hard hull, and how far overmatch tilts the
 * component table. Pure integer functions over Q16.16; nothing here reads a Sim, draws a number
 * or allocates.
 */

/** The overmatch shift, clamp((z - 1) * OVERMATCH_SHIFT_PER_Z, 0, OVERMATCH_SHIFT_MAX): an integer
 *  0..30. The one copy: `rollComponent` and `penetrationHpCost`'s caller both read it. */
export function overmatchShift(z: Fx): number {
  const shift = fx.toInt(fx.mul(fx.max(fx.sub(z, ONE), 0), fx.fromInt(OVERMATCH_SHIFT_PER_Z)));
  return shift > OVERMATCH_SHIFT_MAX ? OVERMATCH_SHIFT_MAX : shift;
}

/**
 * What a penetration costs a hard hull, Q16.16:
 *   max(damage, floor(maxHp * PEN_HP_FLOOR) * (DIV + shift) / DIV * min(damage, R) / R),  R = PEN_HP_REF_DAMAGE.
 * Integer arithmetic in exactly this order (plan Ruling 2): the Q16 product first, then the
 * overmatch scale as `((a * b) / c) | 0` (the form `swarmDive` uses), then (GH-868) the damage
 * scale in the same form, applied only below R so a round of R or more pays the whole floor.
 * Every product is exact in a double: the overmatch product is at most 0.34 * 2^31 * 90, and the
 * damage product at most 1.1e9 * R (about 6.1e15, below 2^53). The result fits int32 for any Fx
 * maxHp: the scale is at most 1.5 and the floor is 0.34 of maxHp, so the cost is at most 0.51 of
 * an int32 hp. A penetrating weapon of damage 0 therefore costs 0 (the floor scales to nothing);
 * no shipped one exists (spg_cluster's carrier bursts before it reaches this path).
 */
export function penetrationHpCost(maxHp: Fx, damage: Fx, shift: number): Fx {
  let floor = fx.mul(maxHp, PEN_HP_FLOOR);
  floor = ((floor * (PEN_HP_OVERMATCH_DIV + shift)) / PEN_HP_OVERMATCH_DIV) | 0;
  if (damage < PEN_HP_REF_DAMAGE) floor = ((floor * damage) / PEN_HP_REF_DAMAGE) | 0;
  return floor > damage ? floor : damage;
}
