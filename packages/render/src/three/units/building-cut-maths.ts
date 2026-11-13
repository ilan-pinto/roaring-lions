/**
 * GH-1225 slice 3 (decision L7, "one twin, one hook"): the fragment maths of a clone-drawn building that is holed (GH-1197 P4)
 * and/or cut (the roof cutaway), written ONCE against `Ops<T>` / `IntOps<T>`, for the TSL twin (`building-cut.node.ts`) to run
 * on nodes and the specs to run on numbers. The legacy GLSL (`HOLES_PARS_GLSL`, `CUT_PARS_GLSL` and their colour splices) keeps
 * its own text, unchanged; this is that text line for line, in the order the hooks compose on a clone both holed and cut:
 *
 * - **Discard** where any live volume cuts (`cutawayOps`, `building-cutaway.ts`) OR any live hole's cylinder holds the fragment.
 *   `keep` is 0 there, 1 elsewhere: the twin's `maskNode`, which r186 also applies in the shadow pass (one mask, three draws).
 * - **Colour**, after the base colour is known: the cut splice FIRST (a back face is the cut interior, a front face in the section
 *   band is the cap), then the holes splice over it (a back face is the holes' interior, a front face takes the edge tint). That
 *   is the legacy order: the cut hook wraps the holed clone and splices right after `#include <map_fragment>`, ahead of the holes'.
 *
 * The GLSL's per-volume and per-hole skips (`break` at `uRlCutN` / `uRlHoleN`, a hole's `continue` outside its depth) are a
 * `Flow<T>.when`: on numbers a plain branch (`NUMBER_FLOW`), on nodes a TSL `If` over variables (`building-cut.node.ts`), so the
 * GPU skips a dead volume or hole exactly as the GLSL does instead of evaluating all of them. Every finer branch is a select on 0/1
 * floats, and the holes' running tint is threaded through in the GLSL's order, so a later crack, lip or halo wins exactly where
 * the GLSL's `if (... > rlHoleTint.a)` lets it.
 *
 * Import-free but for the constants and the `Ops` types. Presentation only: nothing here is read by the sim.
 */
import type { IntOps, Ops } from '../fog-ops';
import { tileHashOps } from '../../tile-hash';
import { CUT_FLOATS_PER_VOLUME, CUT_VOLUME_CAP, cutawayOps } from './building-cutaway';
import {
  HOLE_CAP,
  HOLE_CRACK_ALPHA,
  HOLE_CRACK_LEN,
  HOLE_CRACK_ROOT_RAD,
  HOLE_CRACKS,
  HOLE_DEPTH_TILES,
  HOLE_EDGE_AMP,
  HOLE_EDGE_BASE,
  HOLE_EDGE_CELLS,
  HOLE_EDGE_OCTAVES,
  HOLE_HALO_ALPHA,
  HOLE_HALO_TILES,
  HOLE_LIP_TILES,
  HOLE_SALT_CRACK_ANGLE,
  HOLE_SALT_CRACK_LEN,
} from './building-holes';

type V3<T> = readonly [T, T, T];
type V4<T> = readonly [T, T, T, T];

/** The cut's inputs: the shared volume block (`CUT_VOLUME_CAP * CUT_FLOATS_PER_VOLUME` floats, `uRlCutV` as the legacy hook lays
 *  it out: (cx, cz, r, w) then (yCut, yTop, j, 0) a volume), the live count `uRlCutN`, and the building's two colours. */
export interface CutInput<T> {
  readonly v: readonly T[];
  readonly n: T;
  readonly cap: V3<T>;
  readonly interior: V3<T>;
}

/** The holes' inputs: `HOLE_CAP` (centre + radius) and (axis + seed) pairs (`uRlHoleC`, `uRlHoleA`), the live count `uRlHoleN`,
 *  and the edge and interior colours. */
export interface HolesInput<T> {
  readonly c: readonly V4<T>[];
  readonly a: readonly V4<T>[];
  readonly n: T;
  readonly lip: V3<T>;
  readonly halo: V3<T>;
  readonly crack: V3<T>;
  readonly interior: V3<T>;
}

export interface BuildingFragmentInput<T> {
  /** The fragment's WORLD position (the legacy `vRlCutW` / `vRlHoleW`). */
  readonly p: V3<T>;
  /** 1 on a front face, 0 on a back face (`gl_FrontFacing`). */
  readonly front: T;
  /** The base colour after the map (`diffuseColor.rgb` at `#include <map_fragment>`). */
  readonly base: V3<T>;
  /** Null when the clone carries no `rl-cut`. */
  readonly cut: CutInput<T> | null;
  /** Null when the clone carries no `rl-holes`. */
  readonly holes: HolesInput<T> | null;
}

export interface BuildingFragment<T> {
  /** 1 kept, 0 discarded: the `maskNode`. */
  readonly keep: T;
  /** The diffuse colour after both splices. */
  readonly rgb: V3<T>;
}

const TAU = 6.283185307179586;
const PI = 3.141592653589793;

/**
 * The one control-flow construct the maths needs: run `body` over `state` where `cond` is 1, else keep `state`. `state` is a
 * fixed-length list of scalars, and `body` returns a list of the same length.
 */
export interface Flow<T> {
  when(cond: T, state: readonly T[], body: (state: readonly T[]) => readonly T[]): readonly T[];
}

/** `Flow<number>`: a plain branch (the GLSL's `if`). */
export const NUMBER_FLOW: Flow<number> = {
  when: (cond, state, body) => (cond > 0.5 ? body(state) : state),
};

/** a < b as 0/1. */
const lt = <T>(o: Ops<T>, a: T, b: T): T => o.selectLt(a, b, o.lit(1), o.lit(0));
/** c (0/1) ? x : y, exact (never a blend). */
const pick = <T>(o: Ops<T>, c: T, x: T, y: T): T => o.selectLt(o.lit(0.5), c, x, y);
const pick3 = <T>(o: Ops<T>, c: T, x: V3<T>, y: V3<T>): V3<T> => [pick(o, c, x[0], y[0]), pick(o, c, x[1], y[1]), pick(o, c, x[2], y[2])];
const dot3 = <T>(o: Ops<T>, a: V3<T>, b: V3<T>): T => o.add(o.add(o.mul(a[0], b[0]), o.mul(a[1], b[1])), o.mul(a[2], b[2]));
const cross3 = <T>(o: Ops<T>, a: V3<T>, b: V3<T>): V3<T> => [
  o.sub(o.mul(a[1], b[2]), o.mul(a[2], b[1])),
  o.sub(o.mul(a[2], b[0]), o.mul(a[0], b[2])),
  o.sub(o.mul(a[0], b[1]), o.mul(a[1], b[0])),
];

/**
 * The cut over every live volume (`rlCutApply`): `cut` 1 where any volume with index under `n` takes the fragment away,
 * `section` 1 where any such volume puts it in the light cap band. Each volume is `cutawayOps`, the one body.
 */
export function cutVolumesOps<T>(o: Ops<T>, io: IntOps<T>, flow: Flow<T>, p: V3<T>, v: readonly T[], n: T): { readonly cut: T; readonly section: T } {
  if (v.length !== CUT_VOLUME_CAP * CUT_FLOATS_PER_VOLUME) throw new Error(`cutVolumesOps: the block holds ${v.length} floats, not ${CUT_VOLUME_CAP * CUT_FLOATS_PER_VOLUME}`);
  let state: readonly T[] = [o.lit(0), o.lit(0)];
  for (let i = 0; i < CUT_VOLUME_CAP; i++) {
    const b = i * CUT_FLOATS_PER_VOLUME;
    // `if (i >= uRlCutN) break;`
    state = flow.when(lt(o, o.lit(i), n), state, ([cut, section]) => {
      const r = cutawayOps(o, io, p[0], p[1], p[2], { cx: v[b], cz: v[b + 1], r: v[b + 2], w: v[b + 3], yCut: v[b + 4], yTop: v[b + 5], j: v[b + 6] });
      return [o.max(cut as T, r.cut), o.max(section as T, r.section)];
    });
  }
  return { cut: state[0] as T, section: state[1] as T };
}

/** `rlHoleHash(xi, yi)`: `tileHash`'s integer body, the top 24 bits as a float in [0, 1). `xi`, `yi` integer-valued floats. */
function holeHashOps<T>(io: IntOps<T>, xi: T, yi: T): T {
  return io.toFloat01(tileHashOps(io, xi, yi));
}

/** `rlHoleEdge(theta, seed)`: the periodic value-noise fbm in [0, 1]. `seed` an integer-valued float. */
export function holeEdgeOps<T>(o: Ops<T>, io: IntOps<T>, theta: T, seed: T): T {
  const turn = o.fract(o.div(theta, o.lit(TAU)));
  let sum = o.lit(0);
  let norm = 0;
  let amp = 1;
  for (let k = 0; k < HOLE_EDGE_OCTAVES; k++) {
    const cells = HOLE_EDGE_CELLS << k;
    const u = o.mul(turn, o.lit(cells));
    const fl = o.floor(u);
    // `int(floor(u)) % cells`: turn < 1, so floor(u) < cells already; `(i0 + 1) % cells` wraps the last cell to 0.
    const i0 = fl;
    const next = o.add(i0, o.lit(1));
    const i1 = o.selectLt(next, o.lit(cells), next, o.lit(0));
    const fr = o.sub(u, fl);
    const s = o.mul(o.mul(fr, fr), o.sub(o.lit(3), o.mul(o.lit(2), fr)));
    const row = o.add(o.mul(seed, o.lit(128)), o.lit(k));
    const a = holeHashOps(io, i0, row);
    const b = holeHashOps(io, i1, row);
    sum = o.add(sum, o.mul(o.lit(amp), o.mix(a, b, s)));
    norm += amp;
    amp *= 0.5;
  }
  return o.div(sum, o.lit(norm));
}

/**
 * Every live hole (`rlHoleApply`): `cut` 1 where any hole with index under `n` holds the fragment inside its cylinder, and the
 * running edge tint `(rgb, a)` over the holes in order, as the GLSL's `rlHoleTint`.
 */
export function holesOps<T>(o: Ops<T>, io: IntOps<T>, flow: Flow<T>, p: V3<T>, h: HolesInput<T>): { readonly cut: T; readonly tint: V4<T> } {
  if (h.c.length !== HOLE_CAP || h.a.length !== HOLE_CAP) throw new Error(`holesOps: ${h.c.length} centres and ${h.a.length} axes, not ${HOLE_CAP}`);
  const zero = o.lit(0);
  const one = o.lit(1);
  // The running state: [cut, tint.r, tint.g, tint.b, tint.a].
  let state: readonly T[] = [zero, zero, zero, zero, zero];
  for (let i = 0; i < HOLE_CAP; i++) {
    const cv = h.c[i];
    const av = h.a[i];
    const axis: V3<T> = [av[0], av[1], av[2]];
    const d: V3<T> = [o.sub(p[0], cv[0]), o.sub(p[1], cv[1]), o.sub(p[2], cv[2])];
    const ax = dot3(o, d, axis);
    // `if (i >= uRlHoleN) break;` and `if (abs(ax) >= HOLE_DEPTH_TILES) continue;`
    const live = o.mul(lt(o, o.lit(i), h.n), lt(o, o.abs(ax), o.lit(HOLE_DEPTH_TILES)));
    state = flow.when(live, state, (st) => {
      let tint: V4<T> = [st[1] as T, st[2] as T, st[3] as T, st[4] as T];
      const set = (c: T, rgb: V3<T>, a: T): void => {
        const next = pick3(o, c, rgb, [tint[0], tint[1], tint[2]]);
        tint = [next[0], next[1], next[2], pick(o, c, a, tint[3])];
      };
      const seed = o.floor(o.add(av[3], o.lit(0.5)));
      const up = lt(o, o.lit(0.9), o.abs(axis[1]));
      const hlp: V3<T> = [pick(o, up, one, zero), pick(o, up, zero, one), zero];
      const tRaw = cross3(o, hlp, axis);
      const tl = o.sqrt(dot3(o, tRaw, tRaw));
      const t: V3<T> = [o.div(tRaw[0], tl), o.div(tRaw[1], tl), o.div(tRaw[2], tl)];
      const b = cross3(o, axis, t);
      const x = dot3(o, d, t);
      const y = dot3(o, d, b);
      const rho = o.length2(x, y);
      const th = o.atan2(y, x);
      const rr = o.mul(cv[3], o.add(o.lit(HOLE_EDGE_BASE), o.mul(o.lit(HOLE_EDGE_AMP), holeEdgeOps(o, io, th, seed))));
      // `if (rho < rr) discard;`
      const cut = o.max(st[0] as T, lt(o, rho, rr));
      const out = o.sub(rho, rr);
      const row = o.mul(seed, o.lit(128));
      for (let k = 0; k < HOLE_CRACKS; k++) {
        const ang = o.mul(holeHashOps(io, o.lit(k), o.add(row, o.lit(HOLE_SALT_CRACK_ANGLE))), o.lit(TAU));
        const len = o.add(o.lit(HOLE_CRACK_LEN[0]), o.mul(o.lit(HOLE_CRACK_LEN[1] - HOLE_CRACK_LEN[0]), holeHashOps(io, o.lit(k), o.add(row, o.lit(HOLE_SALT_CRACK_LEN)))));
        const s = o.div(out, len);
        // GLSL `mod(abs(th - ang), TAU)`: x - TAU * floor(x / TAU); then folded to [0, PI].
        const raw = o.abs(o.sub(th, ang));
        const m = o.sub(raw, o.mul(o.lit(TAU), o.floor(o.div(raw, o.lit(TAU)))));
        const dth = o.selectLt(o.lit(PI), m, o.sub(o.lit(TAU), m), m);
        // `if (s > 1.0) continue;` then `if (dth < ROOT * (1 - s) && ALPHA > rlHoleTint.a)`.
        const c = o.mul(o.sub(one, lt(o, one, s)), o.mul(lt(o, dth, o.mul(o.lit(HOLE_CRACK_ROOT_RAD), o.sub(one, s))), lt(o, tint[3], o.lit(HOLE_CRACK_ALPHA))));
        set(c, h.crack, o.lit(HOLE_CRACK_ALPHA));
      }
      // `if (o < LIP) rlHoleTint = vec4(uRlLip, 1.0);`
      set(lt(o, out, o.lit(HOLE_LIP_TILES)), h.lip, one);
      // The halo: `ho in [0, HALO)`, alpha fading out, written only where it beats the running alpha.
      const ho = o.sub(out, o.lit(HOLE_LIP_TILES));
      const al = o.mul(o.lit(HOLE_HALO_ALPHA), o.sub(one, o.div(ho, o.lit(HOLE_HALO_TILES))));
      const inHalo = o.mul(o.sub(one, lt(o, ho, zero)), lt(o, ho, o.lit(HOLE_HALO_TILES)));
      set(o.mul(inHalo, lt(o, tint[3], al)), h.halo, al);
      return [cut, tint[0], tint[1], tint[2], tint[3]];
    });
  }
  return { cut: state[0] as T, tint: [state[1] as T, state[2] as T, state[3] as T, state[4] as T] };
}

/** One fragment of a holed and/or cut building: the mask and the colour after both splices (see the header for the order). */
export function buildingFragmentOps<T>(o: Ops<T>, io: IntOps<T>, flow: Flow<T>, f: BuildingFragmentInput<T>): BuildingFragment<T> {
  const one = o.lit(1);
  let gone = o.lit(0);
  let rgb: V3<T> = f.base;
  if (f.cut !== null) {
    const c = cutVolumesOps(o, io, flow, f.p, f.cut.v, f.cut.n);
    gone = o.max(gone, c.cut);
    // `if (!gl_FrontFacing) interior; else if (rlCutSection > 0.5) cap;`
    rgb = pick3(o, f.front, pick3(o, c.section, f.cut.cap, rgb), f.cut.interior);
  }
  if (f.holes !== null) {
    const h = holesOps(o, io, flow, f.p, f.holes);
    gone = o.max(gone, h.cut);
    // `if (!gl_FrontFacing) interior; else mix(diffuse, tint.rgb, tint.a);`
    const edged: V3<T> = [o.mix(rgb[0], h.tint[0], h.tint[3]), o.mix(rgb[1], h.tint[1], h.tint[3]), o.mix(rgb[2], h.tint[2], h.tint[3])];
    rgb = pick3(o, f.front, edged, f.holes.interior);
  }
  return { keep: o.sub(one, gone), rgb };
}
