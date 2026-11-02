// Two measurements of how a map's relief is drawn (GH-920 B1/B2), both on the elevation grid the sim reads.
//
// 1. `fatStairs`: the 2x2 staircase of a naive upscale, found in the grid itself. A bank authored on 2x2
//    cells along a 45 degree line comes out of the renderer as a scalloped contour (PR 928: 0.94 tile of
//    wander, against 0.15 for one tile per step), and the relief read draws every scallop. Its grid
//    signature is three 2-tall transitions in a row, each shifted two columns the same way:
//
//        . . . . R R
//        . . . . R R
//        . . R R R R         (a per-tile bank shifts one column a row; a 1:2 bank one column
//        . . R R R R          every two rows; neither is this)
//        R R R R R R
//        R R R R R R
//
//    This is the census check ("no 2x2 diagonal steps"): it asks for the construction that causes the
//    scallop, so it holds on any relief, however irregular.
//
// 2. `contourWander`: how far a half-level contour wanders off a smooth line on the DRAWN ground
//    (surface.ts's Catmull-Rom through the tile centres, not a copy of its formula). It is
//    _coord/rujm-sawda-look/proto/scallop.py generalised to a whole map: each long contour is traced by
//    marching squares, resampled every half tile, and at each point a quadratic is fitted by least squares
//    (in the chord's own frame) to the samples within +-WINDOW tiles of arc; the contour's wander is the
//    peak-to-peak spread of what the quadratic does not explain, and the map's wander is the worst
//    contour. REPORT-ONLY, never a gate on a whole map: it reads 0.13 on scallop.py's per-tile 45 degree
//    bank and 1.08 on its 2x2 bank, but a per-tile bank at 2:1 reads 0.42 and at 3:1 0.76, and the 48x48
//    Wadi Tarfan's own hand-drawn relief reads 0.85. It measures the irregularity of a relief, not the
//    staircase, so only the synthetic banks calibrate it.
import { smoothLevel, terrainSurfaceFrom } from '../../packages/render/src/three/terrain/surface';

export interface Wander {
  /** The worst contour's peak-to-peak residual, in tiles. 0 when nothing qualified. */
  wander: number;
  /** Where the worst contour is, in tile coordinates (its first sample), or null. */
  at: [number, number] | null;
  /** The half level of the worst contour, or null. */
  level: number | null;
  /** The point on it with the largest residual, in tile coordinates, or null. */
  worst: [number, number] | null;
  /** How many contours were long enough and straight enough to be measured. */
  measured: number;
}

const STEP = 0.25; // sampling grid, in tiles
const SPACING = 0.5; // resampled spacing along a contour, in tiles
const WINDOW = 4; // tiles of arc either side of a point
const MIN_ARC = 16; // a contour shorter than this (a knoll, a pad) is not a bank
const STRAIGHT_DEG = 25;
const EDGE = 3; // samples this close to the map edge or to a blocked tile are skipped

type P = [number, number];

/** Marching squares at `c` over the grid `g` (nx by ny samples, spacing STEP from 0.5): its segments. */
function segmentsAt(g: Float64Array, nx: number, ny: number, c: number): [P, P][] {
  const out: [P, P][] = [];
  const at = (i: number, j: number) => g[j * nx + i];
  const pt = (i0: number, j0: number, i1: number, j1: number): P => {
    const a = at(i0, j0) - c;
    const b = at(i1, j1) - c;
    const t = a / (a - b);
    return [0.5 + (i0 + (i1 - i0) * t) * STEP, 0.5 + (j0 + (j1 - j0) * t) * STEP];
  };
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)].map((x) => x > c);
      const code = (v[0] ? 1 : 0) | (v[1] ? 2 : 0) | (v[2] ? 4 : 0) | (v[3] ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => pt(i, j, i + 1, j);
      const right = () => pt(i + 1, j, i + 1, j + 1);
      const bottom = () => pt(i, j + 1, i + 1, j + 1);
      const left = () => pt(i, j, i, j + 1);
      switch (code) {
        case 1: case 14: out.push([left(), top()]); break;
        case 2: case 13: out.push([top(), right()]); break;
        case 3: case 12: out.push([left(), right()]); break;
        case 4: case 11: out.push([right(), bottom()]); break;
        case 6: case 9: out.push([top(), bottom()]); break;
        case 7: case 8: out.push([left(), bottom()]); break;
        case 5: out.push([left(), top()], [right(), bottom()]); break;
        case 10: out.push([top(), right()], [left(), bottom()]); break;
      }
    }
  }
  return out;
}

/** Join segments that share an endpoint into polylines (open or closed). */
function chain(segs: [P, P][]): P[][] {
  const key = (p: P) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const l = ends.get(k);
      if (l) l.push(i);
      else ends.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: P[][] = [];
  const extend = (line: P[], atEnd: boolean) => {
    for (;;) {
      const tip = atEnd ? line[line.length - 1] : line[0];
      const next = (ends.get(key(tip)) ?? []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [a, b] = segs[next];
      const far = key(a) === key(tip) ? b : a;
      if (atEnd) line.push(far);
      else line.unshift(far);
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: P[] = [segs[i][0], segs[i][1]];
    extend(line, true);
    extend(line, false);
    out.push(line);
  }
  return out;
}

/** Resample a polyline every SPACING tiles of arc. Returns the points and the polyline's length. */
function resample(line: P[]): { pts: P[]; length: number } {
  const pts: P[] = [line[0]];
  let carried = 0;
  let length = 0;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    length += d;
    let s = SPACING - carried;
    while (s <= d) {
      pts.push([x0 + ((x1 - x0) * s) / d, y0 + ((y1 - y0) * s) / d]);
      s += SPACING;
    }
    carried = d - (s - SPACING);
  }
  return { pts, length };
}

/** The perpendicular residual at the middle of `win` from a least-squares quadratic in its chord frame. */
function residual(win: P[]): number | null {
  const a = win[0];
  const b = win[win.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < WINDOW) return null; // the window doubled back on itself
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const heading = (p: P, q: P) => Math.atan2(q[1] - p[1], q[0] - p[0]);
  const mid = win[win.length >> 1];
  let turn = Math.abs(heading(mid, b) - heading(a, mid));
  if (turn > Math.PI) turn = 2 * Math.PI - turn;
  if ((turn * 180) / Math.PI > STRAIGHT_DEG) return null;
  // normal equations for v = c0 + c1 u + c2 u^2
  const s = [0, 0, 0, 0, 0];
  const r = [0, 0, 0];
  const us: number[] = [];
  const vs: number[] = [];
  for (const p of win) {
    const u = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
    const v = -(p[0] - a[0]) * uy + (p[1] - a[1]) * ux;
    us.push(u);
    vs.push(v);
    for (let k = 0; k < 5; k++) s[k] += u ** k;
    for (let k = 0; k < 3; k++) r[k] += v * u ** k;
  }
  const m = [
    [s[0], s[1], s[2], r[0]],
    [s[1], s[2], s[3], r[1]],
    [s[2], s[3], s[4], r[2]],
  ];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let i = c + 1; i < 3; i++) if (Math.abs(m[i][c]) > Math.abs(m[piv][c])) piv = i;
    if (Math.abs(m[piv][c]) < 1e-9) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let i = 0; i < 3; i++) {
      if (i === c) continue;
      const f = m[i][c] / m[c][c];
      for (let k = c; k < 4; k++) m[i][k] -= f * m[c][k];
    }
  }
  const [c0, c1, c2] = [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  const k = win.length >> 1;
  return vs[k] - (c0 + c1 * us[k] + c2 * us[k] ** 2);
}

/**
 * The contour wander of a map's relief. `levels` is its elevation grid and `blocked` its blocked mask
 * (a terrace in the renderer, so no contour is read within EDGE tiles of one).
 */
export function contourWander(levels: Uint8Array, blocked: Uint8Array, w: number, h: number): Wander {
  const surface = terrainSurfaceFrom(levels, blocked, w, h);
  const nx = Math.round((w - 1) / STEP) + 1;
  const ny = Math.round((h - 1) / STEP) + 1;
  const g = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = smoothLevel(surface, 0.5 + i * STEP, 0.5 + j * STEP);
  let top = 0;
  for (const l of levels) top = Math.max(top, l);
  const near = (x: number, y: number): boolean => {
    if (x < EDGE || y < EDGE || x > w - EDGE || y > h - EDGE) return true;
    for (let yy = Math.floor(y) - EDGE; yy <= Math.floor(y) + EDGE; yy++) {
      for (let xx = Math.floor(x) - EDGE; xx <= Math.floor(x) + EDGE; xx++) {
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && blocked[yy * w + xx] !== 0) return true;
      }
    }
    return false;
  };
  const half = Math.round(WINDOW / SPACING);
  const best: Wander = { wander: 0, at: null, level: null, worst: null, measured: 0 };
  for (let level = 0; level < top; level++) {
    const c = level + 0.5;
    for (const line of chain(segmentsAt(g, nx, ny, c))) {
      const { pts, length } = resample(line);
      if (length < MIN_ARC || pts.length < 2 * half + 1) continue;
      let lo = Infinity;
      let hi = -Infinity;
      let n = 0;
      let peak: [number, number] = pts[half];
      let peakAbs = -1;
      for (let i = half; i + half < pts.length; i++) {
        if (near(pts[i][0], pts[i][1])) continue;
        const rv = residual(pts.slice(i - half, i + half + 1));
        if (rv === null) continue;
        lo = Math.min(lo, rv);
        hi = Math.max(hi, rv);
        n++;
        if (Math.abs(rv) > peakAbs) {
          peakAbs = Math.abs(rv);
          peak = pts[i];
        }
      }
      if (n < 4) continue;
      best.measured++;
      if (hi - lo > best.wander) {
        best.wander = hi - lo;
        best.at = [Math.round(line[0][0] * 10) / 10, Math.round(line[0][1] * 10) / 10];
        best.level = c;
        best.worst = [Math.round(peak[0] * 10) / 10, Math.round(peak[1] * 10) / 10];
      }
    }
  }
  return best;
}


/**
 * Count the 2x2 diagonal staircases in an elevation grid: for every level L, the places where the region
 * `level >= L` has three 2-tall transitions in a row, each shifted two columns the same way (see the
 * header). Each place is counted once per level and direction. Zero on a bank drawn one tile per step.
 * @returns the count, and the first few places as "x,y L<level>"
 */
export function fatStairs(levels: Uint8Array, w: number, h: number): { count: number; first: string[] } {
  let top = 0;
  for (const l of levels) top = Math.max(top, l);
  let count = 0;
  const first: string[] = [];
  for (let level = 1; level <= top; level++) {
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && levels[y * w + x] >= level;
    // a 2-tall transition at column c over rows y, y+1, with the region on side s (+1: at and right of c)
    const jump = (c: number, y: number, s: 1 | -1) => {
      for (let r = y; r <= y + 1; r++) {
        const right = inside(c, r);
        const left = inside(c - 1, r);
        if (s === 1 ? !(right && !left) : !(left && !right)) return false;
      }
      return true;
    };
    for (const s of [1, -1] as const) {
      for (const d of [-2, 2]) {
        for (let y = 0; y + 5 < h; y++) {
          for (let c = 1; c < w - 1; c++) {
            if (jump(c, y, s) && jump(c + d, y + 2, s) && jump(c + 2 * d, y + 4, s)) {
              count++;
              if (first.length < 4) first.push(`${c},${y} L${level}`);
            }
          }
        }
      }
    }
  }
  return { count, first };
}
