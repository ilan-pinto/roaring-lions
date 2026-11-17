/**
 * GH-1167 S2: the 3D grass blade, the clump and its three LODs. Headless: plain typed arrays, no three.js, no drawing.
 * Design: docs/superpowers/specs/2026-11-11-wadi-halam-3d-grass-design.md, section 2.1 (the lead-approved numbers).
 *
 * UNITS are tiles, in the clump's local frame: y up, root at y 0, the clump centred on the origin. The field (S4)
 * places a clump by its instance matrix; nothing here knows a world position.
 *
 * Every LOD of a variant draws the SAME blades, only coarser: LOD1 and LOD2 are prefixes of one per-blade priority
 * order, and a kept blade has identical root, lean, curve and tip, so nothing jumps at a switch.
 */
import { tileHash } from "../../tile-hash";
import { NATURE_ATTRIBUTE } from "./decor-mesh";
import { hexToLinear } from "./shared";
import { WIND_CLASS_GRASS } from "./wind";

export { NATURE_ATTRIBUTE };

/**
 * GH-1167 S4: the per-vertex width record the node material's flutter and width floor read (`grass-sway.ts`): x, z the blade's
 * width axis at that ring (unit, clump-local xz), w0 the vertex's signed half width (-half, +half; 0 on the tip), w1 the blade's
 * half width at its root for this LOD.
 */
export const GRASS_WIDTH_ATTRIBUTE = "rlGrassWidth";

/** Blades per clump variant (design 2.1: 12, 16 and 20). */
export const GRASS_BLADES: readonly [number, number, number] = [12, 16, 20];
/** Blades kept at LOD1 (5 triangles each: 40 / 50 / 60) and at LOD2 (1 triangle each: 5 / 6 / 7). */
export const GRASS_LOD1_BLADES: readonly [number, number, number] = [8, 10, 12];
export const GRASS_LOD2_BLADES: readonly [number, number, number] = [5, 6, 7];
/** Segments per blade at LOD0 and LOD1 (7 and 5 triangles). LOD2 is one triangle. */
export const GRASS_LOD0_SEGMENTS = 4;
export const GRASS_LOD1_SEGMENTS = 3;

export const GRASS_BLADE_BASE_WIDTH = 0.012;
export const GRASS_LOD2_BASE_WIDTH = 0.018;
export const GRASS_HEIGHT_MIN = 0.065;
export const GRASS_HEIGHT_MAX = 0.16;
/** N-4, raised from 0.12 by the lead on 13 Nov: no tip passes this after the clump's scale. */
export const GRASS_TIP_CAP = 0.16;
export const GRASS_SCALE_MIN = 0.85;
export const GRASS_SCALE_MAX = 1.15;
/** Clump footprint radius (0.17 tile across). */
export const GRASS_CLUMP_RADIUS = 0.085;
export const GRASS_LEAN_MIN_DEG = 10;
export const GRASS_LEAN_MAX_DEG = 35;
export const GRASS_TWIST_DEG = 20;
export const GRASS_CURVE_MIN = 0.25;
export const GRASS_CURVE_MAX = 0.4;
/** Share of the normal bent toward the clump's up-and-out. */
export const GRASS_NORMAL_BEND = 0.7;
export const GRASS_STRAW_SHARE = 0.08;
/** Tip colour shares of ALL blades: grass.3, grass.2, grass.1, then straw (the rest). */
export const GRASS_TIP_SHARES: readonly [number, number, number, number] = [
  0.45,
  0.35,
  0.12,
  GRASS_STRAW_SHARE,
];
/** Root shading: 0.65 at the root, 1.0 from 40% of the clump's height up. A light value, not a colour key. */
export const GRASS_ROOT_OCCLUSION = 0.65;
export const GRASS_ROOT_OCCLUSION_TOP = 0.4;

/** The palette keys, resolved to hex by the caller (`paletteColor`); this file names no hex. */
export interface GrassColours {
  readonly root: string; // grass.4
  readonly tip3: string; // grass.3
  readonly tip2: string; // grass.2
  readonly tip1: string; // grass.1
  readonly strawRoot: string; // dust.3
  readonly strawTip: string; // limestone.3
}

export type GrassVariant = 0 | 1 | 2;
export type GrassLod = 0 | 1 | 2;

export interface GrassGeometry {
  /** xyz per vertex, tiles. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** `rlNature`: x = height in the clump's box (0..1), y = `WIND_CLASS_GRASS`, z = per-blade phase in turns [0, 1). */
  readonly nature: Float32Array;
  /** LINEAR rgb per vertex (`hexToLinear`), the root occlusion already multiplied in. */
  readonly colors: Float32Array;
  /** `GRASS_WIDTH_ATTRIBUTE`, four floats per vertex: width axis x, z, signed half width, root half width (tiles). */
  readonly width: Float32Array;
  readonly indices: Uint16Array;
  readonly blades: number;
  readonly triangles: number;
}

export interface GrassBladeSpec {
  readonly root: readonly [number, number];
  readonly height: number;
  readonly leanRad: number;
  /** Azimuth the blade leans and curves toward (radians, in the xz plane). */
  readonly azimuth: number;
  readonly curve: number;
  readonly twistRad: number;
  readonly phase: number;
  readonly straw: boolean;
  /** 0..2 = grass.3 / grass.2 / grass.1; 3 = straw. */
  readonly tipClass: 0 | 1 | 2 | 3;
  readonly priority: number;
}

const SALT = 90113; // no other family hashes with this
const rnd = (variant: number, i: number, k: number): number =>
  tileHash(variant * 977 + i + SALT, k * 61 + SALT);

/** Position of the blade's axis at parameter t (0 root, 1 tip), clump-local tiles. */
function axisPoint(b: GrassBladeSpec, t: number): [number, number, number] {
  const dx = Math.cos(b.azimuth);
  const dz = Math.sin(b.azimuth);
  const out = Math.sin(b.leanRad) * b.height * t + b.curve * b.height * t * t;
  return [
    b.root[0] + dx * out,
    Math.cos(b.leanRad) * b.height * t,
    b.root[1] + dz * out,
  ];
}

/** The blades of one variant, in PRIORITY order (index 0 is the last to be dropped). */
export function grassBlades(variant: GrassVariant): GrassBladeSpec[] {
  const n = GRASS_BLADES[variant];
  const strawN = Math.round(n * GRASS_STRAW_SHARE);
  // Tip classes by largest quota across all blades, handed out in hash order (deterministic, exact shares).
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => rnd(variant, a, 7) - rnd(variant, b, 7) || a - b,
  );
  const quota = [0, 0, 0];
  let left = n - strawN;
  const shares = [0.45, 0.35, 0.12];
  const shareSum = shares[0] + shares[1] + shares[2];
  const frac: number[] = [];
  for (let c = 0; c < 3; c++) {
    const exact = (shares[c] / shareSum) * (n - strawN);
    quota[c] = Math.floor(exact);
    frac.push(exact - quota[c]);
    left -= quota[c];
  }
  while (left > 0) {
    let best = 0;
    for (let c = 1; c < 3; c++) if (frac[c] > frac[best]) best = c;
    quota[best]++;
    frac[best] = -1;
    left--;
  }
  const tipClass: (0 | 1 | 2 | 3)[] = new Array(n);
  let at = 0;
  for (let c = 0; c < 3; c++)
    for (let q = 0; q < quota[c]; q++) tipClass[order[at++]] = c as 0 | 1 | 2;
  for (; at < n; at++) tipClass[order[at]] = 3;

  const out: GrassBladeSpec[] = [];
  for (let i = 0; i < n; i++) {
    const rho = Math.sqrt((i + 0.5) / n); // 0 heart .. 1 rim, area-even
    const azimuth = i * 2.399963229728653 + (rnd(variant, i, 1) - 0.5) * 0.6; // golden angle
    const r = rho * GRASS_CLUMP_RADIUS * 0.9;
    const straw = tipClass[i] === 3;
    // Tall at the heart, short at the rim; straw is a dead, shorter, leaning blade.
    let height =
      GRASS_HEIGHT_MAX -
      (GRASS_HEIGHT_MAX - GRASS_HEIGHT_MIN) *
        rho *
        (0.75 + 0.25 * rnd(variant, i, 2));
    if (straw) height *= 0.85;
    height = Math.min(GRASS_HEIGHT_MAX, Math.max(GRASS_HEIGHT_MIN, height));
    const leanDeg = Math.min(
      GRASS_LEAN_MAX_DEG,
      Math.max(
        GRASS_LEAN_MIN_DEG,
        GRASS_LEAN_MIN_DEG +
          (GRASS_LEAN_MAX_DEG - GRASS_LEAN_MIN_DEG) *
            (0.3 + 0.7 * rho) *
            (0.7 + 0.3 * rnd(variant, i, 3)),
      ),
    );
    // The blade leans out from the clump's centre: its own azimuth is the radial one, jittered a little.
    const radial = Math.atan2(Math.sin(azimuth), Math.cos(azimuth));
    out.push({
      root: [Math.cos(azimuth) * r, Math.sin(azimuth) * r],
      height,
      leanRad: (leanDeg * Math.PI) / 180,
      azimuth: radial + (rnd(variant, i, 4) - 0.5) * 0.5,
      curve:
        GRASS_CURVE_MIN +
        (GRASS_CURVE_MAX - GRASS_CURVE_MIN) * rnd(variant, i, 5),
      twistRad:
        ((rnd(variant, i, 6) * 2 - 1) * GRASS_TWIST_DEG * Math.PI) / 180,
      phase: rnd(variant, i, 8),
      straw,
      tipClass: tipClass[i],
      priority:
        0.6 *
          ((height - GRASS_HEIGHT_MIN) /
            (GRASS_HEIGHT_MAX - GRASS_HEIGHT_MIN)) +
        0.4 * rnd(variant, i, 9),
    });
  }
  // Priority order. Ties break on the original index so the order is a pure function of the variant.
  return out
    .map((b, i) => ({ b, i }))
    .sort((a, b) => b.b.priority - a.b.priority || a.i - b.i)
    .map((e) => e.b);
}

/** Highest tip y over the LOD0 blades of a variant, at clump scale 1 (also the `rlNature` box top). */
export function grassBoxTop(variant: GrassVariant): number {
  let top = 0;
  for (const b of grassBlades(variant)) top = Math.max(top, axisPoint(b, 1)[1]);
  return top;
}

/** A clump's scale, clamped so that no tip passes `GRASS_TIP_CAP` of a tile (N-4). */
export function clampGrassScale(variant: GrassVariant, scale: number): number {
  return Math.min(
    Math.max(scale, GRASS_SCALE_MIN),
    GRASS_SCALE_MAX,
    GRASS_TIP_CAP / grassBoxTop(variant),
  );
}

export function grassRootOcclusion(heightN: number): number {
  const k = Math.min(1, Math.max(0, heightN / GRASS_ROOT_OCCLUSION_TOP));
  return GRASS_ROOT_OCCLUSION + (1 - GRASS_ROOT_OCCLUSION) * k;
}

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Builds one variant at one LOD. Pure and deterministic. */
export function buildGrassClump(
  variant: GrassVariant,
  lod: GrassLod,
  colours: GrassColours,
): GrassGeometry {
  const all = grassBlades(variant);
  const count =
    lod === 0
      ? all.length
      : lod === 1
        ? GRASS_LOD1_BLADES[variant]
        : GRASS_LOD2_BLADES[variant];
  const blades = all.slice(0, count);
  const segs = lod === 0 ? GRASS_LOD0_SEGMENTS : GRASS_LOD1_SEGMENTS;
  const boxTop = grassBoxTop(variant);
  const rootC = hexToLinear(colours.root);
  const tipC = [
    hexToLinear(colours.tip3),
    hexToLinear(colours.tip2),
    hexToLinear(colours.tip1),
    hexToLinear(colours.strawTip),
  ];
  const strawRootC = hexToLinear(colours.strawRoot);

  const pos: number[] = [];
  const nor: number[] = [];
  const nat: number[] = [];
  const col: number[] = [];
  const wid: number[] = [];
  const idx: number[] = [];

  for (const b of blades) {
    const base = pos.length / 3;
    const r0 = b.straw ? strawRootC : rootC;
    const t0 = tipC[b.tipClass];
    const baseW = lod === 2 ? GRASS_LOD2_BASE_WIDTH : GRASS_BLADE_BASE_WIDTH;
    const push = (
      p: [number, number, number],
      n: [number, number, number],
      t: number,
      signedHalf: number,
    ): void => {
      pos.push(p[0], p[1], p[2]);
      const th = b.azimuth + Math.PI / 2 + b.twistRad * t;
      wid.push(Math.cos(th), Math.sin(th), signedHalf, baseW / 2);
      nor.push(n[0], n[1], n[2]);
      const hN = p[1] / boxTop;
      nat.push(hN, WIND_CLASS_GRASS, b.phase);
      const occ = grassRootOcclusion(hN);
      for (let c = 0; c < 3; c++) col.push((r0[c] + (t0[c] - r0[c]) * t) * occ);
    };
    // The normal: geometric (across the width axis and the blade), bent 70% to the clump's up-and-out.
    const upOut = norm([
      Math.cos(b.azimuth) * 0.7,
      1,
      Math.sin(b.azimuth) * 0.7,
    ]);
    const normalAt = (t: number): [number, number, number] => {
      const a = axisPoint(b, Math.max(0, t - 0.01));
      const c = axisPoint(b, Math.min(1, t + 0.01));
      const tan = norm([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
      const th = b.azimuth + Math.PI / 2 + b.twistRad * t;
      const w: [number, number, number] = [Math.cos(th), 0, Math.sin(th)];
      let g = norm([
        tan[1] * w[2] - tan[2] * w[1],
        tan[2] * w[0] - tan[0] * w[2],
        tan[0] * w[1] - tan[1] * w[0],
      ]);
      if (g[0] * Math.cos(b.azimuth) + g[2] * Math.sin(b.azimuth) < 0)
        g = [-g[0], -g[1], -g[2]];
      return norm([
        g[0] + (upOut[0] - g[0]) * GRASS_NORMAL_BEND,
        g[1] + (upOut[1] - g[1]) * GRASS_NORMAL_BEND,
        g[2] + (upOut[2] - g[2]) * GRASS_NORMAL_BEND,
      ]);
    };
    const ring = (t: number): void => {
      const p = axisPoint(b, t);
      const half = (baseW * (1 - t)) / 2;
      const th = b.azimuth + Math.PI / 2 + b.twistRad * t;
      const n = normalAt(t);
      push(
        [p[0] - Math.cos(th) * half, p[1], p[2] - Math.sin(th) * half],
        n,
        t,
        -half,
      );
      push(
        [p[0] + Math.cos(th) * half, p[1], p[2] + Math.sin(th) * half],
        n,
        t,
        half,
      );
    };
    if (lod === 2) {
      ring(0);
      push(axisPoint(b, 1), normalAt(1), 1, 0);
      idx.push(base, base + 1, base + 2);
      continue;
    }
    for (let s = 0; s < segs; s++) ring(s / segs);
    push(axisPoint(b, 1), normalAt(1), 1, 0);
    for (let s = 0; s < segs - 1; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const last = base + (segs - 1) * 2;
    idx.push(last, last + 1, last + 2);
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    nature: new Float32Array(nat),
    colors: new Float32Array(col),
    width: new Float32Array(wid),
    indices: new Uint16Array(idx),
    blades: blades.length,
    triangles: idx.length / 3,
  };
}
