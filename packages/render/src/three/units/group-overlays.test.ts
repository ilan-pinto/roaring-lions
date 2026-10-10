import { describe, expect, it } from 'vitest';
import { envelopeDraws, groupRoutes, primaryRingHex, selectionPrimary } from './group-overlays';
import { lightenHex } from './overlay-geometry';

describe('selectionPrimary', () => {
  it('is the first id with an envelope, skipping the unarmed and the dead', () => {
    const armed = new Set([5, 9]);
    expect(selectionPrimary([3, 9, 5], (i) => armed.has(i), () => true)).toBe(9);
  });
  it('falls back to the first alive when nobody is armed, and -1 for nobody', () => {
    expect(selectionPrimary([4, 2], () => false, (i) => i === 2)).toBe(2);
    expect(selectionPrimary([], () => true, () => true)).toBe(-1);
  });
});

describe('envelopeDraws', () => {
  const all = (): boolean => true;
  it('draws the primary, and the preview when it is someone else -- two at most', () => {
    expect(envelopeDraws(1, -1, all)).toEqual([{ id: 1, previewing: false }]);
    expect(envelopeDraws(1, 7, all)).toEqual([
      { id: 1, previewing: false },
      { id: 7, previewing: true },
    ]);
    expect(envelopeDraws(1, 1, all)).toEqual([{ id: 1, previewing: false }]);
  });
  it('drops either one that has no envelope to draw', () => {
    expect(envelopeDraws(1, 7, (i) => i === 7)).toEqual([{ id: 7, previewing: true }]);
    expect(envelopeDraws(-1, -1, all)).toEqual([]);
  });
});

describe('groupRoutes', () => {
  it('merges a formation into one path ending at the centroid of its destinations', () => {
    const routes = [
      { points: [[0, 0], [10, 0]] as const },
      { points: [[0, 2], [10, 2]] as const },
      { points: [[0, 4], [12, 4]] as const },
    ];
    const out = groupRoutes(routes, 3);
    expect(out).toHaveLength(1);
    expect(out[0].members).toBe(3);
    expect(out[0].points[0]).toEqual([0, 2]);
    expect(out[0].points[1][0]).toBeCloseTo(32 / 3);
    expect(out[0].points[1][1]).toBeCloseTo(2);
    expect(out[0].spreadTiles).toBeGreaterThan(0);
  });
  it('keeps two orders to two places apart', () => {
    const out = groupRoutes([{ points: [[0, 0], [10, 0]] }, { points: [[0, 1], [10, 20]] }], 3);
    expect(out).toHaveLength(2);
  });
  it('links a chain of neighbours that no single pair spans (single linkage)', () => {
    const out = groupRoutes(
      [{ points: [[0, 0], [0, 0]] }, { points: [[0, 0], [2.5, 0]] }, { points: [[0, 0], [5, 0]] }],
      3
    );
    expect(out).toHaveLength(1);
  });
  it('a lone unit is its own path, point for point', () => {
    const pts = [[1, 1], [4, 1], [4, 6]] as const;
    expect(groupRoutes([{ points: pts }])).toEqual([{ points: [[1, 1], [4, 1], [4, 6]], members: 1, spreadTiles: 0 }]);
  });
  it('a member with fewer waypoints contributes its own destination to the later points', () => {
    const out = groupRoutes(
      [{ points: [[0, 0], [10, 0], [10, 2]] }, { points: [[0, 2], [10, 2]] }],
      3
    );
    expect(out).toHaveLength(1);
    expect(out[0].points).toHaveLength(3);
    expect(out[0].points[2]).toEqual([10, 2]);
  });
});

describe('primary ring colour', () => {
  it('lifts the team hex toward white without changing which channel leads', () => {
    expect(lightenHex('#2F6FD9', 0.45)).toBe('#8db0ea');
    expect(lightenHex('#2F6FD9', 0)).toBe('#2f6fd9');
    expect(lightenHex('#2F6FD9', 1)).toBe('#ffffff');
    expect(primaryRingHex('#2F6FD9')).toBe('#8db0ea');
  });
});
