import { describe, expect, it } from 'vitest';
import { highGroundRises, medianOpenLevel } from './intel-earn';

// Hand-drawn grids, as literals: the oracle is the picture, never the code's own arguments.
// Each row is a string of elevation digits; '#' is a blocked tile (its digit slot is read as level 9
// so that a missing blocked test would let it join a rise).
function grid(rows: string[]): { elevation: Uint8Array; blocked: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const elevation = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const c = row[x];
      if (c === '#') {
        blocked[y * w + x] = 1;
        elevation[y * w + x] = 9;
      } else {
        elevation[y * w + x] = c.charCodeAt(0) - 48;
      }
    }
  });
  return { elevation, blocked, w, h };
}

function rises(rows: string[]): { riseOf: Int16Array; count: number } {
  const g = grid(rows);
  return highGroundRises(g.elevation, g.blocked, g.w, g.h);
}

describe('medianOpenLevel', () => {
  it('is the lower median on an even count', () => {
    const g = grid(['0123']); // sorted 0 1 2 3 -> lower median is 1, not 2
    expect(medianOpenLevel(g.elevation, g.blocked)).toBe(1);
  });
  it('is the middle value on an odd count', () => {
    const g = grid(['00359']);
    expect(medianOpenLevel(g.elevation, g.blocked)).toBe(3);
  });
  it('ignores blocked tiles', () => {
    const g = grid(['0#####']); // only one open tile, at level 0
    expect(medianOpenLevel(g.elevation, g.blocked)).toBe(0);
  });
  it('reads 0 when nothing is open', () => {
    const g = grid(['###']);
    expect(medianOpenLevel(g.elevation, g.blocked)).toBe(0);
  });
});

describe('highGroundRises', () => {
  it('a flat map (all zero, as Sim holds with no grid) has no rise', () => {
    const r = rises(['0000', '0000', '0000']);
    expect(r.count).toBe(0);
    expect(Array.from(r.riseOf).every((v) => v === -1)).toBe(true);
  });

  it('a 3x3 plateau at median + 2 is one rise of 9 tiles', () => {
    const r = rises([
      '00000000',
      '00222000',
      '00222000',
      '00222000',
      '00000000',
      '00000000',
    ]);
    expect(r.count).toBe(1);
    expect(Array.from(r.riseOf).filter((v) => v === 0).length).toBe(9);
    expect(Array.from(r.riseOf).filter((v) => v === -1).length).toBe(48 - 9);
  });

  it('a plateau at median + 1 is no rise (eye level, D4)', () => {
    const r = rises([
      '00000000',
      '00111000',
      '00111000',
      '00111000',
      '00000000',
      '00000000',
    ]);
    expect(r.count).toBe(0);
  });

  it('is measured from the median, not from zero', () => {
    // Median 3: a 4-plateau is +1 (no rise), a 5-plateau is +2 (a rise).
    const r = rises(['3333', '3433', '3335', '3333']);
    expect(r.count).toBe(1);
    expect(r.riseOf[2 * 4 + 3]).toBe(0);
    expect(r.riseOf[1 * 4 + 1]).toBe(-1);
  });

  it('two plateaus joined only diagonally are two rises', () => {
    const r = rises([
      '000000',
      '022000',
      '022000',
      '000220',
      '000220',
      '000000',
    ]);
    expect(r.count).toBe(2);
    // Row-major scan: the upper-left block is id 0, the lower-right id 1.
    expect(r.riseOf[1 * 6 + 1]).toBe(0);
    expect(r.riseOf[4 * 6 + 4]).toBe(1);
  });

  it('a ^ tile at the top of a hill is not part of the rise', () => {
    const r = rises([
      '000000',
      '022200',
      '02#200',
      '022200',
      '000000',
      '000000',
    ]);
    expect(r.count).toBe(1);
    expect(r.riseOf[2 * 6 + 2]).toBe(-1);
    expect(Array.from(r.riseOf).filter((v) => v === 0).length).toBe(8);
  });

  it('a blocked tile that cuts a ridge in two makes two rises', () => {
    const r = rises([
      '0000000',
      '02#2000',
      '0000000',
      '0000000',
    ]);
    expect(r.count).toBe(2);
  });

  it('a lone hilltop tile is a rise (no minimum size)', () => {
    const r = rises(['000', '020', '000']);
    expect(r.count).toBe(1);
    expect(r.riseOf[4]).toBe(0);
  });

  it('numbers rises in row-major scan order', () => {
    const r = rises([
      '0000000',
      '0000020',
      '0200000',
      '0000000',
    ]);
    expect(r.count).toBe(2);
    expect(r.riseOf[1 * 7 + 5]).toBe(0);
    expect(r.riseOf[2 * 7 + 1]).toBe(1);
  });
});
