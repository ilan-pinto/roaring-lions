import { fx, ONE, type Fx } from './fixed';

/**
 * Vehicle spacing geometry (GH-421, V-R2): pure, allocation-free capsule maths in Q16.16.
 * A hull is a segment along its facing, centred `centreAlong` ahead of its position, with a
 * radius of its half-width. Nothing here reads a Sim.
 */

/** Writes a hull's capsule into out[o..o+4]: segment ends (x0, y0, x1, y1) and radius. */
export function hullCapsule(px: Fx, py: Fx, facing: Fx, halfLen: Fx, halfWid: Fx, centreAlong: Fx, out: Int32Array, o: number): void {
  const c = fx.cos(facing);
  const s = fx.sin(facing);
  const cx = fx.add(px, fx.mul(c, centreAlong));
  const cy = fx.add(py, fx.mul(s, centreAlong));
  const h = halfLen > halfWid ? fx.sub(halfLen, halfWid) : 0;
  const hx = fx.mul(c, h);
  const hy = fx.mul(s, h);
  out[o] = fx.sub(cx, hx);
  out[o + 1] = fx.sub(cy, hy);
  out[o + 2] = fx.add(cx, hx);
  out[o + 3] = fx.add(cy, hy);
  out[o + 4] = halfWid;
}

const clamp01 = (v: Fx): Fx => (v < 0 ? 0 : v > ONE ? ONE : v);

/** Closest points of two segments (Ericson 5.1.9) into out[0..3]: P on the first, Q on the second. */
export function closestSegmentPoints(cap: Int32Array, a: number, b: number, out: Int32Array): void {
  const p0x = cap[a], p0y = cap[a + 1], q0x = cap[b], q0y = cap[b + 1];
  const d1x = cap[a + 2] - p0x, d1y = cap[a + 3] - p0y;
  const d2x = cap[b + 2] - q0x, d2y = cap[b + 3] - q0y;
  const rx = p0x - q0x, ry = p0y - q0y;
  const aa = fx.mul(d1x, d1x) + fx.mul(d1y, d1y);
  const e = fx.mul(d2x, d2x) + fx.mul(d2y, d2y);
  const f = fx.mul(d2x, rx) + fx.mul(d2y, ry);
  let s = 0;
  let t = 0;
  if (aa === 0 && e === 0) {
    // two points
  } else if (aa === 0) {
    t = clamp01(fx.div(f, e));
  } else {
    const c = fx.mul(d1x, rx) + fx.mul(d1y, ry);
    if (e === 0) {
      s = clamp01(fx.div(-c, aa));
    } else {
      const bb = fx.mul(d1x, d2x) + fx.mul(d1y, d2y);
      const den = fx.mul(aa, e) - fx.mul(bb, bb);
      s = den > 0 ? clamp01(fx.div(fx.mul(bb, f) - fx.mul(c, e), den)) : 0;
      t = fx.div(fx.mul(bb, s) + f, e);
      if (t < 0) {
        t = 0;
        s = clamp01(fx.div(-c, aa));
      } else if (t > ONE) {
        t = ONE;
        s = clamp01(fx.div(bb - c, aa));
      }
    }
  }
  out[0] = p0x + fx.mul(d1x, s);
  out[1] = p0y + fx.mul(d1y, s);
  out[2] = q0x + fx.mul(d2x, t);
  out[3] = q0y + fx.mul(d2y, t);
}

/** Overlap of capsules at offsets a and b (radius sum minus distance; <= 0 is apart), and the unit
 *  normal from B's closest point toward A's into out[0..1] -- (0, 0) when the points coincide. */
export function capsuleOverlap(cap: Int32Array, a: number, b: number, out: Int32Array): Fx {
  closestSegmentPoints(cap, a, b, out);
  const dx = out[0] - out[2];
  const dy = out[1] - out[3];
  const d = fx.sqrt(fx.mul(dx, dx) + fx.mul(dy, dy));
  out[0] = d === 0 ? 0 : fx.div(dx, d);
  out[1] = d === 0 ? 0 : fx.div(dy, d);
  return cap[a + 4] + cap[b + 4] - d;
}

/**
 * GH-1360 §3.3 item 1, the circle fast path: the squared distance (Q16.16 tile², `fx.mul` only) between the
 * closest points of the bodies at offsets a and b. With both bodies points (two circles) there is no division at
 * all; with one a point and the other a segment (a circle against a hull), `closestSegmentPoints` takes its one
 * point-to-segment branch, one `fx.div`. No `fx.sqrt` either way: the callers compare squares.
 */
export function bodyGapSq(cap: Int32Array, a: number, b: number, out: Int32Array): Fx {
  let dx: Fx;
  let dy: Fx;
  if (cap[a] === cap[a + 2] && cap[a + 1] === cap[a + 3] && cap[b] === cap[b + 2] && cap[b + 1] === cap[b + 3]) {
    dx = cap[a] - cap[b];
    dy = cap[a + 1] - cap[b + 1];
  } else {
    closestSegmentPoints(cap, a, b, out);
    dx = out[0] - out[2];
    dy = out[1] - out[3];
  }
  return fx.mul(dx, dx) + fx.mul(dy, dy);
}


/** A circle's body into out[o..o+4], in `hullCapsule`'s layout: a point segment (x, y, x, y) and radius r. It is
 *  what `hullCapsule` writes for a type whose half length is not above its half width and whose centre is on its
 *  origin, without the facing's sine and cosine (GH-1360 §3.3 item 1). */
export function pointBody(x: Fx, y: Fx, r: Fx, out: Int32Array, o: number): void {
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = x;
  out[o + 3] = y;
  out[o + 4] = r;
}
