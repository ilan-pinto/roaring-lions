/**
 * GH-1225 slice 1: the roof cutaway's maths and volume table, against literal oracles (design
 * `2026-11-11-roof-cutaway-design.md`, "Gates and falsifiers").
 */
import { describe, expect, it } from 'vitest';
import { NUMBER_INT_OPS, NUMBER_OPS } from '../fog-ops';
import {
  CUT_BAND_TILES,
  CUT_CLOSE_MS,
  CUT_HEIGHT_TILES,
  CUT_HOLD_MS,
  CUT_OPEN_MS,
  CUT_RIM_CELLS_PER_TILE,
  CUT_RIM_JITTER_TILES,
  CUT_RIM_WALL_TILES,
  CUT_SECTION_TILES,
  CUT_SELECT_RADIUS_TILES,
  CUT_VOLUME_CAP,
  CutawayTable,
  IRIS_SHUT,
  cutHeightOps,
  cutawayOps,
  footprintDistance,
  stepIris,
  writeCutVolumes,
  type CutIris,
  type CutTrigger,
  type CutVolume,
  garrisonCutKey,
  garrisonCutRadius,
  garrisonStations,
} from './building-cutaway';

/** The design's numbers, as literals: a change to any constant is a change to the design. */
describe('the cutaway constants (the design table, L2-L4, L8)', () => {
  it('cuts at ground + 0.4 t, R 1.25 t, band 0.5 t, a 0.06 t cap, 8 volumes; opens 250 ms, holds 1.0 s, closes 400 ms', () => {
    expect(CUT_HEIGHT_TILES).toBe(0.4);
    expect(CUT_SELECT_RADIUS_TILES).toBe(1.25);
    expect(CUT_BAND_TILES).toBe(0.5);
    expect(CUT_SECTION_TILES).toBe(0.06);
    expect(CUT_RIM_WALL_TILES).toBe(0.9);
    expect(CUT_RIM_JITTER_TILES).toBe(0.12);
    expect(CUT_RIM_CELLS_PER_TILE).toBe(4);
    expect(CUT_VOLUME_CAP).toBe(8);
    expect(CUT_OPEN_MS).toBe(250);
    expect(CUT_HOLD_MS).toBe(1000);
    expect(CUT_CLOSE_MS).toBe(400);
  });
});

// A house's cut: centre (10, 20), R 1.25, W 0.5, ground 0 so the cut is at 0.4, the roof at 2.4.
const V: CutVolume = { cx: 10, cz: 20, r: 1.25, w: 0.5, yCut: 0.4, yTop: 2.4, j: 0 };
const at = (x: number, y: number, z: number): { cut: number; section: number } => cutawayOps(NUMBER_OPS, NUMBER_INT_OPS, x, y, z, V);

describe('cutawayOps: the cut height, the slope, the section cap', () => {
  it('the cut height is yCut inside R, slopes linearly up to the roof over the band, and is the roof beyond it', () => {
    const h = (rho: number): number => cutHeightOps(NUMBER_OPS, rho, V.r, V.w, V.yCut, V.yTop);
    expect(h(0)).toBe(0.4);
    expect(h(1.25)).toBe(0.4);
    expect(h(1.5)).toBeCloseTo(1.4, 12); // halfway up the band: 0.4 + 2.0 x 0.5
    expect(h(1.75)).toBeCloseTo(2.4, 12);
    expect(h(3)).toBeCloseTo(2.4, 12);
  });

  it('cuts above the cut height inside R, and keeps what is under it', () => {
    expect(at(10, 0.41, 20)).toEqual({ cut: 1, section: 0 });
    expect(at(10.5, 2.3, 20.5)).toEqual({ cut: 1, section: 0 });
    expect(at(10, 0.2, 20)).toEqual({ cut: 0, section: 0 });
  });

  it('the band: a fragment above the slope is cut, one under it is kept (no hard cylinder)', () => {
    // rho 1.5: the slope stands at 1.4.
    expect(at(11.5, 1.45, 20).cut).toBe(1);
    expect(at(11.5, 1.3, 20).cut).toBe(0);
    // A hard cut (no band) would take everything above 0.4 out to R + W; the band keeps 0.4 < y < 1.4 at rho 1.5.
    expect(at(11.5, 0.6, 20).cut).toBe(0);
  });

  it('outside the reach R + W nothing is cut or capped, however high', () => {
    expect(at(11.76, 2.39, 20)).toEqual({ cut: 0, section: 0 });
    expect(at(10, 5, 22)).toEqual({ cut: 0, section: 0 });
  });

  it('the section cap is the 0.06 t under the cut, inside and on the band', () => {
    expect(at(10, 0.38, 20)).toEqual({ cut: 0, section: 1 });
    expect(at(10, 0.32, 20)).toEqual({ cut: 0, section: 0 });
    expect(at(11.5, 1.38, 20)).toEqual({ cut: 0, section: 1 });
    expect(at(11.5, 1.32, 20)).toEqual({ cut: 0, section: 0 });
  });
});

describe('the ragged top (rim B): tileHash of the 0.25 t brick cell, +-j', () => {
  const R = { ...V, j: 0.12 };
  const top = (x: number): number => {
    let t = -1;
    for (let y = 0; y <= 1; y += 0.002) if (cutawayOps(NUMBER_OPS, NUMBER_INT_OPS, x, y, 20, R).cut === 0) t = y;
    return t;
  };
  it('every cell keeps within +-j of the cut height, and the cells differ', () => {
    const tops = new Set<number>();
    for (let c = 0; c < 6; c++) {
      const t = top(9.1 + c * 0.25 + 0.1);
      expect(t).toBeGreaterThanOrEqual(0.4 - 0.12 - 0.003);
      expect(t).toBeLessThanOrEqual(0.4 + 0.12 + 0.003);
      tops.add(Math.round(t * 50));
    }
    expect(tops.size).toBeGreaterThanOrEqual(4);
  });
  it('one cell is flat across its width and does not move between calls (no per-fragment noise)', () => {
    expect(top(10.02)).toBe(top(10.2));
    expect(top(10.1)).toBe(top(10.1));
  });
  it('j 0 is the straight cut', () => {
    expect(cutawayOps(NUMBER_OPS, NUMBER_INT_OPS, 10.1, 0.41, 20, { ...V, j: 0 }).cut).toBe(1);
    expect(cutawayOps(NUMBER_OPS, NUMBER_INT_OPS, 10.1, 0.39, 20, { ...V, j: 0 }).cut).toBe(0);
  });
});

describe('stepIris: open, hold and close on the frame clock, two frames either side of each edge', () => {
  /** Runs `frames` 10 ms frames, triggered or not, from `s`; null once closed. */
  const run = (s: CutIris | null, triggered: boolean, frames: number): CutIris | null => {
    let cur = s;
    for (let i = 0; i < frames && cur !== null; i++) cur = stepIris(cur, triggered, 10);
    return cur;
  };

  it('opens to full in exactly 250 ms, ease-out', () => {
    expect(run(IRIS_SHUT, true, 23)!.k).toBeLessThan(1);
    expect(run(IRIS_SHUT, true, 24)!.k).toBeLessThan(1);
    expect(run(IRIS_SHUT, true, 25)!.k).toBe(1);
    expect(run(IRIS_SHUT, true, 26)!.k).toBe(1);
    // Ease-out: half the time opens three quarters of the way.
    expect(stepIris(IRIS_SHUT, true, 125)!.k).toBeCloseTo(0.75, 12);
  });

  it('holds full for 1.0 s after the trigger ends, then shrinks', () => {
    const open = run(IRIS_SHUT, true, 30)!;
    expect(run(open, false, 99)!.k).toBe(1);
    expect(run(open, false, 100)!.k).toBe(1);
    expect(run(open, false, 101)!.k).toBeLessThan(1);
    expect(run(open, false, 102)!.k).toBeLessThan(1);
  });

  it('is gone 400 ms after the hold, and not a frame before', () => {
    const open = run(IRIS_SHUT, true, 30)!;
    expect(run(open, false, 138)!.k).toBeGreaterThan(0);
    expect(run(open, false, 139)!.k).toBeGreaterThan(0);
    expect(run(open, false, 140)).toBeNull();
    expect(run(open, false, 141)).toBeNull();
    // Ease-in: halfway through the close, three quarters of the scale is left.
    expect(stepIris(stepIris(open, false, 1000)!, false, 200)!.k).toBeCloseTo(0.75, 12);
  });

  it('a cut re-triggered while closing reopens from where it had got to, never from nothing', () => {
    const open = run(IRIS_SHUT, true, 30)!;
    const closing = stepIris(stepIris(open, false, 1000)!, false, 200)!;
    const again = stepIris(closing, true, 10)!;
    expect(again.k).toBeGreaterThan(closing.k);
    expect(again.closeMs).toBe(0);
    expect(again.heldMs).toBe(0);
  });

  it('a frozen frame (hit-stop, dt 0) moves nothing', () => {
    const half = stepIris(IRIS_SHUT, true, 125)!;
    expect(stepIris(half, true, 0)!.k).toBe(half.k);
  });
});

const trigger = (key: number, focusDist2: number, garrison = false): CutTrigger => ({
  key, r: CUT_SELECT_RADIUS_TILES, garrison, x: key, z: 0, yCut: 0.4, yTop: 2.4, focusDist2,
});

describe('CutawayTable: the volume cap and the order', () => {
  it('nothing in, nothing out', () => {
    const t = new CutawayTable();
    t.step([], 16);
    expect(t.size).toBe(0);
    expect(t.volumes([])).toEqual([]);
  });

  it('at most 8 volumes: of 9 selected units the one farthest from the camera focus takes none', () => {
    const t = new CutawayTable();
    const nine = [5, 1, 8, 3, 9, 2, 7, 4, 6].map((d) => trigger(d, d * d));
    t.step(nine, 300);
    const vols = t.volumes([]);
    expect(vols).toHaveLength(8);
    expect(vols.map((v) => v.cx).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const block = new Float32Array(8 * 8);
    expect(writeCutVolumes(vols, block)).toBe(8);
  });

  it('a closing volume gives way to a new trigger when the table is full', () => {
    const t = new CutawayTable();
    t.step([1, 2, 3, 4, 5, 6, 7, 8].map((k) => trigger(k, k)), 300);
    t.step([2, 3, 4, 5, 6, 7, 8, 9].map((k) => trigger(k, k)), 16);
    expect(t.size).toBe(8);
    expect(t.volumes([]).map((v) => v.cx).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('scales R and W by the iris: a fresh cut takes nothing away, an open one is the full R and W', () => {
    const t = new CutawayTable();
    t.step([trigger(1, 1)], 0);
    expect(t.volumes([])).toEqual([]);
    t.step([trigger(1, 1)], 300);
    expect(t.volumes([])).toEqual([{ cx: 1, cz: 0, r: 1.25, w: 0.5, yCut: 0.4, yTop: 2.4, j: CUT_RIM_JITTER_TILES }]);
  });

  it('a volume holds where its trigger last stood, and closes 1.4 s after it ends', () => {
    const t = new CutawayTable();
    t.step([trigger(1, 1)], 300);
    t.step([], 1000);
    expect(t.volumes([])[0].r).toBe(1.25);
    t.step([], 399);
    expect(t.size).toBe(1);
    t.step([], 1);
    expect(t.size).toBe(0);
  });
});

describe('writeCutVolumes and footprintDistance', () => {
  it('two vec4 a volume: (cx, cz, r, w), (yCut, yTop, j, 0)', () => {
    const block = new Float32Array(64).fill(9);
    expect(writeCutVolumes([V], block)).toBe(1);
    expect(Array.from(block.slice(0, 8))).toEqual([10, 20, 1.25, 0.5, Math.fround(0.4), Math.fround(2.4), 0, 0]);
    expect(block[8]).toBe(9);
  });
  it('is 0 inside the footprint [min, max + 1] and the edge distance outside it', () => {
    expect(footprintDistance(2, 3, 4, 5, 3.5, 4)).toBe(0);
    expect(footprintDistance(2, 3, 4, 5, 6.25, 4)).toBe(1.25);
    expect(footprintDistance(2, 3, 4, 5, 8, 10)).toBe(5); // the corner (5, 6): 3 across, 4 down
  });
});

describe('slice 2: the garrison volume', () => {
  it('R is the footprint half-diagonal + 0.25 t: a 3 x 3 house gives 2.371 t, a 2 x 2 one 1.664 t', () => {
    expect(garrisonCutRadius(10, 10, 12, 12)).toBeCloseTo(2.3713, 4);
    expect(garrisonCutRadius(5, 5, 6, 6)).toBeCloseTo(1.6642, 4);
  });

  it('a garrison key never meets a unit index', () => {
    expect(garrisonCutKey(0)).toBe(-1);
    expect(garrisonCutKey(7)).toBe(-8);
  });

  it('the volume carries its own R through the iris', () => {
    const t = new CutawayTable();
    t.step([{ ...trigger(-1, 99, true), r: 2.5 }], 300);
    expect(t.volumes([])[0].r).toBe(2.5);
  });

  it('garrisons first (L8): eight selected units nearer the focus and one garrison keep the garrison', () => {
    const t = new CutawayTable();
    const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => trigger(k, k));
    t.step([...eight, { ...trigger(-1, 1e6, true), x: 50 }], 300);
    const xs = t.volumes([]).map((v) => v.cx);
    expect(xs).toHaveLength(8);
    expect(xs).toContain(50);
    expect(xs).not.toContain(8);
  });

  it('among CLOSING volumes the cap evicts a selection before a garrison, even one with the larger scale', () => {
    const t = new CutawayTable();
    const garrison = { ...trigger(-2, 1e6, true), x: 50 };
    const sel0 = trigger(1, 1);
    t.step([sel0, garrison], 300); // both fully open
    t.step([sel0], 1200); // the garrison's trigger ended 1200 ms ago: 200 ms into its close, scale < 1; the selection is still triggered
    t.step([2, 3, 4, 5, 6, 7, 8].map((k) => trigger(k, k)), 16); // seven new selections: sel0 and the garrison are both closing, nine entries, one goes
    const xs = t.volumes([]).map((v) => v.cx);
    expect(xs).toHaveLength(8);
    expect(xs).toContain(50); // the garrison stays although the selection's scale is the larger
    expect(xs).not.toContain(1);
  });

  it('a held garrison outranks a closing selection when the table overflows', () => {
    const t = new CutawayTable();
    t.step([1, 2, 3, 4, 5, 6, 7, 8].map((k) => trigger(k, k)), 300);
    t.step([{ ...trigger(-1, 1e6, true), x: 50 }], 16);
    expect(t.volumes([]).map((v) => v.cx)).toContain(50);
  });
});

describe('slice 2: garrison stations', () => {
  const inside = (pts: number[], minX: number, minY: number, maxX: number, maxY: number): void => {
    // A loop over no stations asserts nothing: the stations must exist (PR 1238 review).
    expect(pts.length, 'the stations exist').toBeGreaterThan(0);
    expect(pts.length % 2).toBe(0);
    for (let k = 0; k < pts.length; k += 2) {
      expect(pts[k]).toBeGreaterThanOrEqual(minX + 0.3);
      expect(pts[k]).toBeLessThanOrEqual(maxX + 1 - 0.3);
      expect(pts[k + 1]).toBeGreaterThanOrEqual(minY + 0.3);
      expect(pts[k + 1]).toBeLessThanOrEqual(maxY + 1 - 0.3);
    }
  };
  it('a house with 4 slots: 4 distinct stations inside the footprint inset by 0.3 t, at least 0.3 t apart', () => {
    const pts = garrisonStations(3, 10, 10, 12, 12, 4);
    expect(pts).toHaveLength(8);
    inside(pts, 10, 10, 12, 12);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        expect(Math.hypot(pts[2 * a] - pts[2 * b], pts[2 * a + 1] - pts[2 * b + 1])).toBeGreaterThan(0.3);
      }
    }
  });
  it('pure: the same building gives the same stations every call; another building, other ones', () => {
    expect(garrisonStations(3, 10, 10, 12, 12, 6)).toEqual(garrisonStations(3, 10, 10, 12, 12, 6));
    expect(garrisonStations(4, 10, 10, 12, 12, 6)).not.toEqual(garrisonStations(3, 10, 10, 12, 12, 6));
    inside(garrisonStations(9, 0, 0, 0, 0, 3), 0, 0, 0, 0);
  });
});
