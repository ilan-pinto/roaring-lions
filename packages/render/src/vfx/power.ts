import { fx, type WeaponStats } from '@lions/sim';

/**
 * How big an event a shot is, 0..1 — the magnitude knob behind every
 * weapon-fire effect.
 *
 * The blend is deliberate. Penetration alone ranks by armour defeat, which
 * gets indirect fire backwards: a 60mm mortar (penetration 30) would sit
 * below a coaxial MG (penetration 20) despite being far the louder event.
 * Splash and suppression carry the weight mortars actually have.
 */
const SPLASH_WEIGHT = 300;
/** 2 x raw suppression. WeaponStats carries suppPerMiss, which the sim has
 *  already divided by SUPP_STAT_DIVISOR (700); that constant is not exported,
 *  so it is folded in here: 2 * 700. */
const SUPP_WEIGHT = 1400;

/** Roster extremes: carbines sit at 100, a 120mm APFSDS at 1900. Fixed rather
 *  than derived, so adding one large gun cannot silently resize every
 *  existing effect. Anything outside clamps. */
const WEIGHT_MIN = 100;
const WEIGHT_MAX = 1900;
const LOG_MIN = Math.log(WEIGHT_MIN);
const LOG_SPAN = Math.log(WEIGHT_MAX) - LOG_MIN;

export function firePower(w: WeaponStats): number {
  const weight =
    fx.toNumber(w.penetration) +
    fx.toNumber(w.damage) +
    SPLASH_WEIGHT * fx.toNumber(w.splash) +
    SUPP_WEIGHT * fx.toNumber(w.suppPerMiss);
  if (weight <= WEIGHT_MIN) return 0;
  // Log-compressed: raw weight spans roughly nineteenfold across the roster.
  const p = (Math.log(weight) - LOG_MIN) / LOG_SPAN;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
