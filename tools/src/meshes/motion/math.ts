/**
 * The handful of vector and quaternion operations the motion pass needs, as
 * plain tuples. Tools do not depend on three.js (`mesh_gait.ts` hand-rolls
 * its own matrices for the same reason), and a pass that rewrites shipped
 * GLBs should not pull a renderer in to do arithmetic.
 *
 * Conventions: glTF's -- quaternions are `[x, y, z, w]`, +Y is up, a figure
 * faces +X, and +Z is the figure's anatomical RIGHT (Blender's -Y).
 */
export type V3 = [number, number, number];
export type Q = [number, number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));

export const QI: Q = [0, 0, 0, 1];

export function qmul(a: Q, b: Q): Q {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const qconj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];

export function qnorm(q: Q): Q {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

export function qrot(q: Q, v: V3): V3 {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q));
  return [p[0], p[1], p[2]];
}

export function qaxis(axis: V3, rad: number): Q {
  const a = norm(axis);
  const s = Math.sin(rad / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(rad / 2)];
}

/** The shortest rotation taking direction `a` onto direction `b`. */
export function qfromTo(a: V3, b: V3): Q {
  const u = norm(a);
  const v = norm(b);
  const d = dot(u, v);
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], u);
    if (len(axis) < 1e-6) axis = cross([0, 1, 0], u);
    return qaxis(axis, Math.PI);
  }
  const c = cross(u, v);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}

export function qslerp(a: Q, b: Q, t: number): Q {
  let [bx, by, bz, bw] = b;
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (d > 0.9995) {
    return qnorm([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  }
  const th = Math.acos(Math.min(1, d));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** Rotation angle of a unit quaternion, radians, in [0, pi]. */
export function qangle(q: Q): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q[3])));
}

/**
 * The rotation whose local +X is `fwd` and whose local +Y is as close to
 * `up` as `fwd` allows -- a weapon's frame from its bore and the sky.
 */
export function qbasis(fwd: V3, up: V3): Q {
  const x = norm(fwd);
  const z = norm(cross(x, up));
  const y = cross(z, x);
  // Rotation matrix columns x, y, z -> quaternion.
  const m00 = x[0], m10 = x[1], m20 = x[2];
  const m01 = y[0], m11 = y[1], m21 = y[2];
  const m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qnorm(q);
}

/** A rigid transform with uniform scale. Bones in these rigs carry none. */
export interface Xf {
  readonly t: V3;
  readonly r: Q;
  readonly s: number;
}

export const XI: Xf = { t: [0, 0, 0], r: QI, s: 1 };

export function compose(parent: Xf, local: Xf): Xf {
  return {
    t: add(parent.t, qrot(parent.r, scale(local.t, parent.s))),
    r: qnorm(qmul(parent.r, local.r)),
    s: parent.s * local.s,
  };
}

export function invert(x: Xf): Xf {
  const ri = qconj(x.r);
  const si = 1 / x.s;
  return { t: scale(qrot(ri, x.t), -si), r: ri, s: si };
}

export const apply = (x: Xf, p: V3): V3 => add(x.t, qrot(x.r, scale(p, x.s)));

/** Column-major 4x4 of a transform (glTF's inverse-bind-matrix layout). */
export function toMat4(x: Xf): number[] {
  const [qx, qy, qz, qw] = x.r;
  const s = x.s;
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * s, 2 * (xy + wz) * s, 2 * (xz - wy) * s, 0,
    2 * (xy - wz) * s, (1 - 2 * (xx + zz)) * s, 2 * (yz + wx) * s, 0,
    2 * (xz + wy) * s, 2 * (yz - wx) * s, (1 - 2 * (xx + yy)) * s, 0,
    x.t[0], x.t[1], x.t[2], 1,
  ];
}

export const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export const deg = (d: number): number => (d * Math.PI) / 180;
