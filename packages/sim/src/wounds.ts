// GH-707 (wounded and rescue): pure helpers with no Sim state. Integer and Q16.16 only
// (invariant 2): no Math.*, no float literals.

import type { Fx } from './fixed';

/**
 * Men of a `figures`-strong team still standing at `hp` of `typeHp`: one man per
 * `typeHp / figures` share, rounded UP, so a team loses a man only when its hp crosses a
 * share boundary -- `ceil(hp x figures / typeHp)`, clamped to `[0, figures]`.
 *
 * Integer arithmetic on the raw Q16.16 words: the scale cancels, and `hp x figures` stays
 * far inside a double's exact range (2^31 x 8 < 2^53), so the division is exact.
 */
export function figuresStanding(hp: Fx, typeHp: Fx, figures: number): number {
  if (hp <= 0 || typeHp <= 0) return 0;
  const n = hp * figures;
  const r = n % typeHp;
  let q = (n - r) / typeHp;
  if (r > 0) q++;
  return q > figures ? figures : q;
}

/** `a x num / den` truncated, for non-negative integers (the regen ceiling's share). */
export function scaleDown(a: number, num: number, den: number): number {
  const n = a * num;
  return (n - (n % den)) / den;
}
