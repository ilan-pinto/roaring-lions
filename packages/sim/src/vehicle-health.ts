import { fx, ONE, type Fx } from './fixed';
import { OVERMATCH_SHIFT_PER_Z, OVERMATCH_SHIFT_MAX, PEN_HP_FLOOR, PEN_HP_OVERMATCH_DIV } from './tuning';

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
 * What a penetration costs a hard hull, Q16.16: max(damage, floor(maxHp * PEN_HP_FLOOR) * (DIV + shift) / DIV).
 * Integer arithmetic in exactly this order (plan Ruling 2): the Q16 product first, then the
 * overmatch scale as `((a * b) / c) | 0` (the form `swarmDive` uses). The product is exact in a
 * double, and the result fits int32 for any Fx maxHp: the scale is at most 1.5 and the floor is
 * 0.34 of maxHp, so the cost is at most 0.51 of an int32 hp.
 */
export function penetrationHpCost(maxHp: Fx, damage: Fx, shift: number): Fx {
  let floor = fx.mul(maxHp, PEN_HP_FLOOR);
  floor = ((floor * (PEN_HP_OVERMATCH_DIV + shift)) / PEN_HP_OVERMATCH_DIV) | 0;
  return floor > damage ? floor : damage;
}
