/**
 * GH-1225 slice 1: the roof cutaway's maths and its volume table (design `2026-11-11-roof-cutaway-design.md`, Option A).
 *
 * A cut is a vertical cylinder taken out of a building above a waist-high cut height. Over an edge band the cut height slopes
 * linearly back up to the roof, so the edge reads as a broken section rather than a stencil; a thin band just under the cut is
 * the section cap, painted light by the hook (`cut-material.ts`). A fragment at world (x, y, z) is cut by a volume when all
 * three hold:
 *
 * - its horizontal distance rho from the centre is under `r + w`;
 * - it is above the volume's cut height `yCut`;
 * - it is above the band's slope, `yCut + (yTop - yCut) * clamp((rho - r) / w, 0, 1)`.
 *
 * The test is written ONCE, as `cutawayOps` against `Ops<T>`: `NUMBER_OPS` runs it in vitest, and the hook's GLSL spells the
 * same constants and lines (pinned by text in `cut-material.test.ts`). The TSL twin (a later slice) takes it through
 * `MATERIAL_MATHS`.
 *
 * The volume table is UI state: slice 1 has one trigger, a selected unit within `CUT_SELECT_RADIUS_TILES` of a standing
 * building's drawn footprint. It opens and closes on the FRAME clock, not the sim's: the trigger is the viewer's selection,
 * which changes while the sim is paused, and the sim-clock rule covers world animation that must freeze with the sim.
 *
 * Presentation only: reads sim state, writes none (invariant 4). Import-free but for the `Ops` type.
 */
import type { Ops } from '../fog-ops';

/** At most this many volumes at once: the hook's fixed loop. Garrisons first, then selected units nearest the
 *  camera focus. */
export const CUT_VOLUME_CAP = 8;
/** The cut height above the ground at the volume's centre, tiles (1.2 m: waist high on a 0.6 t figure). */
export const CUT_HEIGHT_TILES = 0.4;
/** A selected unit within this of a building's drawn footprint cuts it; also the volume's full radius R, tiles. */
export const CUT_SELECT_RADIUS_TILES = 1.25;
/** The edge band W over which the cut height slopes back up to the roof, tiles. */
export const CUT_BAND_TILES = 0.5;
/** The section cap: the band just under the cut that the hook paints light, tiles. */
export const CUT_SECTION_TILES = 0.03;
/** The iris opens over this, ease-out, ms. */
export const CUT_OPEN_MS = 250;
/** A cut holds this long after its trigger ends, ms (stops flicker when a selection changes). */
export const CUT_HOLD_MS = 1000;
/** Then shrinks over this, ms. */
export const CUT_CLOSE_MS = 400;
/** The roof of a building whose drawn bounds are empty, above the cut height, tiles: a house's two storeys. */
export const CUT_ROOF_FALLBACK_TILES = 2;
/** A garrison's volume reaches this far past its footprint's half-diagonal, tiles (slice 2). */
export const CUT_GARRISON_MARGIN_TILES = 0.25;
/** A garrison's figures stand at stations inside the footprint inset by this, tiles (slice 2). */
export const CUT_STATION_INSET_TILES = 0.3;

/** The radius R of a garrison's volume over the footprint [minX, maxX + 1] x [minY, maxY + 1]: its half-diagonal plus
 *  `CUT_GARRISON_MARGIN_TILES`, so the whole drawn footprint is cut. */
export function garrisonCutRadius(minX: number, minY: number, maxX: number, maxY: number): number {
  return Math.hypot(maxX + 1 - minX, maxY + 1 - minY) / 2 + CUT_GARRISON_MARGIN_TILES;
}

/** The trigger key of building `s`'s garrison: negative, so it can never meet a unit index. */
export function garrisonCutKey(s: number): number {
  return -1 - s;
}

/** A presentation hash of (a, b, c) to [0, 1): the stations' jitter. Pure, so a station never moves between frames. */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Building `s`'s `slots` garrison stations, world tiles (x, z) pairs into `out` (length 2 * slots). A grid of
 * ceil(sqrt(slots)) columns over the footprint inset by `CUT_STATION_INSET_TILES`, one station to a cell, each jittered by the
 * hash within the middle half of its cell: so the stations are distinct and inside the inset whatever the hash says. A
 * footprint too small to inset keeps its centre line.
 */
export function garrisonStations(s: number, minX: number, minY: number, maxX: number, maxY: number, slots: number, out: number[] = []): number[] {
  out.length = 0;
  const n = Math.max(1, slots);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const x0 = minX + CUT_STATION_INSET_TILES;
  const z0 = minY + CUT_STATION_INSET_TILES;
  const w = Math.max(0, maxX + 1 - minX - 2 * CUT_STATION_INSET_TILES);
  const d = Math.max(0, maxY + 1 - minY - 2 * CUT_STATION_INSET_TILES);
  for (let k = 0; k < n; k++) {
    const c = k % cols;
    const r = Math.floor(k / cols);
    const jx = 0.25 + 0.5 * hash01(s, k, 1);
    const jz = 0.25 + 0.5 * hash01(s, k, 2);
    out.push(x0 + ((c + jx) / cols) * w, z0 + ((r + jz) / rows) * d);
  }
  return out;
}

/** One active volume, world tiles: centre (cx, cz), radius and band (already scaled by the iris), cut height and roof. */
export interface CutVolume {
  readonly cx: number;
  readonly cz: number;
  readonly r: number;
  readonly w: number;
  readonly yCut: number;
  readonly yTop: number;
}

/** The cut height at horizontal distance `rho` from the centre: `yCut` inside `r`, sloping linearly up to `yTop` over `w`. */
export function cutHeightOps<T>(o: Ops<T>, rho: T, r: T, w: T, yCut: T, yTop: T): T {
  return o.add(yCut, o.mul(o.sub(yTop, yCut), o.clamp01(o.div(o.sub(rho, r), w))));
}

/**
 * One volume's verdict at world (x, y, z): `cut` is 1 where the fragment is taken away, `section` 1 where it is kept but lies
 * within `CUT_SECTION_TILES` under the cut (the light cap). Both 0 elsewhere, and both 0 outside the reach `r + w`.
 */
export function cutawayOps<T>(
  o: Ops<T>,
  x: T,
  y: T,
  z: T,
  v: { readonly cx: T; readonly cz: T; readonly r: T; readonly w: T; readonly yCut: T; readonly yTop: T }
): { readonly cut: T; readonly section: T } {
  const one = o.lit(1);
  const zero = o.lit(0);
  const rho = o.length2(o.sub(x, v.cx), o.sub(z, v.cz));
  const inReach = o.selectLt(rho, o.add(v.r, v.w), one, zero);
  const h = cutHeightOps(o, rho, v.r, v.w, v.yCut, v.yTop);
  const above = o.selectLt(h, y, one, zero);
  const inSection = o.selectLt(o.sub(h, o.lit(CUT_SECTION_TILES)), y, one, zero);
  return { cut: o.mul(inReach, above), section: o.mul(inReach, o.mul(inSection, o.sub(one, above))) };
}

/** The open iris's ease-out: progress `p` in [0, 1] to the volume's scale. */
export function irisEaseOut(p: number): number {
  const q = 1 - Math.min(1, Math.max(0, p));
  return 1 - q * q;
}

/** One volume's iris on the frame clock. `k` scales the whole volume (R and W), so a fresh cut takes nothing away. */
export interface CutIris {
  /** The volume's scale, 0 to 1. */
  readonly k: number;
  /** Open time spent, ms (0 to `CUT_OPEN_MS`). */
  readonly openMs: number;
  /** Time since the trigger ended, ms; 0 while triggered. */
  readonly heldMs: number;
  /** Close time spent, ms; 0 until the hold runs out. */
  readonly closeMs: number;
}

export const IRIS_SHUT: CutIris = { k: 0, openMs: 0, heldMs: 0, closeMs: 0 };

/**
 * One frame of an iris: triggered, it opens (ease-out over `CUT_OPEN_MS`); untriggered, it holds `CUT_HOLD_MS` where it is,
 * then shrinks over `CUT_CLOSE_MS` (ease-in, the open's mirror). A cut re-triggered while closing reopens from the scale it
 * had reached, never from nothing. Null once it has closed.
 */
export function stepIris(s: CutIris, triggered: boolean, dtMs: number): CutIris | null {
  if (triggered) {
    // Re-triggered mid-close: the open time that gives today's scale.
    const from = s.closeMs > 0 ? CUT_OPEN_MS * (1 - Math.sqrt(Math.max(0, 1 - s.k))) : s.openMs;
    const openMs = Math.min(CUT_OPEN_MS, from + dtMs);
    return { k: irisEaseOut(openMs / CUT_OPEN_MS), openMs, heldMs: 0, closeMs: 0 };
  }
  const heldMs = s.heldMs + dtMs;
  const over = heldMs - CUT_HOLD_MS;
  if (over <= 0) return { k: s.k, openMs: s.openMs, heldMs, closeMs: 0 };
  // The first closing frame starts from the close time that gives today's scale (0 for a fully open cut).
  const from = s.closeMs > 0 ? s.closeMs : CUT_CLOSE_MS * Math.sqrt(Math.max(0, 1 - s.k));
  const closeMs = from + Math.min(dtMs, over);
  if (closeMs >= CUT_CLOSE_MS) return null;
  const t = closeMs / CUT_CLOSE_MS;
  return { k: 1 - t * t, openMs: s.openMs, heldMs, closeMs };
}

/** A selected unit asking for a cut this frame: its key (the unit index), where it is drawn, its cut height and the tallest
 *  roof in its reach (world tiles), and its squared distance from the camera focus (the cap's order). */
export interface CutTrigger {
  readonly key: number;
  /** The volume's full radius R: `CUT_SELECT_RADIUS_TILES` for a selected unit, `garrisonCutRadius` for a garrison. */
  readonly r: number;
  /** A garrison's volume: ranked before every selected unit's under the cap. */
  readonly garrison: boolean;
  readonly x: number;
  readonly z: number;
  readonly yCut: number;
  readonly yTop: number;
  readonly focusDist2: number;
}

interface CutEntry {
  r: number;
  garrison: boolean;
  x: number;
  z: number;
  yCut: number;
  yTop: number;
  focusDist2: number;
  triggered: boolean;
  iris: CutIris;
}

/**
 * The live volumes, keyed by their trigger. A volume keeps its last trigger's position while it holds and closes. At most
 * `CUT_VOLUME_CAP` live at once: the triggered ones nearest the camera focus, then the closing ones that are most open.
 */
export class CutawayTable {
  private readonly entries = new Map<number, CutEntry>();

  /** How many volumes are live (open, holding or closing). */
  get size(): number {
    return this.entries.size;
  }

  step(triggers: readonly CutTrigger[], dtMs: number): void {
    if (triggers.length === 0 && this.entries.size === 0) return;
    const ranked = triggers.length > CUT_VOLUME_CAP ? [...triggers].sort(byFocus).slice(0, CUT_VOLUME_CAP) : triggers;
    for (const e of this.entries.values()) e.triggered = false;
    for (const t of ranked) {
      let e = this.entries.get(t.key);
      if (e === undefined) {
        e = { r: t.r, garrison: t.garrison, x: t.x, z: t.z, yCut: t.yCut, yTop: t.yTop, focusDist2: t.focusDist2, triggered: true, iris: IRIS_SHUT };
        this.entries.set(t.key, e);
      }
      e.r = t.r;
      e.garrison = t.garrison;
      e.x = t.x;
      e.z = t.z;
      e.yCut = t.yCut;
      e.yTop = t.yTop;
      e.focusDist2 = t.focusDist2;
      e.triggered = true;
    }
    for (const [key, e] of this.entries) {
      const next = stepIris(e.iris, e.triggered, dtMs);
      if (next === null) this.entries.delete(key);
      else e.iris = next;
    }
    if (this.entries.size <= CUT_VOLUME_CAP) return;
    const order = [...this.entries].sort(([ka, a], [kb, b]) => {
      if (a.triggered !== b.triggered) return a.triggered ? -1 : 1;
      if (a.garrison !== b.garrison) return a.garrison ? -1 : 1;
      if (a.triggered) return a.focusDist2 - b.focusDist2 || ka - kb;
      return b.iris.k - a.iris.k || ka - kb;
    });
    for (let i = CUT_VOLUME_CAP; i < order.length; i++) this.entries.delete(order[i][0]);
  }

  /** This frame's volumes, the iris applied, into `out` (cleared). A volume scaled to nothing is left out. */
  volumes(out: CutVolume[]): CutVolume[] {
    out.length = 0;
    for (const e of this.entries.values()) {
      const k = e.iris.k;
      if (k <= 0) continue;
      out.push({ cx: e.x, cz: e.z, r: k * e.r, w: k * CUT_BAND_TILES, yCut: e.yCut, yTop: e.yTop });
    }
    return out;
  }

  /** Forgets every volume (a mission's end). */
  clear(): void {
    this.entries.clear();
  }
}

/** The cap's order: garrisons first (L8), then nearest the camera focus. */
function byFocus(a: CutTrigger, b: CutTrigger): number {
  if (a.garrison !== b.garrison) return a.garrison ? -1 : 1;
  return a.focusDist2 - b.focusDist2 || a.key - b.key;
}

/** TEMPORARY (GH-1225 rim A/B, never shipped): the variant knobs. `wall` is the kept wall height in tiles above the ground (house: ground storey 0.08..1.28, floor slab above); < 0 keeps today's fixed 0.4. */
export const RIM_DEBUG = { name: 'off', wall: -1, jitter: 0, section: CUT_SECTION_TILES, tone: 0 };
export const RIM_VARIANTS: Record<string, { wall: number; jitter: number; section: number; tone: number }> = {
  off: { wall: -1, jitter: 0, section: CUT_SECTION_TILES, tone: 0 },
  // A: 0.7 t straight brick course, a bright cap thick enough to read.
  a: { wall: 0.7, jitter: 0, section: 0.1, tone: 0 },
  // B: 0.9 t, a broken (ragged) top by 0.25 t brick cells, mid-tone cap.
  b: { wall: 0.9, jitter: 0.12, section: 0.06, tone: 0.5 },
  // C: 1.1 t straight parapet, darker brick-edge tone.
  c: { wall: 1.1, jitter: 0, section: 0.08, tone: 0.35 },
};

/** Floats per volume in the shared block: two `vec4`s, (cx, cz, r, w) and (yCut, yTop, 0, 0). */
export const CUT_FLOATS_PER_VOLUME = 8;

/** Writes up to `CUT_VOLUME_CAP` volumes into the block `out` (`CUT_VOLUME_CAP * CUT_FLOATS_PER_VOLUME` floats); returns how
 *  many it wrote, the hook's `uRlCutN`. */
export function writeCutVolumes(volumes: readonly CutVolume[], out: Float32Array): number {
  const n = Math.min(volumes.length, CUT_VOLUME_CAP);
  for (let i = 0; i < n; i++) {
    const v = volumes[i];
    const o = i * CUT_FLOATS_PER_VOLUME;
    out[o] = v.cx;
    out[o + 1] = v.cz;
    out[o + 2] = v.r;
    out[o + 3] = v.w;
    out[o + 4] = v.yCut;
    out[o + 5] = v.yTop;
    out[o + 6] = RIM_DEBUG.jitter;
    out[o + 7] = RIM_DEBUG.section;
  }
  return n;
}

/** The horizontal distance from (x, z) to the tile rectangle [minX, maxX + 1] x [minY, maxY + 1] (a structure's footprint, as
 *  `footprintCentre` reads it); 0 inside. */
export function footprintDistance(minX: number, minY: number, maxX: number, maxY: number, x: number, z: number): number {
  const dx = Math.max(minX - x, 0, x - (maxX + 1));
  const dz = Math.max(minY - z, 0, z - (maxY + 1));
  return Math.hypot(dx, dz);
}
