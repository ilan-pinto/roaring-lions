import { fx, type Fx } from '@lions/sim';

/** The facing of a hostile placed at (hx, hy) looking at the friendly anchor
 *  (fx, fy): Q16.16 turns in [0, ONE), through the sim's own LUT atan2 so a
 *  Firefox and a Chrome boot agree to the bit (network design §7.4 item 5).
 *  The old float atan2 over 2 pi is not IEEE-reproducible across engines;
 *  `fx.atan2` takes raw integers (tile coordinates, keep them integers: it is
 *  exact only for integer inputs) and the scale cancels. */
export function hostileFacing(fxA: number, fyA: number, hxA: number, hyA: number): Fx {
  return fx.atan2(fyA - hyA, fxA - hxA);
}
