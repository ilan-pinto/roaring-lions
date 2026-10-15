import { describe, expect, it } from 'vitest';
import { zoneHolder, type HoldView } from './income';

// Literal units: tile coordinates (the test shifts them into Q16.16), side, and flags.
interface U {
  x: number;
  y: number;
  side: number;
  alive?: 0 | 1;
  buried?: boolean;
  air?: boolean;
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
  };
}

// A 10 x 10 zone at (20, 20): tiles 20..29 on both axes.
const ZONE: [number, number, number, number] = [20, 20, 10, 10];

describe('zoneHolder (D3)', () => {
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
