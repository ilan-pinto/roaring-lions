import { describe, expect, it } from 'vitest';
import {
  MAX_INCOME_ZONES,
  ZONE_CONTESTED,
  ZONE_EMPTY,
  zoneHolder,
  zoneState,
  zoneStates,
  zoneTileMask,
  type HoldView,
} from './income';

// Literal units: tile coordinates (the test shifts them into Q16.16), side, and flags.
interface U {
  x: number;
  y: number;
  side: number;
  alive?: 0 | 1;
  buried?: boolean;
  air?: boolean;
  /** GH-707: a man down. */
  down?: boolean;
}
const ONE = 65536;

function view(units: U[]): HoldView {
  return {
    entityCount: units.length,
    alive: units.map((u) => u.alive ?? 1),
    side: units.map((u) => u.side),
    // Mid-tile, so a tile coordinate is unambiguous.
    posX: units.map((u) => u.x * ONE + ONE / 2),
    posY: units.map((u) => u.y * ONE + ONE / 2),
    tunnelIn: units.map((u) => (u.buried ? 3 : -1)),
    isAir: (i) => units[i].air === true,
    isDown: (i) => units[i].down === true,
  };
}

// A 10 x 10 zone at (20, 20): tiles 20..29 on both axes.
const ZONE: [number, number, number, number] = [20, 20, 10, 10];

describe('zoneHolder (D3)', () => {
  it('a man down holds nothing and contests nothing (GH-707, the lead 22 Oct)', () => {
    expect(zoneHolder(view([{ x: 24, y: 24, side: 1, down: true }]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 21, y: 25, side: 0 }, { x: 26, y: 25, side: 1, down: true }]), ZONE)).toBe(0);
    expect(zoneState(view([{ x: 21, y: 25, side: 0 }, { x: 26, y: 25, side: 1, down: true }]), ZONE)).toBe(0);
    // The one-pass form the runtime calls reads it too.
    const out = new Int32Array(1);
    zoneStates(view([{ x: 21, y: 25, side: 0 }, { x: 26, y: 25, side: 1, down: true }]), 40, 40, zoneTileMask(40, 40, [ZONE]), [ZONE], out);
    expect(out[0]).toBe(0);
  });

  it('an empty zone is held by nobody', () => {
    expect(zoneHolder(view([]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 5, y: 5, side: 0 }, { x: 50, y: 50, side: 1 }]), ZONE)).toBe(-1);
  });

  it('one side-0 squad holds it for side 0', () => {
    expect(zoneHolder(view([{ x: 24, y: 24, side: 0 }]), ZONE)).toBe(0);
  });

  it('one side-1 squad holds it for side 1', () => {
    expect(zoneHolder(view([{ x: 24, y: 24, side: 1 }]), ZONE)).toBe(1);
  });

  it('both sides inside, 5 tiles apart, is contested', () => {
    expect(zoneHolder(view([{ x: 21, y: 25, side: 0 }, { x: 26, y: 25, side: 1 }]), ZONE)).toBe(-1);
  });

  it('both sides inside, 15 tiles apart (a wide zone), is contested too: one holder or none', () => {
    const wide: [number, number, number, number] = [10, 10, 30, 10];
    expect(zoneHolder(view([{ x: 11, y: 15, side: 0 }, { x: 26, y: 15, side: 1 }]), wide)).toBe(-1);
    // The larger force does not win it either.
    expect(
      zoneHolder(
        view([{ x: 11, y: 15, side: 0 }, { x: 12, y: 15, side: 0 }, { x: 13, y: 15, side: 0 }, { x: 26, y: 15, side: 1 }]),
        wide
      )
    ).toBe(-1);
  });

  it('an aircraft over an empty zone holds nothing', () => {
    expect(zoneHolder(view([{ x: 24, y: 24, side: 0, air: true }]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 24, y: 24, side: 1, air: true }]), ZONE)).toBe(-1);
  });

  it('an aircraft beside an enemy squad does not contest it', () => {
    expect(zoneHolder(view([{ x: 22, y: 22, side: 0 }, { x: 23, y: 22, side: 1, air: true }]), ZONE)).toBe(0);
    expect(zoneHolder(view([{ x: 22, y: 22, side: 1 }, { x: 23, y: 22, side: 0, air: true }]), ZONE)).toBe(1);
  });

  it('a buried unit holds nothing and contests nothing', () => {
    expect(zoneHolder(view([{ x: 24, y: 24, side: 1, buried: true }]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 22, y: 22, side: 0 }, { x: 24, y: 24, side: 1, buried: true }]), ZONE)).toBe(0);
    // tunnelIn 0 is route 0, buried: the `>= 0` edge (a `> 0` test would count it).
    const route0: HoldView = { ...view([{ x: 22, y: 22, side: 0 }, { x: 24, y: 24, side: 1 }]), tunnelIn: [-1, 0] };
    expect(zoneHolder(route0, ZONE)).toBe(0);
    expect(zoneHolder({ ...view([{ x: 24, y: 24, side: 1 }]), tunnelIn: [0] }, ZONE)).toBe(-1);
  });

  it('a dead unit holds nothing and contests nothing', () => {
    expect(zoneHolder(view([{ x: 24, y: 24, side: 0, alive: 0 }]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 22, y: 22, side: 0 }, { x: 24, y: 24, side: 1, alive: 0 }]), ZONE)).toBe(0);
  });

  it('civilians (side 2) hold nothing and contest nothing', () => {
    expect(zoneHolder(view([{ x: 24, y: 24, side: 2 }]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 22, y: 22, side: 0 }, { x: 24, y: 24, side: 2 }]), ZONE)).toBe(0);
  });

  it('the zone is half-open: left and top edges inside, right and bottom exclusive', () => {
    expect(zoneHolder(view([{ x: 20, y: 20, side: 0 }]), ZONE)).toBe(0);
    expect(zoneHolder(view([{ x: 29, y: 29, side: 0 }]), ZONE)).toBe(0);
    expect(zoneHolder(view([{ x: 30, y: 25, side: 0 }]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 25, y: 30, side: 0 }]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 19, y: 25, side: 0 }]), ZONE)).toBe(-1);
    expect(zoneHolder(view([{ x: 25, y: 19, side: 0 }]), ZONE)).toBe(-1);
    // An enemy one tile past the exclusive edge does not contest.
    expect(zoneHolder(view([{ x: 29, y: 29, side: 0 }, { x: 30, y: 29, side: 1 }]), ZONE)).toBe(0);
  });

  it('a position just under a tile boundary belongs to the lower tile (pos >> 16)', () => {
    const v: HoldView = { ...view([{ x: 0, y: 25, side: 0 }]), posX: [30 * ONE - 1], posY: [25 * ONE] };
    expect(zoneHolder(v, ZONE)).toBe(0);
    const w: HoldView = { ...v, posX: [30 * ONE] };
    expect(zoneHolder(w, ZONE)).toBe(-1);
  });
});

// Lane A's A1 (C-R13): the state behind the holder. Contested and empty both pay nobody, but the
// HUD tells them apart, so the runtime keeps the state and folds -2 to -1 only for `zoneHolder`.
describe('zoneState (A1, C-R13)', () => {
  it('the constants are the documented values', () => {
    expect(ZONE_EMPTY).toBe(-1);
    expect(ZONE_CONTESTED).toBe(-2);
  });

  it('an empty zone is -1', () => {
    expect(zoneState(view([]), ZONE)).toBe(ZONE_EMPTY);
    expect(zoneState(view([{ x: 5, y: 5, side: 0 }, { x: 50, y: 50, side: 1 }]), ZONE)).toBe(-1);
  });

  it('one side present is that side', () => {
    expect(zoneState(view([{ x: 24, y: 24, side: 0 }]), ZONE)).toBe(0);
    expect(zoneState(view([{ x: 24, y: 24, side: 1 }]), ZONE)).toBe(1);
  });

  it('both sides present is -2, whatever the order they are scanned in', () => {
    expect(zoneState(view([{ x: 21, y: 25, side: 0 }, { x: 26, y: 25, side: 1 }]), ZONE)).toBe(ZONE_CONTESTED);
    expect(zoneState(view([{ x: 26, y: 25, side: 1 }, { x: 21, y: 25, side: 0 }]), ZONE)).toBe(-2);
  });

  it('an aircraft, a buried unit or a civilian beside one side leaves it that side, not -2', () => {
    expect(zoneState(view([{ x: 22, y: 22, side: 0 }, { x: 23, y: 22, side: 1, air: true }]), ZONE)).toBe(0);
    expect(zoneState(view([{ x: 22, y: 22, side: 1 }, { x: 23, y: 22, side: 0, air: true }]), ZONE)).toBe(1);
    // tunnelIn 0 is route 0: buried, the `>= 0` edge.
    const buried: HoldView = { ...view([{ x: 22, y: 22, side: 0 }, { x: 23, y: 22, side: 1 }]), tunnelIn: [-1, 0] };
    expect(zoneState(buried, ZONE)).toBe(0);
    expect(zoneState(view([{ x: 22, y: 22, side: 1 }, { x: 23, y: 22, side: 2 }]), ZONE)).toBe(1);
  });

  it('zoneHolder is zoneState with -2 folded to -1', () => {
    const cases: U[][] = [
      [],
      [{ x: 24, y: 24, side: 0 }],
      [{ x: 24, y: 24, side: 1 }],
      [{ x: 21, y: 25, side: 0 }, { x: 26, y: 25, side: 1 }],
    ];
    for (const c of cases) {
      const s = zoneState(view(c), ZONE);
      expect(zoneHolder(view(c), ZONE)).toBe(s === ZONE_CONTESTED ? -1 : s);
    }
  });
});

// F2 Task 11: the runtime reads every zone's state in one pass over the units, through a per-tile
// zone bitmask. `zoneState` stays the definition; this pins the one-pass reading to it.
describe('zoneStates: one pass over the units, equal to zoneState per zone', () => {
  // A seeded integer LCG (Numerical Recipes constants): the same worlds on every run.
  function lcg(seed: number): (n: number) => number {
    let s = seed >>> 0;
    return (n: number) => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s % n;
    };
  }

  it('agrees with zoneState on 600 randomised worlds: overlaps, off-map rects and units, every flag', () => {
    const rnd = lcg(20261015);
    let compared = 0;
    let contested = 0;
    let held = 0;
    for (let world = 0; world < 600; world++) {
      const w = 4 + rnd(20);
      const h = 4 + rnd(20);
      const zoneCount = 1 + rnd(MAX_INCOME_ZONES);
      const rects: [number, number, number, number][] = [];
      for (let k = 0; k < zoneCount; k++) {
        // Rects may start off the map and run past its far edges (zoneTileMask clips them).
        rects.push([rnd(w + 4) - 2, rnd(h + 4) - 2, 1 + rnd(8), 1 + rnd(8)]);
      }
      const n = rnd(60);
      const air = new Uint8Array(n);
      const down = new Uint8Array(n);
      const v: HoldView = {
        entityCount: n,
        alive: Array.from({ length: n }, () => (rnd(5) === 0 ? 0 : 1)),
        side: Array.from({ length: n }, () => rnd(3)),
        // Tiles from -2 to the far edge + 1: some units stand off the map, inside an off-map rect.
        posX: Array.from({ length: n }, () => ((rnd(w + 4) - 2) << 16) + rnd(65536)),
        posY: Array.from({ length: n }, () => ((rnd(h + 4) - 2) << 16) + rnd(65536)),
        // -1 surface; 0 and 3 buried (0 is the `>= 0` edge).
        tunnelIn: Array.from({ length: n }, () => [-1, -1, -1, 0, 3][rnd(5)]),
        isAir: (i) => air[i] === 1,
        isDown: (i) => down[i] === 1, // GH-707
      };
      for (let i = 0; i < n; i++) air[i] = rnd(6) === 0 ? 1 : 0;
      for (let i = 0; i < n; i++) down[i] = rnd(7) === 0 ? 1 : 0;
      const mask = zoneTileMask(w, h, rects);
      const out = new Int32Array(zoneCount);
      zoneStates(v, w, h, mask, rects, out);
      for (let k = 0; k < zoneCount; k++) {
        expect(out[k], `world ${world} zone ${k}`).toBe(zoneState(v, rects[k]));
        if (out[k] === ZONE_CONTESTED) contested++;
        if (out[k] === 0 || out[k] === 1) held++;
        compared++;
      }
    }
    // The fixture is not vacuous: it reaches every state many times.
    expect(compared).toBeGreaterThan(5000);
    expect(contested).toBeGreaterThan(100);
    expect(held).toBeGreaterThan(500);
  });

  it('overlapping zones each see a unit standing in both', () => {
    const rects: [number, number, number, number][] = [
      [0, 0, 4, 4],
      [2, 2, 4, 4],
    ];
    const mask = zoneTileMask(8, 8, rects);
    expect(mask[3 * 8 + 3]).toBe(3);
    const out = new Int32Array(2);
    zoneStates(view([{ x: 3, y: 3, side: 1 }]), 8, 8, mask, rects, out);
    expect(Array.from(out)).toEqual([1, 1]);
    zoneStates(view([{ x: 3, y: 3, side: 1 }, { x: 5, y: 5, side: 0 }]), 8, 8, mask, rects, out);
    expect(Array.from(out)).toEqual([1, ZONE_CONTESTED]);
  });

  it('zone 31 uses the top bit, and more than 32 zones are refused', () => {
    const rects: [number, number, number, number][] = [];
    for (let k = 0; k < MAX_INCOME_ZONES; k++) rects.push([k, 0, 1, 1]);
    const mask = zoneTileMask(32, 1, rects);
    const out = new Int32Array(32);
    zoneStates(view([{ x: 31, y: 0, side: 0 }]), 32, 1, mask, rects, out);
    expect(out[31]).toBe(0);
    expect(out[30]).toBe(ZONE_EMPTY);
    expect(MAX_INCOME_ZONES).toBe(32);
    expect(() => zoneTileMask(33, 1, [...rects, [32, 0, 1, 1]])).toThrow(/33 income zones: at most 32/);
  });
});
